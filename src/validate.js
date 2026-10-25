'use strict';

function trimContext(msgs, maxChars) {
  let total = 0;
  const out = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    total += msgs[i].content.length;
    if (total > maxChars && out.length > 0) break; // always keep the newest message
    out.unshift(msgs[i]);
  }
  return out;
}

function validateChat(body, cfg) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object.' };
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) return { error: 'messages must be a non-empty array.' };
  if (messages.length > cfg.maxMessages) return { error: `Too many messages (max ${cfg.maxMessages}).` };
  const clean = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') return { error: 'Each message must be an object.' };
    if (m.role !== 'user' && m.role !== 'assistant') return { error: 'Message role must be "user" or "assistant".' };
    if (typeof m.content !== 'string' || m.content.trim() === '') return { error: 'Message content must be a non-empty string.' };
    if (m.content.length > cfg.maxMessageChars) return { error: `Message too long (max ${cfg.maxMessageChars} characters).` };
    clean.push({ role: m.role, content: m.content });
  }
  if (clean[clean.length - 1].role !== 'user') return { error: 'The last message must be from the user.' };
  return { messages: trimContext(clean, cfg.maxContextChars) };
}

module.exports = { validateChat, trimContext };
