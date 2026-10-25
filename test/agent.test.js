'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../src/config');
const { createRegistry, resolveInside } = require('../src/agent/tools');
const { runAgent, parseTextCall } = require('../src/agent/loop');
const { createAudit } = require('../src/agent/audit');
const { createApp } = require('../src/server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rain-ws-'));
const mkcfg = (ws, over = {}) => load({ PORT: '0', WORKSPACE_DIR: ws, ...over });
const script = (steps) => ({ complete: async () => { const s = steps.shift(); if (!s) throw new Error('script exhausted'); return s; } });
const call = (id, name, args) => ({ id, name, args });
const reply = (content, toolCalls = []) => ({ content, toolCalls });

async function run(cfg, provider, approve, messages = [{ role: 'user', content: 'go' }]) {
  const events = [];
  const registry = createRegistry(cfg);
  await runAgent({ cfg, mode: 'offline', messages, registry, provider, emit: (e) => events.push(e), approve, audit: createAudit(null), signal: new AbortController().signal });
  return events;
}
const yes = async () => true;
const no = async () => false;

test('resolveInside blocks traversal, absolute paths and symlink escapes', () => {
  const ws = tmp(); const outside = tmp();
  assert.ok(resolveInside(ws, 'a/b.txt').startsWith(ws));
  assert.throws(() => resolveInside(ws, '../x'), /outside/);
  assert.throws(() => resolveInside(ws, '/etc/passwd'), /outside/);
  assert.throws(() => resolveInside(ws, 'a\0b'), /Invalid/);
  fs.symlinkSync(outside, path.join(ws, 'link'));
  assert.throws(() => resolveInside(ws, 'link/secret.txt'), /outside/);
  fs.symlinkSync(path.join(outside, 'nope.txt'), path.join(ws, 'broken'));
  assert.throws(() => resolveInside(ws, 'broken'), /Unsafe|outside/);
});

test('registry exposes OpenAI-style schemas and validates arguments', () => {
  const reg = createRegistry(mkcfg(tmp()));
  assert.deepEqual(reg.schemas().map((s) => s.function.name).sort(), ['list_dir', 'read_file', 'run_command', 'write_file']);
  assert.match(reg.validate(reg.get('write_file'), { path: 'a' }), /content/);
  assert.match(reg.validate(reg.get('read_file'), { path: 5 }), /string/);
  assert.match(reg.validate(reg.get('run_command'), { command: 'node', args: 'x' }), /array/);
  assert.equal(reg.validate(reg.get('list_dir'), {}), null);
});

test('approved write then approved run completes a task end to end', async () => {
  const ws = tmp(); const cfg = mkcfg(ws);
  const approvals = [];
  const events = await run(cfg, script([
    reply('', [call('c1', 'write_file', { path: 'hello.js', content: 'console.log(40 + 2)' })]),
    reply('', [call('c2', 'run_command', { command: 'node', args: ['hello.js'] })]),
    reply('Done: it prints 42.'),
  ]), async (r) => { approvals.push(r.name); return true; });
  assert.deepEqual(approvals, ['write_file', 'run_command']);
  assert.equal(fs.readFileSync(path.join(ws, 'hello.js'), 'utf8'), 'console.log(40 + 2)');
  const runResult = events.find((e) => e.type === 'tool_result' && e.id === 'c2');
  assert.ok(runResult.ok); assert.match(runResult.output, /42/);
  assert.equal(events.filter((e) => e.delta).map((e) => e.delta).join(''), 'Done: it prints 42.');
  assert.deepEqual(events.at(-1), { done: true });
});

test('a denied write does nothing and tells the model', async () => {
  const ws = tmp();
  let seenByModel = '';
  const provider = { complete: async ({ messages }) => {
    const last = messages.at(-1);
    if (last.role === 'tool') { seenByModel = last.content; return reply('Okay, I will not write it.'); }
    return reply('', [call('c1', 'write_file', { path: 'x.txt', content: 'hi' })]);
  } };
  const events = await run(mkcfg(ws), provider, no);
  assert.equal(fs.existsSync(path.join(ws, 'x.txt')), false);
  assert.match(seenByModel, /denied/);
  assert.equal(events.find((e) => e.type === 'tool_result').ok, false);
});

test('safe tools run without approval; path escapes come back as tool errors', async () => {
  const ws = tmp(); fs.writeFileSync(path.join(ws, 'a.txt'), 'hello');
  let asked = 0;
  const events = await run(mkcfg(ws), script([
    reply('', [call('1', 'list_dir', {}), call('2', 'read_file', { path: 'a.txt' }), call('3', 'read_file', { path: '../../etc/passwd' })]),
    reply('finished'),
  ]), async () => { asked++; return true; });
  assert.equal(asked, 0);
  const res = Object.fromEntries(events.filter((e) => e.type === 'tool_result').map((e) => [e.id, e]));
  assert.match(res['1'].output, /a\.txt/); assert.equal(res['2'].output, 'hello');
  assert.equal(res['3'].ok, false); assert.match(res['3'].output, /outside/);
});

test('run_command rejects programs that are not allow-listed and times out runaway processes', async () => {
  const ws = tmp();
  const bad = await run(mkcfg(ws), script([reply('', [call('1', 'run_command', { command: 'rm', args: ['-rf', '.'] })]), reply('ok')]), yes);
  assert.match(bad.find((e) => e.type === 'tool_result').output, /not allowed/);
  const slow = await run(mkcfg(ws, { COMMAND_TIMEOUT_MS: '300' }), script([
    reply('', [call('1', 'run_command', { command: 'node', args: ['-e', 'setTimeout(()=>{},60000)'] })]), reply('ok')]), yes);
  const r = slow.find((e) => e.type === 'tool_result');
  assert.equal(r.ok, false); assert.match(r.output, /Timed out/);
});

test('child processes do not inherit secrets from the environment', async () => {
  process.env.RAIN_TEST_SECRET = 'topsecret';
  try {
    const ev = await run(mkcfg(tmp()), script([
      reply('', [call('1', 'run_command', { command: 'node', args: ['-e', 'console.log("S=" + (process.env.RAIN_TEST_SECRET || "none"))'] })]), reply('ok')]), yes);
    assert.match(ev.find((e) => e.type === 'tool_result').output, /S=none/);
  } finally { delete process.env.RAIN_TEST_SECRET; }
});

test('the loop stops at the step limit and on repeated identical calls', async () => {
  const ws = tmp();
  let n = 0;
  const walker = { complete: async () => reply('', [call('c' + n, 'list_dir', { path: '.' + '/'.repeat(++n) })]) };
  const capped = await run(mkcfg(ws, { AGENT_MAX_STEPS: '3' }), walker, yes);
  assert.equal(capped.filter((e) => e.type === 'step').length, 3);
  assert.match(capped.find((e) => e.delta).delta, /Stopped after 3 steps/);
  const looper = { complete: async () => reply('', [call('x', 'list_dir', { path: '.' })]) };
  const repeated = await run(mkcfg(ws), looper, yes);
  assert.match(repeated.find((e) => e.delta).delta, /repeating/);
});

test('falls back to text tool calls when the model has no native tool support', async () => {
  const ws = tmp(); fs.writeFileSync(path.join(ws, 'n.txt'), 'note');
  const seenTools = [];
  const provider = { complete: async ({ tools, messages }) => {
    seenTools.push(!!tools);
    if (tools) { const e = new Error('Model server returned 400.'); e.code = 'MODEL_ERROR'; e.status = 400; throw e; }
    if (messages.at(-1).role === 'user' && /Result of read_file/.test(messages.at(-1).content)) return reply('The note says "note".');
    return reply('```json\n{"tool":"read_file","args":{"path":"n.txt"}}\n```');
  } };
  const events = await run(mkcfg(ws), provider, yes);
  assert.deepEqual(seenTools.slice(0, 2), [true, false]);
  assert.equal(events.find((e) => e.type === 'tool_result').output, 'note');
  assert.match(events.find((e) => e.delta).delta, /note/);
});

test('parseTextCall ignores unknown tools and plain prose', () => {
  const reg = createRegistry(mkcfg(tmp()));
  assert.equal(parseTextCall('just text', reg), null);
  assert.equal(parseTextCall('{"tool":"format_disk","args":{}}', reg), null);
  assert.equal(parseTextCall('{"tool":"list_dir","args":{}}', reg).name, 'list_dir');
});

// ---- HTTP integration ----
async function readStream(res, onEvent) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const events = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) { const ev = JSON.parse(l); events.push(ev); await onEvent?.(ev); } }
  }
  return events;
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const close = (srv) => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); });
const postJson = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP: /api/agent pauses for approval and resumes after /api/approve', async () => {
  const ws = tmp();
  const provider = script([reply('', [call('c1', 'write_file', { path: 'a.txt', content: 'hi' })]), reply('All done.')]);
  const app = createApp(mkcfg(ws), { provider, settingsFile: null, auditFile: null, quiet: true });
  const port = await listen(app); const base = `http://127.0.0.1:${port}`;
  try {
    const res = await postJson(`${base}/api/agent`, { messages: [{ role: 'user', content: 'write a.txt' }] });
    assert.equal(res.status, 200);
    let fileExistedAtApproval = null;
    const events = await readStream(res, async (ev) => {
      if (ev.type === 'approval') {
        fileExistedAtApproval = fs.existsSync(path.join(ws, 'a.txt'));
        assert.equal((await postJson(`${base}/api/approve`, { id: ev.id, approve: true })).status, 200);
      }
    });
    assert.equal(fileExistedAtApproval, false);
    assert.equal(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8'), 'hi');
    assert.equal(events.find((e) => e.delta).delta, 'All done.');
    assert.equal((await postJson(`${base}/api/approve`, { id: 'nope', approve: true })).status, 404);
    assert.equal((await postJson(`${base}/api/approve`, { id: 5 })).status, 400);
  } finally { await close(app); }
});

test('HTTP: unanswered approval times out as a denial, and a second task is refused while one runs', async () => {
  const ws = tmp();
  const provider = script([reply('', [call('c1', 'write_file', { path: 'a.txt', content: 'hi' })]), reply('Skipped.')]);
  const app = createApp(mkcfg(ws, { APPROVAL_TIMEOUT_MS: '400' }), { provider, settingsFile: null, auditFile: null, quiet: true });
  const port = await listen(app); const base = `http://127.0.0.1:${port}`;
  try {
    const res = await postJson(`${base}/api/agent`, { messages: [{ role: 'user', content: 'x' }] });
    const events = await readStream(res, async (ev) => {
      if (ev.type === 'approval') assert.equal((await postJson(`${base}/api/agent`, { messages: [{ role: 'user', content: 'y' }] })).status, 409);
    });
    assert.equal(fs.existsSync(path.join(ws, 'a.txt')), false);
    assert.equal(events.find((e) => e.type === 'tool_result').ok, false);
    assert.equal(events.find((e) => e.delta).delta, 'Skipped.');
  } finally { await close(app); }
});

test('HTTP: audit log records decisions but never file contents', async () => {
  const ws = tmp(); const auditFile = path.join(tmp(), 'audit.log');
  const provider = script([reply('', [call('c1', 'write_file', { path: 'k.txt', content: 'PRIVATE-CONTENT' })]), reply('ok')]);
  const app = createApp(mkcfg(ws), { provider, settingsFile: null, auditFile, quiet: true });
  const port = await listen(app); const base = `http://127.0.0.1:${port}`;
  try {
    const res = await postJson(`${base}/api/agent`, { messages: [{ role: 'user', content: 'x' }] });
    await readStream(res, async (ev) => { if (ev.type === 'approval') await postJson(`${base}/api/approve`, { id: ev.id, approve: true }); });
    const log = fs.readFileSync(auditFile, 'utf8');
    assert.match(log, /"decision":"approved"/); assert.match(log, /k\.txt/);
    assert.doesNotMatch(log, /PRIVATE-CONTENT/);
  } finally { await close(app); }
});

test('local provider complete(): parses native tool_calls and reports 400 status', async () => {
  const http = require('node:http');
  const local = require('../src/providers/local');
  let rejectTools = false, lastBody;
  const model = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      lastBody = JSON.parse(b);
      if (rejectTools && lastBody.tools) { res.writeHead(400); return res.end('does not support tools'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [
        { id: 'abc', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        { type: 'function', function: { name: 'list_dir', arguments: '{bad json' } }] } }] }));
    });
  });
  const mp = await listen(model);
  const cfg = mkcfg(tmp(), { LOCAL_MODEL_URL: `http://127.0.0.1:${mp}` });
  try {
    const r = await local.complete({ cfg, mode: 'offline', system: 's', messages: [{ role: 'user', content: 'x' }], tools: createRegistry(cfg).schemas() });
    assert.equal(lastBody.stream, false); assert.ok(Array.isArray(lastBody.tools));
    assert.deepEqual(r.toolCalls[0], { id: 'abc', name: 'read_file', args: { path: 'a.txt' } });
    assert.equal(r.toolCalls[1].args, null); // invalid JSON surfaces as null, handled by the loop
    rejectTools = true;
    await assert.rejects(local.complete({ cfg, mode: 'offline', system: 's', messages: [], tools: createRegistry(cfg).schemas() }), { code: 'MODEL_ERROR', status: 400 });
  } finally { await close(model); }
});
