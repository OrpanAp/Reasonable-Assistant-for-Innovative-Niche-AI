(() => {
  'use strict';

  /* =====================================================================
   * Tiny helpers
   * ===================================================================== */
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    wrap: '<path d="M3 6h18"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="m16 16-2 2 2 2"/><path d="M3 18h7"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    drop: '<path d="M12 2.7s6.5 6.6 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 9.3 12 2.7 12 2.7z"/>',
  };
  function icon(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    s.innerHTML = ICONS[name] || ''; // constant strings only, never model output
    return s;
  }

  function btn(label, iconName, cls, onClick, title) {
    const b = el('button', 'btn ' + (cls || ''));
    b.type = 'button';
    if (iconName) b.appendChild(icon(iconName));
    if (label) b.appendChild(el('span', 'lbl', label));
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall through to legacy path */ }
    const prev = document.activeElement;
    try {
      const ta = el('textarea', 'sr-only');
      ta.value = text; ta.setAttribute('readonly', '');
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
    finally { if (prev && prev.focus) prev.focus(); }
  }

  let toastTimer = 0;
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = el('div', 'toast', msg);
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 1600);
  }

  // A button that copies text and briefly shows a check mark.
  function copyBtn(getText, label, title) {
    const b = el('button', 'btn');
    b.type = 'button';
    b.title = title || 'Copy'; b.setAttribute('aria-label', title || 'Copy');
    const ci = icon('copy', 'ico-copy'), ck = icon('check', 'ico-check');
    b.append(ci, ck);
    let lbl = null;
    if (label) { lbl = el('span', 'lbl', label); b.appendChild(lbl); } else b.classList.add('icon-only');
    let t = 0;
    b.addEventListener('click', async () => {
      const ok = await copyText(getText());
      if (!ok) return toast('Copy failed - select the text and press Ctrl/Cmd+C');
      b.classList.add('done'); if (lbl) lbl.textContent = 'Copied';
      toast('Copied to clipboard');
      clearTimeout(t);
      t = setTimeout(() => { b.classList.remove('done'); if (lbl) lbl.textContent = label; }, 1500);
    });
    return b;
  }

  /* =====================================================================
   * Syntax highlighting (small, dependency-free, DOM-built)
   * ===================================================================== */
  const FAMILY = {
    js: 'js', javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', cjs: 'js',
    java: 'js', c: 'js', cpp: 'js', 'c++': 'js', cs: 'js', csharp: 'js', go: 'js', rust: 'js', rs: 'js', php: 'js', kotlin: 'js', swift: 'js',
    py: 'py', python: 'py', python3: 'py', rb: 'py', ruby: 'py', yaml: 'py', yml: 'py', toml: 'py', ini: 'py', env: 'py', dockerfile: 'py',
    sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', terminal: 'sh', cmd: 'sh', powershell: 'sh', ps1: 'sh',
    json: 'json', jsonc: 'json', json5: 'json',
    html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup',
    css: 'css', scss: 'css', less: 'css',
  };
  const kw = (s) => new Set(s.split(' '));
  const KW = {
    js: kw('const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this null undefined true false yield static super delete void public private protected interface type enum implements package func struct fn pub mut use mod impl trait self nil int string bool float double char byte long short'),
    py: kw('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda None True False yield async await global nonlocal self true false null'),
    sh: kw('if then else elif fi for while do done case esac in function echo cd export source sudo'),
    json: kw('true false null'),
    css: kw(''),
    markup: kw(''),
  };
  const STR = '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
  const NUM = '(?<n>\\b\\d[\\d_]*(?:\\.\\d+)?\\b)';
  const WORD = '(?<w>[A-Za-z_$][\\w$]*)';
  const mk = (parts) => new RegExp(parts.join('|'), 'g');
  const RES = {
    js: mk(['(?<c>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', '(?<s>' + STR + '|`(?:\\\\.|[^`\\\\])*`)', NUM, WORD]),
    py: mk(['(?<c>#[^\\n]*)', '(?<s>"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' + STR + ')', NUM, WORD]),
    sh: mk(['(?<c>#[^\\n]*)', '(?<s>' + STR + ')', '(?<fl>--?[A-Za-z][\\w-]*)', NUM, WORD]),
    json: mk(['(?<s>' + STR + ')', NUM, WORD]),
    css: mk(['(?<c>\\/\\*[\\s\\S]*?\\*\\/)', '(?<s>' + STR + ')', '(?<n>#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?)', '(?<w>[A-Za-z_-][\\w-]*)']),
    markup: mk(['(?<c><!--[\\s\\S]*?-->)', '(?<s>' + STR + ')', '(?<tag><\\/?[A-Za-z][\\w:-]*|\\/?>)']),
  };

  function highlightInto(parent, code, fam) {
    const add = (t, c) => {
      if (!t) return;
      if (c) parent.appendChild(el('span', 't-' + c, t)); else parent.appendChild(document.createTextNode(t));
    };
    if (!RES[fam]) return add(code);
    const re = RES[fam];
    re.lastIndex = 0;
    let last = 0, m;
    while ((m = re.exec(code))) {
      const t = m[0], g = m.groups;
      if (!t.length) { re.lastIndex++; continue; }
      add(code.slice(last, m.index));
      const prev = code[m.index - 1];
      const after = code.slice(m.index + t.length, m.index + t.length + 24);
      let c = null;
      if (g.c) c = (fam === 'py' || fam === 'sh') && prev && !/\s/.test(prev) ? null : 'com';
      else if (g.s) c = fam === 'json' && /^\s*:/.test(after) ? 'key' : 'str';
      else if (g.n) c = 'num';
      else if (g.fl) c = !prev || /\s/.test(prev) ? 'flag' : null;
      else if (g.tag) c = 'tag';
      else if (g.w) {
        if (KW[fam].has(t)) c = 'kw';
        else if (fam === 'css') c = /^\s*:/.test(after) ? 'key' : null;
        else if (after[0] === '(') c = 'fn';
      }
      add(t, c);
      last = m.index + t.length;
    }
    add(code.slice(last));
  }

  // Shell blocks: dim "$ " prompts (not selectable, not copied) and colour the command word.
  function highlightShell(parent, code) {
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      if (i) parent.appendChild(document.createTextNode('\n'));
      let rest = line;
      if (rest.startsWith('$ ')) { parent.appendChild(el('span', 't-prompt noselect', '$ ')); rest = rest.slice(2); }
      const m = /^([A-Za-z0-9_.\/~-]+)([\s\S]*)$/.exec(rest);
      if (m && !rest.startsWith('#')) {
        parent.appendChild(el('span', KW.sh.has(m[1]) ? 't-kw' : 't-fn', m[1]));
        highlightInto(parent, m[2], 'sh');
      } else highlightInto(parent, rest, 'sh');
    });
  }

  const copyPayload = (code, fam) => (fam === 'sh' ? code.replace(/^\$ /gm, '') : code);

  function codeBlock(code, lang) {
    const name = (lang || '').toLowerCase();
    const fam = FAMILY[name] || 'plain';
    const lines = code.split('\n');
    const wrap = el('div', 'codeblock');
    const head = el('div', 'code-head');
    head.appendChild(el('span', 'code-lang', name || 'text'));
    const actions = el('div', 'code-actions');
    const wrapBtn = btn('Wrap', 'wrap', '', () => {
      const on = wrap.classList.toggle('wrapped');
      wrapBtn.setAttribute('aria-pressed', String(on));
    }, 'Toggle line wrapping');
    wrapBtn.setAttribute('aria-pressed', 'false');
    actions.append(wrapBtn, copyBtn(() => copyPayload(code, fam), 'Copy', 'Copy code'));
    head.appendChild(actions);

    const pre = el('pre');
    pre.tabIndex = 0; // keyboard-scrollable
    const c = el('code');
    if (fam === 'sh') highlightShell(c, code); else highlightInto(c, code, fam);
    pre.appendChild(c);
    wrap.append(head, pre);

    if (lines.length > 26) {
      wrap.classList.add('collapsed');
      const more = el('button', 'code-more', `Show all ${lines.length} lines`);
      more.type = 'button';
      more.addEventListener('click', () => {
        const collapsed = wrap.classList.toggle('collapsed');
        more.textContent = collapsed ? `Show all ${lines.length} lines` : 'Show less';
      });
      wrap.appendChild(more);
    }
    return wrap;
  }

  /* =====================================================================
   * Markdown -> DOM (no innerHTML; model output is never parsed as HTML)
   * ===================================================================== */
  const FENCE_RE = /^(\s*)(`{3,}|~{3,})([^`\n]*)$/;
  const HEAD_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
  const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const isBlank = (l) => /^\s*$/.test(l);
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  const stripIndent = (l, n) => { let k = 0; while (k < n && (l[k] === ' ' || l[k] === '\t')) k++; return l.slice(k); };

  function readFence(lines, i, m) {
    const fence = m[2], lang = (m[3].trim().split(/\s+/)[0] || ''), ind = m[1].length;
    const close = new RegExp('^\\s*' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
    const body = [];
    i++;
    while (i < lines.length && !close.test(lines[i])) { body.push(stripIndent(lines[i], ind)); i++; }
    return { code: body.join('\n'), lang, next: i + 1 };
  }

  const safeUrl = (u) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : null);
  function linkNode(url, label) {
    const a = el('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return { a, label };
  }

  const INLINE_SRC = [
    '\\\\(?<esc>[\\\\`*_{}\\[\\]()#+.!|~>-])',
    '(?<tick>`+)(?<code>[\\s\\S]*?[^`])\\k<tick>(?!`)',
    '\\*\\*(?<b>[^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*\\*',
    '__(?<b2>[^\\s_](?:[\\s\\S]*?[^\\s_])?)__',
    '~~(?<st>[^\\s~](?:[\\s\\S]*?[^\\s~])?)~~',
    '\\*(?<i>[^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*',
    '_(?<i2>[^\\s_](?:[\\s\\S]*?[^\\s_])?)_',
    '\\[(?<lt>[^\\]\\n]+)\\]\\((?<lu>[^)\\s]+)(?:\\s+"[^"]*")?\\)',
    '(?<auto>https?:\\/\\/[^\\s<>]+)',
  ].join('|');

  function inline(parent, text) {
    const re = new RegExp(INLINE_SRC, 'g');
    const plain = (t) => {
      if (!t) return;
      t.split('\n').forEach((p, k) => {
        if (k) parent.appendChild(document.createElement('br'));
        if (p) parent.appendChild(document.createTextNode(p));
      });
    };
    let last = 0, m;
    while ((m = re.exec(text))) {
      const g = m.groups;
      if (g.i2 !== undefined) { // snake_case_words must not turn into italics
        const before = text[m.index - 1], after = text[m.index + m[0].length];
        if ((before && /\w/.test(before)) || (after && /\w/.test(after))) {
          plain(text.slice(last, m.index + 1)); last = m.index + 1; re.lastIndex = last; continue;
        }
      }
      plain(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (g.esc !== undefined) plain(g.esc);
      else if (g.code !== undefined) {
        const raw = g.code.replace(/^ (.*[^ ].*) $/, '$1');
        const c = el('code', 'ic', raw);
        c.title = 'Click to copy';
        c.addEventListener('click', async () => {
          if (String(window.getSelection()).length) return; // user is selecting text, don't hijack
          const ok = await copyText(raw);
          if (ok) { c.classList.add('copied'); setTimeout(() => c.classList.remove('copied'), 900); toast('Copied'); }
        });
        parent.appendChild(c);
      } else if (g.b !== undefined || g.b2 !== undefined) {
        const s = el('strong'); inline(s, g.b !== undefined ? g.b : g.b2); parent.appendChild(s);
      } else if (g.st !== undefined) {
        const s = el('del'); inline(s, g.st); parent.appendChild(s);
      } else if (g.i !== undefined || g.i2 !== undefined) {
        const s = el('em'); inline(s, g.i !== undefined ? g.i : g.i2); parent.appendChild(s);
      } else if (g.lt !== undefined) {
        const url = safeUrl(g.lu);
        if (url) { const { a } = linkNode(url); inline(a, g.lt); parent.appendChild(a); } else plain(m[0]);
      } else if (g.auto !== undefined) {
        let url = g.auto, trail = '';
        for (;;) {
          const ch = url[url.length - 1];
          const open = (url.match(/\(/g) || []).length, close = (url.match(/\)/g) || []).length;
          if (/[.,;:!?'"\]]/.test(ch) || (ch === ')' && close > open)) { trail = ch + trail; url = url.slice(0, -1); } else break;
        }
        const { a } = linkNode(url); a.textContent = url; parent.appendChild(a); plain(trail);
      }
    }
    plain(text.slice(last));
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = []; let cur = '', tick = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
      if (ch === '`') tick = !tick;
      if (ch === '|' && !tick) { cells.push(cur.trim()); cur = ''; } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function buildTable(headerLine, sepLine, rowLines) {
    const heads = splitRow(headerLine);
    const aligns = splitRow(sepLine).map((c) => (/^:-+:$/.test(c) ? 'al-c' : /-:$/.test(c) ? 'al-r' : ''));
    const wrap = el('div', 'table-wrap');
    const scroll = el('div', 'table-scroll');
    const table = el('table');
    const thead = el('thead'), htr = el('tr');
    heads.forEach((h, k) => { const th = el('th', aligns[k] || ''); inline(th, h.replace(/<br\s*\/?>/gi, '\n')); htr.appendChild(th); });
    thead.appendChild(htr);
    const tbody = el('tbody');
    const plainCell = (c) => c.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/<br\s*\/?>/gi, ' ');
    const tsv = [heads.map(plainCell).join('\t')];
    rowLines.forEach((rl) => {
      const cells = splitRow(rl);
      const tr = el('tr');
      for (let k = 0; k < heads.length; k++) {
        const td = el('td', aligns[k] || '');
        inline(td, (cells[k] || '').replace(/<br\s*\/?>/gi, '\n'));
        tr.appendChild(td);
      }
      tsv.push(cells.slice(0, heads.length).map(plainCell).join('\t'));
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    scroll.appendChild(table);
    const cp = copyBtn(() => tsv.join('\n'), 'Copy', 'Copy table (tab-separated, pastes into Excel/Sheets)');
    cp.classList.add('table-copy');
    wrap.append(cp, scroll);
    return wrap;
  }

  const startsBlock = (l) => FENCE_RE.test(l) || HEAD_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || LIST_RE.test(l);
  const tableAt = (lines, i) => i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('|') && lines[i + 1].includes('-') && SEP_RE.test(lines[i + 1]);

  function parseList(lines, i) {
    const first = LIST_RE.exec(lines[i]);
    const base = first[1].length;
    const ordered = /^\d/.test(first[2]);
    const list = el(ordered ? 'ol' : 'ul');
    if (ordered) { const n = parseInt(first[2], 10); if (n !== 1) list.start = n; }

    while (i < lines.length) {
      const m = LIST_RE.exec(lines[i]);
      if (!m) break;
      const indent = m[1].length;
      if (indent < base - 1 || indent > base + 1 || /^\d/.test(m[2]) !== ordered) break;

      const li = el('li');
      let text = m[3];
      const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);
      let checkbox = null;
      if (task) {
        checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.disabled = true; checkbox.checked = task[1] !== ' ';
        li.classList.add('task'); text = task[2];
      }
      const textLines = [text];
      const children = [];
      i++;

      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) {
          let j = i; while (j < lines.length && isBlank(lines[j])) j++;
          if (j >= lines.length) { i = j; break; }
          const nl = lines[j], lm = LIST_RE.exec(nl), ind = indentOf(nl);
          if (ind > indent) { i = j; continue; }
          if (lm && /^\d/.test(lm[2]) === ordered && Math.abs(lm[1].length - base) <= 1) i = j;
          break;
        }
        const fm = FENCE_RE.exec(l);
        if (fm && indentOf(l) > indent) {
          const f = readFence(lines, i, fm);
          children.push(codeBlock(f.code, f.lang)); i = f.next; continue;
        }
        const lm = LIST_RE.exec(l);
        if (lm) {
          if (lm[1].length >= indent + 2) { const [sub, ni] = parseList(lines, i); children.push(sub); i = ni; continue; }
          break;
        }
        if (indentOf(l) > indent) {
          if (!children.length) textLines.push(l.trim());
          else { const p = el('div'); inline(p, l.trim()); children.push(p); }
          i++; continue;
        }
        if (!children.length && !startsBlock(l) && !tableAt(lines, i)) { textLines.push(l.trim()); i++; continue; }
        break;
      }
      if (checkbox) li.appendChild(checkbox);
      inline(li, textLines.join('\n'));
      children.forEach((c) => li.appendChild(c));
      list.appendChild(li);
    }
    return [list, i];
  }

  function renderBlocks(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) { i++; continue; }

      let m = FENCE_RE.exec(line);
      if (m) { const f = readFence(lines, i, m); frag.appendChild(codeBlock(f.code, f.lang)); i = f.next; continue; }

      if ((m = HEAD_RE.exec(line))) {
        const h = el('h' + m[1].length); inline(h, m[2]); frag.appendChild(h); i++; continue;
      }
      if (HR_RE.test(line)) { frag.appendChild(el('hr')); i++; continue; }

      if (QUOTE_RE.test(line)) {
        const inner = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) { inner.push(QUOTE_RE.exec(lines[i])[1]); i++; }
        const bq = el('blockquote'); bq.appendChild(renderBlocks(inner.join('\n'))); frag.appendChild(bq); continue;
      }
      if (LIST_RE.test(line)) { const [list, ni] = parseList(lines, i); frag.appendChild(list); i = ni; continue; }

      if (tableAt(lines, i)) {
        const rows = []; const head = lines[i], sep = lines[i + 1];
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) { rows.push(lines[i]); i++; }
        frag.appendChild(buildTable(head, sep, rows)); continue;
      }

      const para = [line]; i++;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !tableAt(lines, i)) { para.push(lines[i]); i++; }
      const p = el('p'); inline(p, para.join('\n')); frag.appendChild(p);
    }
    return frag;
  }

  // The user's own messages are shown literally (so pasted * # _ stay intact); only code fences become code blocks.
  function renderUser(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const frag = document.createDocumentFragment();
    let buf = [];
    const flush = () => { const t = buf.join('\n').replace(/^\n+|\n+$/g, ''); if (t) frag.appendChild(el('div', 'plain', t)); buf = []; };
    let i = 0;
    while (i < lines.length) {
      const m = FENCE_RE.exec(lines[i]);
      if (m) { flush(); const f = readFence(lines, i, m); frag.appendChild(codeBlock(f.code, f.lang)); i = f.next; continue; }
      buf.push(lines[i]); i++;
    }
    flush();
    return frag;
  }

  /* =====================================================================
   * App state + elements
   * ===================================================================== */
  const log = $('log'), thread = $('thread'), form = $('form'), input = $('input');
  const sendBtn = $('send'), stopBtn = $('stop'), statusEl = $('status'), statusText = $('status-text');
  const clearBtn = $('clear'), exportBtn = $('export'), themeBtn = $('theme'), agentBox = $('agent');
  const errorEl = $('error'), errorMsg = $('error-msg'), errorClose = $('error-close');
  const jumpBtn = $('jump'), countEl = $('count');
  const modeBtns = Array.from(document.querySelectorAll('[data-mode]')).filter((b) => b.tagName === 'BUTTON');

  const KEY = 'rain.history.v1', AGENT_KEY = 'rain.agent.v1', THEME_KEY = 'rain.theme.v1';
  let history = [];
  let controller = null;
  let stick = true;

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) history = saved.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content);
    agentBox.checked = localStorage.getItem(AGENT_KEY) === '1';
  } catch { /* corrupt or unavailable storage: start fresh */ }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(history.slice(-100))); } catch { /* ignore */ } };
  const post = (url, body, signal) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

  // static icons
  $('logo').appendChild(icon('drop'));
  exportBtn.appendChild(icon('download'));
  sendBtn.appendChild(icon('send'));
  stopBtn.appendChild(icon('stop'));
  jumpBtn.appendChild(icon('down'));
  errorClose.appendChild(icon('x'));

  /* ---------- scrolling ---------- */
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 140;
  function scroll(force) {
    if (force) stick = true;
    if (stick) { log.style.scrollBehavior = 'auto'; log.scrollTop = log.scrollHeight; log.style.scrollBehavior = ''; }
  }
  log.addEventListener('scroll', () => { stick = nearBottom(); jumpBtn.hidden = stick; }, { passive: true });
  jumpBtn.addEventListener('click', () => { stick = true; log.scrollTop = log.scrollHeight; jumpBtn.hidden = true; });

  /* ---------- theme ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : mq.matches);
  function paintThemeBtn() { themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon')); themeBtn.title = isDark() ? 'Switch to light theme' : 'Switch to dark theme'; }
  try { const t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    paintThemeBtn();
  });
  mq.addEventListener && mq.addEventListener('change', paintThemeBtn);
  paintThemeBtn();

  /* ---------- errors / status ---------- */
  const showError = (msg) => { errorMsg.textContent = msg; errorEl.hidden = false; };
  const clearError = () => { errorEl.hidden = true; };
  errorClose.addEventListener('click', clearError);

  function setMode(mode) {
    document.body.dataset.net = mode;
    modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    updateAgentNote();
  }
  async function refreshStatus() {
    try {
      const h = await (await fetch('/api/health')).json();
      setMode(h.mode);
      statusText.textContent = h.modelReachable ? `Model ready: ${h.model}` : 'Local model not reachable';
      statusText.title = statusText.textContent;
      statusEl.className = 'pill ' + (h.modelReachable ? 'ok' : 'bad');
    } catch {
      statusText.textContent = 'Server not reachable';
      statusEl.className = 'pill bad';
    }
  }
  async function changeMode(mode) {
    if (controller || document.body.dataset.net === mode) return;
    try {
      const r = await post('/api/mode', { mode });
      if (!r.ok) throw new Error((await r.json()).error);
      setMode(mode);
      clearError();
    } catch (err) { showError(err.message || 'Could not change mode.'); }
    refreshStatus();
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => changeMode(b.dataset.mode)));

  // One-line explanation of what Agent can do in the current mode (with a shortcut to go Online).
  const agentNote = $('agent-note');
  function updateAgentNote() {
    if (!agentNote) return;
    agentNote.replaceChildren();
    if (!agentBox.checked) { agentNote.hidden = true; return; }
    agentNote.hidden = false;
    if (document.body.dataset.net === 'online') {
      agentNote.append(icon('globe'), el('span', null, 'Agent can work in its workspace and read public web pages. You approve every write, command and page fetch.'));
    } else {
      agentNote.append(icon('terminal'), el('span', null, 'Agent can work in its workspace. Reading web pages needs Online mode.'));
      const go = el('button', 'pill-btn', 'Switch to Online'); go.type = 'button';
      go.addEventListener('click', () => changeMode('online'));
      agentNote.appendChild(go);
    }
  }

  /* =====================================================================
   * Rows
   * ===================================================================== */
  function userRow(text, idx) {
    const row = el('div', 'row user');
    row._idx = idx;
    const bubble = el('div', 'bubble');
    bubble.appendChild(renderUser(text));
    const acts = el('div', 'msg-actions');
    acts.append(
      copyBtn(() => text, '', 'Copy message'),
      btn('', 'pencil', '', () => editMessage(row), 'Edit and resend'),
    );
    acts.lastChild.classList.add('icon-only');
    row.append(bubble, acts);
    thread.appendChild(row);
    return row;
  }

  function assistantRow(text, pending, pendingLabel) {
    const row = el('div', 'row assistant');
    const avatar = el('div', 'avatar'); avatar.appendChild(icon('drop'));
    const body = el('div', 'abody');
    const md = el('div', 'md');
    row._md = md; row._raw = text || '';
    if (pending) {
      row.classList.add('pending');
      const d = el('span', 'dots');
      d.append(el('i'), el('i'), el('i'));
      if (pendingLabel) { row._label = el('em', null, pendingLabel); d.appendChild(row._label); }
      d.setAttribute('role', 'status'); d.setAttribute('aria-label', pendingLabel || 'Thinking');
      md.appendChild(d);
    } else md.appendChild(renderBlocks(text));
    const acts = el('div', 'msg-actions');
    const regen = btn('Regenerate', 'refresh', 'regen', () => regenerate(), 'Regenerate response');
    acts.append(copyBtn(() => row._raw, 'Copy', 'Copy response (Markdown)'), regen);
    body.append(md, acts);
    row.append(avatar, body);
    thread.appendChild(row);
    return row;
  }

  function markLast() {
    const rows = thread.querySelectorAll('.row.assistant');
    rows.forEach((r) => r.classList.remove('is-last'));
    if (rows.length && history.length && history[history.length - 1].role === 'assistant') rows[rows.length - 1].classList.add('is-last');
  }

  const SUGGESTIONS = [
    { icon: 'terminal', text: 'Show me how to set up a Python virtual environment, with the commands for Windows and Linux' },
    { icon: 'table', text: 'Compare REST and GraphQL in a table, then give a short recommendation' },
    { icon: 'code', text: 'Write a debounce function in JavaScript with comments and a usage example' },
    { icon: 'wrench', text: 'Create fib.py that prints the first 10 Fibonacci numbers, then run it', agent: true },
  ];
  function welcome() {
    const w = el('div', 'welcome');
    const mark = el('div', 'mark'); mark.appendChild(icon('drop'));
    w.append(
      mark,
      el('h2', null, 'What can I help with?'),
      el('p', 'sub', 'Chats stay in your browser. Turn on Agent to let the model read, write and run code in its workspace folder. Switch to Online to also let it read public web pages. You approve every write, command and fetch.'),
    );
    const chips = el('div', 'chips');
    SUGGESTIONS.forEach((s) => {
      const b = el('button', 'chip'); b.type = 'button';
      b.append(icon(s.icon), el('span', null, s.text + (s.agent ? '  (Agent)' : '')));
      b.addEventListener('click', () => {
        if (s.agent && !agentBox.checked) { agentBox.checked = true; persistAgent(); updateAgentNote(); }
        input.value = s.text; autosize(); updateSend(); input.focus();
      });
      chips.appendChild(b);
    });
    w.appendChild(chips);
    return w;
  }

  function render() {
    thread.replaceChildren();
    if (!history.length) { thread.appendChild(welcome()); return; }
    history.forEach((m, idx) => (m.role === 'user' ? userRow(m.content, idx) : assistantRow(m.content)));
    markLast();
    scroll(true);
  }

  /* ---------- edit / regenerate / export ---------- */
  function editMessage(row) {
    if (controller) return;
    const idx = row._idx;
    if (history[idx] == null) return;
    const text = history[idx].content;
    history.length = idx;
    save();
    let n = row;
    while (n) { const nx = n.nextSibling; n.remove(); n = nx; }
    if (!history.length) render(); else markLast();
    input.value = text; autosize(); updateSend(); input.focus();
    toast('Editing - press Enter to resend');
  }

  function regenerate() {
    if (controller || !history.length || history[history.length - 1].role !== 'assistant') return;
    history.pop();
    const userRows = thread.querySelectorAll('.row.user');
    const lastUser = userRows[userRows.length - 1];
    let n = lastUser ? lastUser.nextSibling : null;
    while (n) { const nx = n.nextSibling; n.remove(); n = nx; }
    run(lastUser);
  }

  exportBtn.addEventListener('click', () => {
    if (!history.length) return toast('Nothing to export yet');
    const md = '# R.A.I.N. chat\n\n' + history.map((m) => `**${m.role === 'user' ? 'You' : 'R.A.I.N.'}**\n\n${m.content}`).join('\n\n---\n\n') + '\n';
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `rain-chat-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  /* =====================================================================
   * Agent events: tool cards + approvals
   * ===================================================================== */
  const blocks = new Map();
  const approvals = new Map(); // tool call id -> approval card
  const TOOL_ICON = { list_dir: 'folder', read_file: 'file', write_file: 'pencil', run_command: 'terminal', fetch_url: 'globe' };
  const EXT_LANG = { js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', py: 'py', json: 'json', html: 'html', css: 'css', sh: 'sh', md: 'text', yml: 'yaml', yaml: 'yaml' };

  function hintFor(args) {
    if (!args || typeof args !== 'object') return '';
    const v = args.path ?? args.url ?? args.command ?? args.cmd ?? args.file ?? '';
    const s = Array.isArray(v) ? v.join(' ') : String(v);
    return args.args && Array.isArray(args.args) ? `${s} ${args.args.join(' ')}`.trim() : s;
  }
  function renderArgs(body, args) {
    if (!args || typeof args !== 'object') return;
    const lang = EXT_LANG[String(args.path || '').split('.').pop().toLowerCase()] || '';
    Object.entries(args).forEach(([k, v]) => {
      const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : JSON.stringify(v);
      if (s.includes('\n') || s.length > 90) {
        body.appendChild(el('div', 'lab', k));
        body.appendChild(codeBlock(s, k === 'content' ? lang : ''));
      } else {
        const kv = el('div', 'kv');
        kv.append(el('span', 'k', k + ':'), el('code', 'v', s));
        body.appendChild(kv);
      }
    });
  }

  function toolBlock(ev, before) {
    const d = el('details', 'tool running');
    const s = el('summary');
    const state = el('span', 'tool-state', 'running');
    s.append(icon(TOOL_ICON[ev.name] || 'wrench'), el('span', 'tool-name', ev.name), el('span', 'tool-hint', hintFor(ev.args)), state, icon('chevron', 'chev'));
    const body = el('div', 'tool-body');
    renderArgs(body, ev.args);
    d.append(s, body);
    thread.insertBefore(d, before);
    blocks.set(ev.id, d);
    d._state = state;
    scroll();
    return d;
  }
  function settleCard(card, state, label) {
    if (!card || card.classList.contains('resolved')) return;
    card.classList.add('resolved', state);
    card.querySelector('.title').replaceChildren(icon(state === 'approved' ? 'check' : 'x'), el('span', null, label));
    const r = card.querySelector('.row-btns'); if (r) r.remove();
  }
  function toolResult(ev) {
    const ap = approvals.get(ev.id);
    if (ap && !ap._answered && !ev.ok && /denied/i.test(String(ev.output))) settleCard(ap, 'denied', 'No answer in time - treated as denied');
    const d = blocks.get(ev.id);
    if (!d) return;
    d.classList.remove('running');
    d.classList.add(ev.ok ? 'done' : 'failed');
    d._state.textContent = ev.ok ? 'done' : 'failed';
    const body = d.querySelector('.tool-body');
    body.appendChild(el('div', 'lab', 'Output'));
    body.appendChild(codeBlock(ev.output ? String(ev.output) : '(no output)', ''));
    if (!ev.ok) d.open = true;
    scroll();
  }

  function approvalCard(ev, before) {
    const card = el('div', 'approval');
    card.setAttribute('role', 'group');
    const title = el('div', 'title');
    title.append(icon('alert'), el('span', null, 'Approval needed'));
    const code = el('code', 'approval-code', ev.summary);
    const row = el('div', 'row-btns');
    const yes = btn('Approve', 'check', 'solid');
    const no = btn('Deny', 'x', 'danger');
    const answer = async (approve) => {
      yes.disabled = no.disabled = true;
      card._answered = true;
      try {
        const r = await post('/api/approve', { id: ev.id, approve });
        if (!r.ok) throw new Error((await r.json()).error);
        settleCard(card, approve ? 'approved' : 'denied', approve ? 'Approved' : 'Denied');
      } catch (err) {
        card._answered = false;
        if (/no pending approval/i.test(err.message || '')) settleCard(card, 'denied', 'Expired - treated as denied');
        else { yes.disabled = no.disabled = false; }
        showError(err.message || 'Could not send your answer.');
      }
    };
    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    row.append(yes, no, copyBtn(() => ev.summary, 'Copy', 'Copy what will run'));
    card.append(title, code, row);
    thread.insertBefore(card, before);
    if (ev.callId) approvals.set(ev.callId, card);
    scroll(true);
    yes.focus({ preventScroll: true });
    return card;
  }

  /* =====================================================================
   * Sending
   * ===================================================================== */
  function setBusy(b) {
    sendBtn.hidden = b; stopBtn.hidden = !b; agentBox.disabled = b;
    modeBtns.forEach((m) => { m.disabled = b; });
    document.body.classList.toggle('busy', b);
    if (!b) input.focus();
  }

  async function run(userEl) {
    const agent = agentBox.checked;
    const text = history[history.length - 1].content;
    const row = assistantRow('', true, agent ? 'Working…' : '');
    const extras = [];
    let acc = '', raf = 0, failure = '';
    controller = new AbortController();
    setBusy(true);
    scroll(true);
    const paint = () => { raf = 0; row._md.replaceChildren(renderBlocks(acc)); scroll(); };
    try {
      const res = await post(agent ? '/api/agent' : '/api/chat', { messages: history }, controller.signal);
      if (!res.ok) {
        let msg = `Request failed (${res.status}).`;
        try { msg = (await res.json()).error || msg; } catch { /* non-JSON error */ }
        throw new Error(msg);
      }
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
          if (ev.delta) {
            row.classList.remove('pending'); acc += ev.delta; row._raw = acc;
            if (!raf) raf = requestAnimationFrame(paint);
          } else if (ev.type === 'step') {
            if (row._label && ev.n > 1) row._label.textContent = `Working… step ${ev.n}`;
          } else if (ev.type === 'tool_call') extras.push(toolBlock(ev, row));
          else if (ev.type === 'tool_result') toolResult(ev);
          else if (ev.type === 'approval') extras.push(approvalCard(ev, row));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') { failure = err.message || 'Something went wrong.'; showError(failure); }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      controller = null;
      extras.forEach((n) => { if (n.classList && n.classList.contains('approval') && !n._answered) settleCard(n, 'denied', 'Task ended - not run'); });
      if (acc) {
        row.classList.remove('pending');
        row._md.replaceChildren(renderBlocks(acc));
        history.push({ role: 'assistant', content: acc });
      } else if (extras.length) { // the agent already did visible work: keep the trace and close the turn
        row.remove();
        const note = failure ? `The task stopped before finishing: ${failure}` : 'Stopped before finishing.';
        assistantRow(note, false);
        history.push({ role: 'assistant', content: note });
      } else { // nothing came back: undo so you can retry
        row.remove();
        history.pop();
        if (userEl) userEl.remove();
        input.value = text; autosize(); updateSend();
        if (!history.length) render();
      }
      save();
      markLast();
      setBusy(false);
      refreshStatus();
    }
  }

  function submit() {
    const text = input.value.trim();
    if (!text || controller) return;
    clearError();
    if (!history.length) thread.replaceChildren();
    history.push({ role: 'user', content: text });
    const u = userRow(text, history.length - 1);
    input.value = ''; autosize(); updateSend();
    run(u);
  }

  /* =====================================================================
   * Composer behaviour + shortcuts
   * ===================================================================== */
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
  function updateSend() {
    const n = input.value.length;
    sendBtn.disabled = !input.value.trim();
    countEl.hidden = n < 6000;
    countEl.textContent = `${n}/8000`;
    countEl.classList.toggle('warn', n > 7600);
  }
  const persistAgent = () => { try { localStorage.setItem(AGENT_KEY, agentBox.checked ? '1' : '0'); } catch { /* ignore */ } };

  function newChat() {
    if (controller) controller.abort();
    history = []; save(); clearError(); render(); input.focus();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  stopBtn.addEventListener('click', () => controller && controller.abort());
  agentBox.addEventListener('change', () => { persistAgent(); updateAgentNote(); });
  clearBtn.addEventListener('click', newChat);
  input.addEventListener('input', () => { autosize(); updateSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); }
    else if (e.key === 'Escape' && controller) controller.abort();
    else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });

  render();
  autosize();
  updateSend();
  refreshStatus();
  updateAgentNote();
  setInterval(() => { if (!controller) refreshStatus(); }, 15000); // a busy local model can be slow to answer health checks
})();
