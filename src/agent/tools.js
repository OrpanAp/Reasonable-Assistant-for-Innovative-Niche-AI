'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class ToolError extends Error {}

const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// Resolve a model-supplied path and guarantee it stays inside the workspace,
// including through symlinks (even broken ones).
function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new ToolError('Invalid path.');
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new ToolError('Path is outside the workspace.');
  let probe = abs;
  while (!lexists(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let realProbe, realRoot;
  try { realProbe = fs.realpathSync(probe); realRoot = fs.realpathSync(rootAbs); }
  catch { throw new ToolError('Unsafe path.'); }
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) throw new ToolError('Path is outside the workspace.');
  return abs;
}

function checkArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Arguments must be a JSON object.';
  for (const [k, spec] of Object.entries(schema.properties)) {
    const v = args[k];
    if (v === undefined) { if (schema.required.includes(k)) return `Missing required argument "${k}".`; continue; }
    if (spec.type === 'string' && typeof v !== 'string') return `Argument "${k}" must be a string.`;
    if (spec.type === 'array' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) return `Argument "${k}" must be an array of strings.`;
  }
  return null;
}

function minimalEnv(root) {
  const env = { PATH: process.env.PATH, HOME: root, USERPROFILE: root, TEMP: root, TMP: root, SystemRoot: process.env.SystemRoot, LANG: 'C.UTF-8' };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env; // deliberately excludes API keys and other secrets from the parent environment
}

function runProcess(command, args, ctx) {
  return new Promise((resolve) => {
    const { cfg, root, signal } = ctx;
    let out = '', truncated = false, timedOut = false;
    const child = spawn(command, args, { cwd: root, env: minimalEnv(root), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (b) => { if (out.length < cfg.cmdOutputMax) out += b.toString('utf8'); else truncated = true; };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, cfg.commandTimeoutMs);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: `Could not start "${command}": ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const head = timedOut ? `Timed out after ${cfg.commandTimeoutMs} ms and was killed.` : `Exit code ${code}.`;
      resolve({ ok: !timedOut && code === 0, output: `${head}\n${out.slice(0, cfg.cmdOutputMax)}${truncated ? '\n[output truncated]' : ''}` });
    });
  });
}

function createRegistry(cfg) {
  const root = path.resolve(cfg.workspaceDir);
  fs.mkdirSync(root, { recursive: true });
  const tools = new Map();
  const add = (t) => tools.set(t.name, t);

  add({
    name: 'list_dir', risk: 'safe',
    description: 'List files and folders in a workspace directory.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path; "." is the workspace root' } }, required: [] },
    describe: (a) => `List ${a.path || '.'}`,
    async run(a, ctx) {
      const dir = resolveInside(ctx.root, a.path || '.');
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { throw new ToolError('Not a readable directory.'); }
      const lines = entries.slice(0, 200).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
      return { ok: true, output: lines.length ? lines.join('\n') : '(empty directory)' };
    },
  });

  add({
    name: 'read_file', risk: 'safe',
    description: 'Read a UTF-8 text file from the workspace.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative file path' } }, required: ['path'] },
    describe: (a) => `Read ${a.path}`,
    async run(a, ctx) {
      const file = resolveInside(ctx.root, a.path);
      let st;
      try { st = fs.statSync(file); } catch { throw new ToolError('File not found.'); }
      if (!st.isFile()) throw new ToolError('Not a file.');
      if (st.size > ctx.cfg.maxFileBytes) throw new ToolError(`File too large (${st.size} bytes, max ${ctx.cfg.maxFileBytes}).`);
      return { ok: true, output: fs.readFileSync(file, 'utf8') };
    },
  });

  add({
    name: 'write_file', risk: 'approval',
    description: 'Create or overwrite a text file in the workspace (parent folders are created). Needs user approval.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative file path' }, content: { type: 'string', description: 'Full file content' } }, required: ['path', 'content'] },
    describe(a, ctx) {
      const file = resolveInside(ctx.root, a.path);
      return `${lexists(file) ? 'Overwrite' : 'Create'} ${a.path} (${Buffer.byteLength(a.content)} bytes)`;
    },
    async run(a, ctx) {
      if (Buffer.byteLength(a.content) > ctx.cfg.maxFileBytes) throw new ToolError(`Content too large (max ${ctx.cfg.maxFileBytes} bytes).`);
      const file = resolveInside(ctx.root, a.path);
      if (lexists(file) && fs.lstatSync(file).isDirectory()) throw new ToolError('That path is a directory.');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      resolveInside(ctx.root, a.path); // re-check after creating parents
      fs.writeFileSync(file, a.content);
      return { ok: true, output: `Wrote ${Buffer.byteLength(a.content)} bytes to ${a.path}.` };
    },
  });

  add({
    name: 'run_command', risk: 'approval',
    description: `Run an allowed program inside the workspace, e.g. command "node", args ["--test"]. Allowed: ${cfg.allowedCommands.join(', ')}. Always needs user approval.`,
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Program name only, no paths' }, args: { type: 'array', description: 'Arguments as an array of strings' } }, required: ['command'] },
    describe(a) { return `Run: ${a.command} ${(a.args || []).join(' ')}`.trim(); },
    async run(a, ctx) {
      const args = a.args || [];
      if (!ctx.cfg.allowedCommands.includes(a.command)) throw new ToolError(`Command "${a.command}" is not allowed. Allowed: ${ctx.cfg.allowedCommands.join(', ')}.`);
      if (args.length > 20 || args.some((x) => x.length > 500 || x.includes('\0'))) throw new ToolError('Too many or too long arguments.');
      return runProcess(a.command, args, ctx);
    },
  });

  return {
    root,
    has: (n) => tools.has(n),
    get: (n) => tools.get(n),
    list: () => [...tools.values()],
    validate: (tool, args) => checkArgs(tool.parameters, args),
    schemas: () => [...tools.values()].map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
}

module.exports = { createRegistry, resolveInside, ToolError };
