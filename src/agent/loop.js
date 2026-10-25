'use strict';
const crypto = require('node:crypto');
const { ToolError } = require('./tools');

const RULES = 'You can use tools to read, write and run code inside a private workspace folder. Use relative paths only. ' +
  'Work step by step: inspect before editing, create files with write_file, run tests or scripts with run_command when relevant, and read failures carefully before fixing them. ' +
  'When the task is complete, reply with a short plain-language summary and no tool call. ' +
  'Never claim you ran or changed something unless a tool result confirms it.';

function systemPrompt(cfg, registry, textMode) {
  let s = `${cfg.systemPrompt}\n\n${RULES}`;
  if (textMode) {
    s += '\n\nTo use a tool, reply with ONLY a JSON object in a ```json block, for example {"tool":"list_dir","args":{"path":"."}}. One tool per reply. Available tools:\n' +
      registry.list().map((t) => `- ${t.name}: ${t.description} Arguments: ${JSON.stringify(t.parameters.properties)}`).join('\n');
  }
  return s;
}

// Fallback for models without native tool calling: find {"tool":..., "args":{...}} in text.
function parseTextCall(content, registry) {
  if (!content) return null;
  const candidates = [];
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(content.trim());
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o.tool === 'string' && registry.has(o.tool) && o.args && typeof o.args === 'object') return { id: 'text_call', name: o.tool, args: o.args };
    } catch { /* not JSON */ }
  }
  return null;
}

function toWire(convo, textMode) {
  const out = [];
  for (const m of convo) {
    if (m.role === 'assistant' && m.calls?.length) {
      if (textMode) out.push({ role: 'assistant', content: m.content || JSON.stringify({ tool: m.calls[0].name, args: m.calls[0].args }) });
      else out.push({ role: 'assistant', content: m.content || '', tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) });
    } else if (m.role === 'tool') {
      if (textMode) out.push({ role: 'user', content: `Result of ${m.name}:\n${m.content}` });
      else out.push({ role: 'tool', tool_call_id: m.id, content: m.content });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + `\n[truncated ${String(s).length - n} chars]` : String(s));
function preview(args) {
  if (!args || typeof args !== 'object') return args;
  const o = {};
  for (const [k, v] of Object.entries(args)) o[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + `… (${v.length} chars)` : v;
  return o;
}
const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });

async function runAgent({ cfg, mode, messages, registry, provider, emit, approve, audit, signal }) {
  const ctx = { cfg, root: registry.root, signal };
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const seen = new Set();
  let textMode = false, repeats = 0;

  async function execCall(call) {
    emit({ type: 'tool_call', id: call.id, name: call.name, args: preview(call.args) });
    const finish = (ok, output) => { emit({ type: 'tool_result', id: call.id, ok, output: clip(output, 2000) }); return { ok, content: clip(output, cfg.toolOutputMax) }; };
    const tool = registry.get(call.name);
    if (!tool) return finish(false, `Unknown tool "${call.name}". Available: ${registry.list().map((t) => t.name).join(', ')}.`);
    if (call.args === null) return finish(false, 'Arguments were not valid JSON.');
    const bad = registry.validate(tool, call.args);
    if (bad) return finish(false, bad);
    let summary;
    try { summary = tool.describe(call.args, ctx); } catch (e) { return finish(false, e instanceof ToolError ? e.message : 'Invalid request.'); }
    const needsApproval = tool.risk === 'approval' && !(tool.name === 'write_file' && cfg.autoApproveWrites);
    if (needsApproval) {
      const id = crypto.randomUUID();
      emit({ type: 'approval', id, callId: call.id, name: call.name, summary });
      const ok = await approve({ id, name: call.name, summary }, signal);
      audit.log({ tool: call.name, decision: ok ? 'approved' : 'denied', detail: summary });
      if (!ok) return finish(false, 'The user denied this action. Do not retry it; ask what they would like instead.');
    } else audit.log({ tool: call.name, decision: 'auto', detail: summary });
    try {
      const r = await tool.run(call.args, ctx);
      audit.log({ tool: call.name, ok: r.ok });
      return finish(r.ok, r.output);
    } catch (e) {
      if (e instanceof ToolError) { audit.log({ tool: call.name, ok: false }); return finish(false, e.message); }
      console.error(`tool ${call.name} crashed:`, e);
      audit.log({ tool: call.name, ok: false, detail: 'crashed' });
      return finish(false, 'The tool failed unexpectedly.');
    }
  }

  for (let step = 1; step <= cfg.agentMaxSteps; step++) {
    if (signal.aborted) throw abortError();
    emit({ type: 'step', n: step });
    let r;
    try {
      r = await provider.complete({ cfg, mode, system: systemPrompt(cfg, registry, textMode), messages: toWire(convo, textMode), tools: textMode ? undefined : registry.schemas(), signal });
    } catch (err) {
      if (!textMode && err.code === 'MODEL_ERROR' && err.status === 400) { textMode = true; step--; continue; } // model has no native tool support
      throw err;
    }
    let calls = r.toolCalls || [];
    if (!calls.length) { const t = parseTextCall(r.content, registry); if (t) calls = [t]; }
    if (!calls.length) { emit({ delta: r.content || '(The model returned an empty response.)' }); emit({ done: true }); return; }

    calls = calls.slice(0, textMode ? 1 : cfg.agentMaxCallsPerStep);
    convo.push({ role: 'assistant', content: r.content || '', calls });
    for (const call of calls) {
      const key = call.name + JSON.stringify(call.args);
      let res;
      if (seen.has(key)) {
        repeats++;
        emit({ type: 'tool_call', id: call.id, name: call.name, args: preview(call.args) });
        res = { ok: false, content: 'You already made this exact call. Use a different approach or finish with a summary.' };
        emit({ type: 'tool_result', id: call.id, ok: false, output: res.content });
      } else { seen.add(key); res = await execCall(call); }
      convo.push({ role: 'tool', id: call.id, name: call.name, content: res.content });
    }
    if (repeats >= 3) { emit({ delta: 'Stopped: the model kept repeating the same actions.' }); emit({ done: true }); return; }
    if (convo.reduce((n, m) => n + (m.content || '').length, 0) > cfg.agentMaxContextChars) {
      emit({ delta: 'Stopped: the task grew too large for the model\'s context. Try a smaller task.' }); emit({ done: true }); return;
    }
  }
  emit({ delta: `Stopped after ${cfg.agentMaxSteps} steps without finishing. Ask me to continue if you want me to keep going.` });
  emit({ done: true });
}

module.exports = { runAgent, parseTextCall, toWire };
