'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { load } = require('../src/config');
const { validateChat } = require('../src/validate');
const { assertAllowed } = require('../src/netguard');
const { createApp } = require('../src/server');

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const close = (srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); });

function fakeModel(chunks = ['Hel', 'lo']) {
  return http.createServer((req, res) => {
    if (req.url === '/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
}

async function boot(modelUrl, over = {}) {
  const cfg = load({ PORT: '0', LOCAL_MODEL_URL: modelUrl, ...over });
  const app = createApp(cfg, { settingsFile: null, quiet: true });
  const port = await listen(app);
  return { app, base: `http://127.0.0.1:${port}`, port };
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const cfg0 = load({});

test('validateChat accepts good input and rejects bad input', () => {
  assert.ok(validateChat({ messages: [{ role: 'user', content: 'hi' }] }, cfg0).messages);
  assert.match(validateChat(null, cfg0).error, /object/);
  assert.match(validateChat({ messages: [] }, cfg0).error, /non-empty/);
  assert.match(validateChat({ messages: [{ role: 'system', content: 'x' }] }, cfg0).error, /role/);
  assert.match(validateChat({ messages: [{ role: 'user', content: '  ' }] }, cfg0).error, /non-empty/);
  assert.match(validateChat({ messages: [{ role: 'assistant', content: 'x' }] }, cfg0).error, /last message/);
  assert.match(validateChat({ messages: [{ role: 'user', content: 'x'.repeat(cfg0.maxMessageChars + 1) }] }, cfg0).error, /too long/);
});

test('validateChat trims old context but keeps the newest message', () => {
  const small = { ...cfg0, maxContextChars: 10 };
  const msgs = [{ role: 'user', content: 'aaaaaa' }, { role: 'assistant', content: 'bbbbbb' }, { role: 'user', content: 'cccccc' }];
  const out = validateChat({ messages: msgs }, small).messages;
  assert.deepEqual(out.map((m) => m.content), ['cccccc']);
});

test('netguard blocks non-loopback in offline mode only', () => {
  assert.throws(() => assertAllowed('https://example.com/x', 'offline'), { code: 'OFFLINE_BLOCKED' });
  assert.doesNotThrow(() => assertAllowed('http://127.0.0.1:11434', 'offline'));
  assert.doesNotThrow(() => assertAllowed('http://localhost:8080', 'offline'));
  assert.doesNotThrow(() => assertAllowed('https://example.com/x', 'online'));
});

test('chat streams the model reply as NDJSON', async () => {
  const model = fakeModel(); const mp = await listen(model);
  const { app, base } = await boot(`http://127.0.0.1:${mp}`);
  try {
    const res = await post(`${base}/api/chat`, { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 200);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.filter((l) => l.delta).map((l) => l.delta).join(''), 'Hello');
    assert.deepEqual(lines.at(-1), { done: true });
  } finally { await close(app); await close(model); }
});

test('chat rejects invalid input with 400 and wrong content type with 415', async () => {
  const model = fakeModel(); const mp = await listen(model);
  const { app, base } = await boot(`http://127.0.0.1:${mp}`);
  try {
    assert.equal((await post(`${base}/api/chat`, { messages: 'nope' })).status, 400);
    assert.equal((await post(`${base}/api/chat`, '{bad json')).status, 400);
    const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(r.status, 415);
  } finally { await close(app); await close(model); }
});

test('chat returns 503 with a clear message when the model server is down', async () => {
  const { app, base } = await boot('http://127.0.0.1:1');
  try {
    const res = await post(`${base}/api/chat`, { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /Is it running/);
  } finally { await close(app); }
});

test('offline mode refuses to contact a non-local model URL (no request is made)', async () => {
  const { app, base } = await boot('http://model.invalid:9', { DEFAULT_MODE: 'offline' });
  try {
    const res = await post(`${base}/api/chat`, { messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /offline mode/);
  } finally { await close(app); }
});

test('mode can be switched and is validated', async () => {
  const { app, base } = await boot('http://127.0.0.1:1');
  try {
    assert.equal((await (await post(`${base}/api/mode`, { mode: 'online' })).json()).mode, 'online');
    assert.equal((await (await fetch(`${base}/api/health`)).json()).mode, 'online');
    assert.equal((await post(`${base}/api/mode`, { mode: 'bogus' })).status, 400);
  } finally { await close(app); }
});

test('rejects foreign Host headers and cross-origin POSTs', async () => {
  const { app, base, port } = await boot('http://127.0.0.1:1');
  try {
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject); r.end();
    });
    assert.equal(status, 403);
    const x = await post(`${base}/api/mode`, { mode: 'online' }, { Origin: 'http://evil.example' });
    assert.equal(x.status, 403);
  } finally { await close(app); }
});

test('rate limiting returns 429', async () => {
  const model = fakeModel(); const mp = await listen(model);
  const { app, base } = await boot(`http://127.0.0.1:${mp}`, { RATE_LIMIT_PER_MIN: '2' });
  try {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    assert.equal((await post(`${base}/api/chat`, body)).status, 200);
    assert.equal((await post(`${base}/api/chat`, body)).status, 200);
    assert.equal((await post(`${base}/api/chat`, body)).status, 429);
  } finally { await close(app); await close(model); }
});

test('static files are served and path traversal is blocked', async () => {
  const { app, base, port } = await boot('http://127.0.0.1:1');
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /R\.A\.I\.N\./);
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    const status = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/..%2fpackage.json' }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', reject); r.end();
    });
    assert.equal(status, 404);
  } finally { await close(app); }
});
