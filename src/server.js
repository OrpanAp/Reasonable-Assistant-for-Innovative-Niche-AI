'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./config');
const { validateChat } = require('./validate');
const { guardedFetch, isLoopback } = require('./netguard');
const localProvider = require('./providers/local');
const { createRegistry } = require('./agent/tools');
const { runAgent } = require('./agent/loop');
const { createAudit } = require('./agent/audit');

const PUBLIC = path.join(__dirname, '..', 'public');
const DEFAULT_SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
};
const MODES = ['offline', 'online'];

function createApp(cfg = load(), { provider = localProvider, settingsFile = DEFAULT_SETTINGS, auditFile = cfg.auditFile, quiet = false } = {}) {
  const state = { mode: cfg.mode, agentRunning: false };
  const registry = createRegistry(cfg);
  const audit = createAudit(auditFile);
  const pending = new Map(); // approval id -> resolver
  if (settingsFile) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (MODES.includes(s.mode)) state.mode = s.mode;
    } catch { /* first run */ }
  }

  const hits = new Map();
  function rateLimited(ip) {
    const now = Date.now();
    if (hits.size > 1000) hits.clear();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
    const limited = recent.length >= cfg.rateLimitPerMin;
    if (!limited) recent.push(now);
    hits.set(ip, recent);
    return limited;
  }

  function sendJson(res, status, obj, extra = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return reject(Object.assign(new Error('Content-Type must be application/json.'), { status: 415 }));
      }
      let size = 0, failed = false;
      const chunks = [];
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > cfg.maxBodyBytes) { failed = true; return reject(Object.assign(new Error('Request body too large.'), { status: 413, close: true })); }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
        catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  async function modelReachable() {
    try {
      const r = await guardedFetch(`${cfg.localUrl}/v1/models`, { signal: AbortSignal.timeout(2000) }, state.mode);
      r.body?.cancel();
      return r.ok;
    } catch { return false; }
  }

  async function handleChat(req, res) {
    let body;
    try { body = await readJson(req); }
    catch (err) {
      if (err.close) res.on('finish', () => req.socket.destroy());
      return sendJson(res, err.status || 400, { error: err.message }, err.close ? { Connection: 'close' } : {});
    }
    const v = validateChat(body, cfg);
    if (v.error) return sendJson(res, 400, { error: v.error });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.requestTimeoutMs);
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    };
    try {
      for await (const delta of provider.streamChat({ cfg, mode: state.mode, messages: v.messages, signal: ac.signal })) {
        begin();
        res.write(JSON.stringify({ delta }) + '\n');
      }
      begin();
      res.end(JSON.stringify({ done: true }) + '\n');
    } catch (err) {
      const map = { MODEL_UNREACHABLE: 503, OFFLINE_BLOCKED: 403, MODEL_ERROR: 502 };
      let status = map[err.code] || 500;
      let message = map[err.code] ? err.message : 'Internal error.';
      if (err.name === 'AbortError') { status = 504; message = 'The model took too long to respond.'; }
      if (status === 500) console.error('chat error:', err);
      if (started) { if (!res.writableEnded) res.end(JSON.stringify({ error: message }) + '\n'); }
      else if (!res.writableEnded) sendJson(res, status, { error: message });
    } finally { clearTimeout(timer); }
  }

  function askApproval(req, signal) {
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); pending.delete(req.id); resolve(v); };
      const timer = setTimeout(() => done(false), cfg.approvalTimeoutMs); // no answer = deny
      signal.addEventListener('abort', () => done(false), { once: true });
      pending.set(req.id, { resolve: done });
    });
  }

  async function handleAgent(req, res) {
    let body;
    try { body = await readJson(req); }
    catch (err) {
      if (err.close) res.on('finish', () => req.socket.destroy());
      return sendJson(res, err.status || 400, { error: err.message }, err.close ? { Connection: 'close' } : {});
    }
    const v = validateChat(body, cfg);
    if (v.error) return sendJson(res, 400, { error: v.error });
    if (typeof provider.complete !== 'function') return sendJson(res, 501, { error: 'This provider does not support the agent.' });
    if (state.agentRunning) return sendJson(res, 409, { error: 'An agent task is already running. Wait for it to finish or press Stop.' });

    state.agentRunning = true;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.agentTimeoutMs);
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    try {
      await runAgent({ cfg, mode: state.mode, messages: v.messages, registry, provider, emit, approve: askApproval, audit, signal: ac.signal });
    } catch (err) {
      const map = { MODEL_UNREACHABLE: 1, OFFLINE_BLOCKED: 1, MODEL_ERROR: 1 };
      let message = map[err.code] ? err.message : 'Internal error.';
      if (err.name === 'AbortError') message = 'The task was stopped or timed out.';
      else if (!map[err.code]) console.error('agent error:', err);
      emit({ error: message });
    } finally {
      clearTimeout(timer);
      state.agentRunning = false;
      if (!res.writableEnded) res.end();
    }
  }

  async function handleApprove(req, res) {
    let body;
    try { body = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }
    if (!body || typeof body.id !== 'string' || typeof body.approve !== 'boolean') return sendJson(res, 400, { error: 'Expected {"id": string, "approve": boolean}.' });
    const p = pending.get(body.id);
    if (!p) return sendJson(res, 404, { error: 'No pending approval with that id (it may have timed out).' });
    p.resolve(body.approve);
    return sendJson(res, 200, { ok: true });
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return sendJson(res, 400, { error: 'Bad path.' }); }
    if (rel === '/') rel = '/index.html';
    if (rel.includes('\0')) return sendJson(res, 404, { error: 'Not found.' });
    const file = path.normalize(path.join(PUBLIC, rel));
    const type = TYPES[path.extname(file)];
    if (!file.startsWith(PUBLIC + path.sep) || !type) return sendJson(res, 404, { error: 'Not found.' });
    fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    if (!quiet) res.on('finish', () => console.log(`${req.method} ${(req.url || '').split('?')[0]} ${res.statusCode} ${Date.now() - t0}ms`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const hostHeader = req.headers.host || '';
      const hostname = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0];
      if (isLoopback(cfg.host) && !isLoopback(hostname)) return sendJson(res, 403, { error: 'Forbidden host.' });
      if (req.method === 'POST' && req.headers.origin) {
        let same = false;
        try { same = new URL(req.headers.origin).host === hostHeader; } catch { /* invalid origin */ }
        if (!same) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });
      }
      let pathname;
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return sendJson(res, 400, { error: 'Bad URL.' }); }

      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, mode: state.mode, model: cfg.localModel, modelReachable: await modelReachable() });
      }
      if (pathname === '/api/mode' && req.method === 'POST') {
        let body;
        try { body = await readJson(req); } catch (err) { return sendJson(res, err.status || 400, { error: err.message }); }
        if (!body || !MODES.includes(body.mode)) return sendJson(res, 400, { error: 'mode must be "offline" or "online".' });
        state.mode = body.mode;
        if (settingsFile) {
          try { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify({ mode: state.mode })); }
          catch (e) { console.error('could not save settings:', e.message); }
        }
        return sendJson(res, 200, { mode: state.mode });
      }
      if (pathname === '/api/chat' && req.method === 'POST') {
        if (rateLimited(req.socket.remoteAddress)) return sendJson(res, 429, { error: 'Too many requests. Please slow down.' }, { 'Retry-After': '60' });
        return await handleChat(req, res);
      }
      if (pathname === '/api/agent' && req.method === 'POST') {
        if (rateLimited(req.socket.remoteAddress)) return sendJson(res, 429, { error: 'Too many requests. Please slow down.' }, { 'Retry-After': '60' });
        return await handleAgent(req, res);
      }
      if (pathname === '/api/approve' && req.method === 'POST') return await handleApprove(req, res);
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
      return serveStatic(req, res, pathname);
    } catch (err) {
      console.error('unhandled:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error.' }); else res.end();
    }
  });
  server.requestTimeout = 0; // streaming responses can be long; chat has its own timeout
  return server;
}

if (require.main === module) {
  const cfg = load();
  createApp(cfg).listen(cfg.port, cfg.host, () => {
    console.log(`R.A.I.N. running at http://${cfg.host}:${cfg.port}  (mode: ${cfg.mode}, model: ${cfg.localModel} @ ${cfg.localUrl})`);
  });
}

module.exports = { createApp };
