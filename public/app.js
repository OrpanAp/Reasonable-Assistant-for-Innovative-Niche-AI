(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const log = $('log'), form = $('form'), input = $('input'), sendBtn = $('send'), stopBtn = $('stop');
  const modeSel = $('mode'), statusEl = $('status'), clearBtn = $('clear'), errorEl = $('error'), agentBox = $('agent');
  const KEY = 'rain.history.v1', AGENT_KEY = 'rain.agent.v1';
  let history = [];
  let controller = null;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) history = saved.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content);
    agentBox.checked = localStorage.getItem(AGENT_KEY) === '1';
  } catch { /* corrupt or unavailable storage: start fresh */ }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(history.slice(-100))); } catch { /* ignore */ } };
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const post = (url, body, signal) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

  function bubble(role, text, extra) {
    const el = document.createElement('div');
    el.className = `msg ${role}${extra ? ' ' + extra : ''}`;
    el.textContent = text; // textContent only: model output is never parsed as HTML
    log.appendChild(el);
    scroll();
    return el;
  }
  function render() {
    log.textContent = '';
    if (!history.length) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = 'Ask anything. Turn on Agent to let it read, write and run code in its workspace folder (you approve each write and command).';
      log.appendChild(e);
    }
    history.forEach((m) => bubble(m.role, m.content));
  }
  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
  const clearError = () => { errorEl.hidden = true; };
  function setBusy(b) { sendBtn.hidden = b; stopBtn.hidden = !b; input.disabled = b; agentBox.disabled = b; if (!b) input.focus(); }

  async function refreshStatus() {
    try {
      const h = await (await fetch('/api/health')).json();
      modeSel.value = h.mode;
      statusEl.textContent = h.modelReachable ? `Model ready: ${h.model}` : 'Local model not reachable';
      statusEl.className = 'status ' + (h.modelReachable ? 'ok' : 'bad');
    } catch {
      statusEl.textContent = 'Server not reachable';
      statusEl.className = 'status bad';
    }
  }

  // ---- agent event rendering ----
  const blocks = new Map();
  function toolBlock(ev, before) {
    const d = document.createElement('details');
    d.className = 'msg tool';
    const s = document.createElement('summary');
    s.textContent = `Tool: ${ev.name}`;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(ev.args, null, 2);
    d.append(s, pre);
    log.insertBefore(d, before);
    blocks.set(ev.id, d);
    scroll();
  }
  function toolResult(ev) {
    const d = blocks.get(ev.id);
    if (!d) return;
    d.classList.toggle('failed', !ev.ok);
    d.querySelector('summary').textContent += ev.ok ? ' - done' : ' - failed';
    const pre = document.createElement('pre');
    pre.textContent = ev.output;
    d.appendChild(pre);
    scroll();
  }
  function approvalCard(ev, before) {
    const card = document.createElement('div');
    card.className = 'msg approval';
    const t = document.createElement('div');
    t.textContent = `Approval needed - ${ev.summary}`;
    const row = document.createElement('div');
    row.className = 'row';
    const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Approve';
    const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Deny';
    const answer = async (approve) => {
      yes.disabled = no.disabled = true;
      try {
        const r = await post('/api/approve', { id: ev.id, approve });
        if (!r.ok) throw new Error((await r.json()).error);
        t.textContent = `${approve ? 'Approved' : 'Denied'} - ${ev.summary}`;
        row.remove();
      } catch (err) { showError(err.message || 'Could not send your answer.'); }
    };
    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    row.append(yes, no);
    card.append(t, row);
    log.insertBefore(card, before);
    scroll();
    yes.focus();
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || controller) return;
    clearError();
    if (!history.length) log.textContent = '';
    history.push({ role: 'user', content: text });
    bubble('user', text);
    input.value = '';
    input.style.height = 'auto';
    const agent = agentBox.checked;
    const el = bubble('assistant', agent ? 'Working…' : '…', 'pending');
    let acc = '';
    controller = new AbortController();
    setBusy(true);
    try {
      const res = await post(agent ? '/api/agent' : '/api/chat', { messages: history }, controller.signal);
      if (!res.ok) {
        let msg = `Request failed (${res.status}).`;
        try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
        throw new Error(msg);
      }
      if (!agent) { el.classList.remove('pending'); el.textContent = ''; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.error) throw new Error(ev.error);
          if (ev.delta) { el.classList.remove('pending'); acc += ev.delta; el.textContent = acc; scroll(); }
          else if (ev.type === 'tool_call') toolBlock(ev, el);
          else if (ev.type === 'tool_result') toolResult(ev);
          else if (ev.type === 'approval') approvalCard(ev, el);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') showError(err.message || 'Something went wrong.');
    } finally {
      controller = null;
      if (acc) history.push({ role: 'assistant', content: acc });
      else { el.remove(); history.pop(); input.value = text; } // nothing came back: undo so you can retry
      save();
      if (!history.length) render();
      setBusy(false);
      refreshStatus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  stopBtn.addEventListener('click', () => controller && controller.abort());
  agentBox.addEventListener('change', () => { try { localStorage.setItem(AGENT_KEY, agentBox.checked ? '1' : '0'); } catch { /* ignore */ } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
  clearBtn.addEventListener('click', () => { if (controller) controller.abort(); history = []; save(); clearError(); render(); });
  modeSel.addEventListener('change', async () => {
    try {
      const r = await post('/api/mode', { mode: modeSel.value });
      if (!r.ok) throw new Error((await r.json()).error);
      clearError();
    } catch (err) { showError(err.message || 'Could not change mode.'); }
    refreshStatus();
  });

  render();
  refreshStatus();
  setInterval(refreshStatus, 15000);
})();
