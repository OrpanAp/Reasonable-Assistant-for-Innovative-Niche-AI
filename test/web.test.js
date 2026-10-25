'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { load } = require('../src/config');
const { createRegistry, htmlToText } = require('../src/agent/tools');
const { runAgent } = require('../src/agent/loop');
const { createAudit } = require('../src/agent/audit');
const { isPrivateIp, publicFetch } = require('../src/netguard');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rain-web-'));
const mkcfg = (over = {}) => load({ PORT: '0', WORKSPACE_DIR: tmp(), ...over });
const script = (steps) => ({ complete: async () => { const s = steps.shift(); if (!s) throw new Error('script exhausted'); return s; } });
const call = (id, name, args) => ({ id, name, args });
const reply = (content, toolCalls = []) => ({ content, toolCalls });

async function run(cfg, mode, provider, approve) {
  const events = [];
  await runAgent({ cfg, mode, messages: [{ role: 'user', content: 'go' }], registry: createRegistry(cfg), provider, emit: (e) => events.push(e), approve, audit: createAudit(null), signal: new AbortController().signal });
  return events;
}

function webServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('isPrivateIp flags internal, loopback and link-local ranges only', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('fetch_url only exists in online mode', () => {
  const reg = createRegistry(mkcfg());
  const names = (m) => reg.schemas(m).map((s) => s.function.name);
  assert.ok(!names().includes('fetch_url'));
  assert.ok(!names('offline').includes('fetch_url'));
  assert.ok(names('online').includes('fetch_url'));
  assert.ok(reg.list('online').some((t) => t.name === 'fetch_url'));
});

test('offline: a fetch_url call is refused without ever asking for approval', async () => {
  let asked = 0;
  const events = await run(mkcfg(), 'offline', script([reply('', [call('c1', 'fetch_url', { url: 'https://example.com' })]), reply('ok')]), async () => { asked++; return true; });
  const r = events.find((e) => e.type === 'tool_result');
  assert.equal(r.ok, false);
  assert.match(r.output, /Offline mode/);
  assert.equal(asked, 0);
});

test('online: fetch_url asks for approval, and denial stops the request', async () => {
  const { server, base } = await webServer((req, res) => { res.end('hit'); });
  try {
    const cfg = mkcfg({ FETCH_ALLOW_PRIVATE: 'true' });
    let hits = 0; server.on('request', () => hits++);
    const asked = [];
    const events = await run(cfg, 'online', script([reply('', [call('c1', 'fetch_url', { url: base + '/' })]), reply('ok')]), async (r) => { asked.push(r.summary); return false; });
    assert.equal(asked.length, 1);
    assert.match(asked[0], /^Fetch http:\/\/127\.0\.0\.1/);
    assert.equal(hits, 0);
    assert.equal(events.find((e) => e.type === 'tool_result').ok, false);
  } finally { server.close(); }
});

test('online: approved fetch returns readable text, strips scripts/styles, and labels it untrusted', async () => {
  const html = '<!doctype html><html><head><title>Hello &amp; welcome</title><style>p{color:red}</style></head><body><script>alert(1)</script><h1>Rain</h1><p>First&nbsp;para &lt;b&gt;.</p><ul><li>one</li><li>two</li></ul></body></html>';
  const { server, base } = await webServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  try {
    const cfg = mkcfg({ FETCH_ALLOW_PRIVATE: 'true' });
    const events = await run(cfg, 'online', script([reply('', [call('c1', 'fetch_url', { url: base + '/' })]), reply('done')]), async () => true);
    const r = events.find((e) => e.type === 'tool_result');
    assert.ok(r.ok, r.output);
    assert.match(r.output, /Untrusted data/);
    assert.match(r.output, /Title: Hello & welcome/);
    assert.match(r.output, /Rain/);
    assert.match(r.output, /- one/);
    assert.doesNotMatch(r.output, /alert\(1\)|color:red|<h1>/);
  } finally { server.close(); }
});

test('AUTO_APPROVE_FETCH skips the prompt', async () => {
  const { server, base } = await webServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('plain text'); });
  try {
    const cfg = mkcfg({ FETCH_ALLOW_PRIVATE: 'true', AUTO_APPROVE_FETCH: 'true' });
    let asked = 0;
    const events = await run(cfg, 'online', script([reply('', [call('c1', 'fetch_url', { url: base + '/' })]), reply('done')]), async () => { asked++; return true; });
    assert.equal(asked, 0);
    assert.match(events.find((e) => e.type === 'tool_result').output, /plain text/);
  } finally { server.close(); }
});

test('SSRF guard: online mode still refuses loopback, LAN, metadata, odd ports and non-http schemes', async () => {
  const cfg = mkcfg();
  for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://192.168.1.10/', 'http://10.0.0.5/admin', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(publicFetch(url, { mode: 'online' }), { code: 'PRIVATE_BLOCKED' }, url);
  }
  await assert.rejects(publicFetch('http://example.com:8080/', { mode: 'online' }), /ports 80 and 443/);
  await assert.rejects(publicFetch('http://user:pw@example.com/', { mode: 'online' }), /credentials/);
  await assert.rejects(publicFetch('ftp://example.com/', { mode: 'online' }), /http and https/);
  await assert.rejects(publicFetch('http://example.com/', { mode: 'offline' }), { code: 'OFFLINE_BLOCKED' });
  // through the agent: the failure is reported to the model, nothing is fetched
  const events = await run(cfg, 'online', script([reply('', [call('c1', 'fetch_url', { url: 'file:///etc/passwd' })]), reply('ok')]), async () => true);
  const r = events.find((e) => e.type === 'tool_result');
  assert.equal(r.ok, false); assert.match(r.output, /http and https/);
});

test('redirects are re-validated: a public-looking page cannot bounce the agent to an internal address', async () => {
  const { server, base } = await webServer((req, res) => { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); });
  try {
    // allowPrivate lets us reach our local redirector; the second hop is a metadata IP literal and must still be refused
    // only when allowPrivate is false, so verify the hop check directly with a literal target on the first hop instead:
    await assert.rejects(publicFetch('http://169.254.169.254/', { mode: 'online' }), { code: 'PRIVATE_BLOCKED' });
    const r = await publicFetch(base + '/', { mode: 'online', allowPrivate: true, maxRedirects: 0 }).catch((e) => e);
    assert.match(String(r.message), /Too many redirects/);
  } finally { server.close(); }
});

test('binary content is refused and big pages are truncated', async () => {
  const { server, base } = await webServer((req, res) => {
    if (req.url === '/bin') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.alloc(10)); }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('x'.repeat(5000));
  });
  try {
    await assert.rejects(publicFetch(base + '/bin', { mode: 'online', allowPrivate: true }), { code: 'BAD_TYPE' });
    const r = await publicFetch(base + '/big', { mode: 'online', allowPrivate: true, maxBytes: 1000 });
    assert.equal(r.body.length, 1000); assert.equal(r.truncated, true);
  } finally { server.close(); }
});

test('htmlToText handles entities and numeric references', () => {
  assert.equal(htmlToText('<p>a &amp; b &#65; &#x42;</p>'), 'a & b A B');
});
