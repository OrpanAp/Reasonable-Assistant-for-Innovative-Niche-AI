'use strict';
// Talks to any local server exposing the OpenAI-style /v1/chat/completions
// endpoint (Ollama, llama.cpp llama-server, LM Studio...). Any other provider
// only has to export the same streamChat() and complete() functions.
const { guardedFetch } = require('../netguard');

async function post(cfg, mode, payload, signal) {
  let res;
  try {
    res = await guardedFetch(`${cfg.localUrl}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.localModel, ...payload }), signal,
    }, mode);
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'OFFLINE_BLOCKED') throw err;
    const e = new Error(`Cannot reach the local model server at ${cfg.localUrl}. Is it running?`);
    e.code = 'MODEL_UNREACHABLE';
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const e = new Error(`Model server returned ${res.status}. ${text.slice(0, 200)}`);
    e.code = 'MODEL_ERROR';
    e.status = res.status;
    throw e;
  }
  return res;
}

async function* streamChat({ cfg, mode, messages, signal }) {
  const res = await post(cfg, mode, { stream: true, messages: [{ role: 'system', content: cfg.systemPrompt }, ...messages] }, signal);
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* ignore malformed keep-alive lines */ }
    }
  }
}

// Non-streaming call used by the agent loop. Returns { content, toolCalls }.
async function complete({ cfg, mode, system, messages, tools, signal }) {
  const payload = { stream: false, messages: [{ role: 'system', content: system }, ...messages] };
  if (tools && tools.length) payload.tools = tools;
  const res = await post(cfg, mode, payload, signal);
  let j;
  try { j = await res.json(); } catch { const e = new Error('Model server sent an unreadable response.'); e.code = 'MODEL_ERROR'; throw e; }
  const msg = j.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map((c, i) => {
    let args = c.function?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { args = null; } }
    return { id: c.id || `call_${i}`, name: c.function?.name, args: args ?? null };
  });
  return { content: msg.content || '', toolCalls };
}

module.exports = { streamChat, complete };
