'use strict';
// Regression tests for how the agent behaves with real (sloppy) models and real web pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { load } = require('../src/config');
const { createRegistry, htmlToText } = require('../src/agent/tools');
const { runAgent, parseTextCall, tidyArgs, splitCommand } = require('../src/agent/loop');
const { createAudit } = require('../src/agent/audit');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rain-rob-'));
const mkcfg = (over = {}) => load({ PORT: '0', WORKSPACE_DIR: tmp(), ...over });
const script = (steps) => ({ complete: async () => { const s = steps.shift(); if (!s) throw new Error('script exhausted'); return s; } });
const call = (id, name, args) => ({ id, name, args });
const reply = (content, toolCalls = []) => ({ content, toolCalls });
const yes = async () => true;

async function run(cfg, mode, provider, approve = yes) {
  const events = [];
  await runAgent({ cfg, mode, messages: [{ role: 'user', content: 'go' }], registry: createRegistry(cfg), provider, emit: (e) => events.push(e), approve, audit: createAudit(null), signal: new AbortController().signal });
  return events;
}
const results = (events) => events.filter((e) => e.type === 'tool_result');

test('write -> run -> fix -> run the SAME command works (the fix can be re-tested)', async () => {
  const node = { command: 'node', args: ['app.js'] };
  const events = await run(mkcfg(), 'offline', script([
    reply('', [call('a', 'write_file', { path: 'app.js', content: 'process.exit(3)' })]),
    reply('', [call('b', 'run_command', node)]),
    reply('', [call('c', 'write_file', { path: 'app.js', content: 'console.log("fixed")' })]),
    reply('', [call('d', 'run_command', node)]),
    reply('Fixed.'),
  ]));
  const r = results(events);
  assert.equal(r[1].ok, false);               // first run fails (exit 3)
  assert.equal(r[3].ok, true);                // identical command after the fix is NOT rejected as a repeat
  assert.match(r[3].output, /fixed/);
  assert.match(events.find((e) => e.delta).delta, /Fixed/);
});

test('an identical call with nothing changed in between is still refused', async () => {
  const same = call('x', 'list_dir', { path: '.' });
  const events = await run(mkcfg(), 'offline', script([reply('', [same]), reply('', [{ ...same, id: 'y' }]), reply('done')]));
  assert.equal(results(events)[1].ok, false);
  assert.match(results(events)[1].output, /already made this exact call/);
});

test('parseTextCall understands the tool-call shapes real models print', () => {
  const reg = createRegistry(mkcfg());
  const want = { name: 'list_dir', args: { path: '.' } };
  const shapes = [
    '```json\n{"tool":"list_dir","args":{"path":"."}}\n```',
    '{"name":"list_dir","parameters":{"path":"."}}',
    '{"name":"list_dir","arguments":{"path":"."}}',
    '{"name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}',
    '<tool_call>\n{"name": "list_dir", "arguments": {"path": "."}}\n</tool_call>',
    '{"function":{"name":"list_dir","arguments":"{\\"path\\":\\".\\"}"}}',
    '{"tool_calls":[{"function":{"name":"list_dir","arguments":{"path":"."}}}]}',
    'Sure, let me look.\n```\n{"name":"list_dir","parameters":{"path":"."}}\n```\nThen I will continue.',
    'I will call {"name":"list_dir","parameters":{"path":"."}} now.',
  ];
  for (const s of shapes) {
    const c = parseTextCall(s, reg);
    assert.ok(c, `should parse: ${s}`);
    assert.equal(c.name, want.name); assert.deepEqual(c.args, want.args);
  }
});

test('parseTextCall still ignores prose, unknown tools, and JSON that is not a call', () => {
  const reg = createRegistry(mkcfg());
  for (const s of ['just text', '{"tool":"format_disk","args":{}}', '{"name":"Alice","age":3}', '[1,2,3]', '{"name":"list_dir","arguments":"not json"}', '{broken']) {
    assert.equal(parseTextCall(s, reg), null, s);
  }
  assert.equal(parseTextCall('{"name":"list_dir"}', reg).name, 'list_dir'); // args are optional for list_dir
});

test('a text-mode model gets unique call ids, so approval and result cards cannot collide', async () => {
  const events = await run(mkcfg(), 'offline', script([
    reply('{"name":"list_dir","parameters":{"path":"."}}'),
    reply('{"name":"list_dir","parameters":{"path":"./"}}'),
    reply('{"name":"read_file","parameters":{"path":"zzz"}}'),
    reply('end'),
  ]));
  const ids = events.filter((e) => e.type === 'tool_call').map((e) => e.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((i) => i && i !== 'text_call'));
});

test('sloppy run_command / fetch_url arguments are repaired (still allow-listed, never a shell)', async () => {
  assert.deepEqual(splitCommand('node -e "console.log(1 + 2)" \'a b\''), ['node', '-e', 'console.log(1 + 2)', 'a b']);
  assert.deepEqual(tidyArgs('run_command', { command: 'node app.js --port 8080' }), { command: 'node', args: ['app.js', '--port', '8080'] });
  assert.deepEqual(tidyArgs('run_command', { command: 'node', args: 'a.js "b c"' }), { command: 'node', args: ['a.js', 'b c'] });
  assert.deepEqual(tidyArgs('run_command', { command: 'node', args: ['x.js', 8080, true] }).args, ['x.js', '8080', 'true']);
  assert.equal(tidyArgs('fetch_url', { url: ' example.com/docs ' }).url, 'https://example.com/docs');
  assert.equal(tidyArgs('fetch_url', { url: 'http://a.test/x' }).url, 'http://a.test/x');
  assert.equal(tidyArgs('fetch_url', { url: 'file:///etc/passwd' }).url, 'file:///etc/passwd'); // never "fixed" into something else
  assert.equal(tidyArgs('write_file', { path: 'a b.txt', content: 'x' }).path, 'a b.txt');         // other tools untouched

  const ws = mkcfg();
  fs.writeFileSync(path.join(ws.workspaceDir, 'app.js'), 'console.log("hi " + process.argv.slice(2).join("+"))');
  const ev = await run(ws, 'offline', script([reply('', [call('1', 'run_command', { command: 'node app.js a b' })]), reply('ok')]));
  assert.match(results(ev)[0].output, /hi a\+b/);
  // The allow-list still applies to a repaired command.
  const denied = await run(mkcfg(), 'offline', script([reply('', [call('1', 'run_command', { command: 'rm -rf /' })]), reply('ok')]));
  assert.equal(results(denied)[0].ok, false);
  assert.match(results(denied)[0].output, /not allowed/);
});

test('fetch_url without a scheme is retried as https and still passes the public-internet guard', async () => {
  const ev = await run(mkcfg(), 'online', script([reply('', [call('1', 'fetch_url', { url: '127.0.0.1.nip.invalid/x' })]), reply('ok')]), yes);
  const approval = ev.find((e) => e.type === 'approval');
  assert.match(approval.summary, /^Fetch https:\/\/127\.0\.0\.1\.nip\.invalid\/x$/);
});

test('htmlToText keeps links (resolved against the page) so the agent can follow them', () => {
  const html = '<title>Docs</title><nav><a href="/guide/install">Install guide</a> | <a href="https://ex.com/x?a=1&amp;b=2">External</a> | <a href="#top">Top</a> <a href="javascript:void(0)">Menu</a> <a href="mailto:a@b.c">Mail</a></nav>' +
    '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frealsite.org%2Fpage&amp;rut=abc"><b>Real</b> result</a> <a href="/img"><img src="x.png"></a> <a href="https://same.org">https://same.org</a>';
  const t = htmlToText(html, 'https://site.test/docs/index.html');
  assert.match(t, /Install guide \(https:\/\/site\.test\/guide\/install\)/);
  assert.match(t, /External \(https:\/\/ex\.com\/x\?a=1&b=2\)/);
  assert.match(t, /Real result \(https:\/\/realsite\.org\/page\)/);   // search-engine redirect unwrapped
  assert.match(t, /\bTop\b(?! \()/); assert.doesNotMatch(t, /javascript:|mailto:/);
  assert.doesNotMatch(t, /\(https:\/\/same\.org\)/);                 // no "url (url)" duplication
  assert.doesNotMatch(htmlToText('<a href="/rel">Rel</a>'), /\(/);   // relative link with no base: text only
});

test('fetch_url output includes followable links end to end', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><title>T</title><body><a href="/next">Next page</a></body></html>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/start`;
    const cfg = mkcfg({ FETCH_ALLOW_PRIVATE: 'true' });
    const ev = await run(cfg, 'online', script([reply('', [call('1', 'fetch_url', { url })]), reply('done')]), yes);
    assert.match(results(ev)[0].output, /Next page \(http:\/\/127\.0\.0\.1:\d+\/next\)/);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});

test('default step budget leaves room for write, run, fix, re-run and summarise', () => {
  assert.ok(mkcfg().agentMaxSteps >= 10);
});

test('a malformed tool-call attempt is retried instead of being shown as the answer', async () => {
  // Real small-model output: broken JSON (missing colon after "parameters"), a path outside the workspace.
  const garbage = '{"name":"write_file","parameters{"content":"I can improve.","path":"../models/RAI.json"}}';
  const seenByModel = [];
  const provider = { complete: async ({ messages }) => {
    seenByModel.push(messages.at(-1).content);
    return seenByModel.length === 1 ? reply(garbage) : reply('You can improve me with better prompts and a larger model.');
  } };
  const events = await run(mkcfg(), 'offline', provider);
  assert.equal(events.filter((e) => e.type === 'tool_call').length, 0);              // nothing executed
  assert.match(seenByModel[1], /not valid JSON/);                                     // model was told what went wrong
  const answer = events.find((e) => e.delta).delta;
  assert.match(answer, /larger model/);
  assert.doesNotMatch(answer, /parameters\{/);                                        // the garbage never reaches the user
});

test('a model that keeps producing broken tool calls gets a clear message, not raw JSON', async () => {
  const provider = { complete: async () => reply('{"tool":"read_file","args{"path":"x"}}') };
  const events = await run(mkcfg(), 'offline', provider);
  const answer = events.find((e) => e.delta).delta;
  assert.match(answer, /malformed tool calls/);
  assert.doesNotMatch(answer, /read_file/);
});

test('ordinary answers that merely mention a tool or a name are not treated as tool calls', async () => {
  const text = 'I can use read_file to open files. My name is R.A.I.N. and the "name" field is optional.';
  const events = await run(mkcfg(), 'offline', script([reply(text)]));
  assert.equal(events.find((e) => e.delta).delta, text);
});

test('install consistency: src/netguard.js exports what src/agent/tools.js imports', () => {
  assert.equal(typeof require('../src/netguard').publicFetch, 'function');
  assert.equal(typeof require('../src/netguard').guardedFetch, 'function');
});
