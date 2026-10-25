'use strict';
// Every outbound request in R.A.I.N. must go through this module so that
// offline mode (and the public-internet-only rule for the agent) is enforced in one place.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const isLoopback = (hostname) => LOOPBACK.has(hostname);

function assertAllowed(url, mode) {
  const u = new URL(url);
  if (mode === 'offline' && !isLoopback(u.hostname)) {
    const err = new Error(`Blocked: offline mode does not allow requests to ${u.hostname}.`);
    err.code = 'OFFLINE_BLOCKED';
    throw err;
  }
}

async function guardedFetch(url, opts, mode) {
  assertAllowed(url, mode);
  return fetch(url, opts);
}

// ---- public-internet fetch for the agent's fetch_url tool ----
const netErr = (message, code) => Object.assign(new Error(message), { code });

// True for loopback, private, link-local, CGNAT, multicast and other non-public addresses.
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateIp(dotted[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
  }
  return true; // not a valid IP: refuse
}

// DNS lookup that refuses non-public addresses. The socket connects to the exact address
// validated here, so a hostname cannot pass a check and then resolve to an internal IP (DNS rebinding).
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => !isPrivateIp(a.address));
    if (!ok.length) return cb(netErr('Blocked: that address is private or internal. Only public websites can be fetched.', 'PRIVATE_BLOCKED'));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

async function publicFetch(url, { mode, signal, timeoutMs = 15000, maxBytes = 1000000, maxRedirects = 4, allowPrivate = false, textOnly = true } = {}) {
  if (mode !== 'online') throw netErr('Blocked: web access needs Online mode.', 'OFFLINE_BLOCKED');
  let current;
  try { current = new URL(url); } catch { throw netErr('Invalid URL.', 'BAD_URL'); }
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!/^https?:$/.test(current.protocol)) throw netErr('Only http and https URLs are allowed.', 'BAD_URL');
    if (current.username || current.password) throw netErr('URLs with embedded credentials are not allowed.', 'BAD_URL');
    const port = current.port || (current.protocol === 'https:' ? '443' : '80');
    if (!allowPrivate && port !== '80' && port !== '443') throw netErr('Only ports 80 and 443 are allowed.', 'BAD_URL');
    const host = current.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(host) && isPrivateIp(host)) throw netErr('Blocked: that address is private or internal. Only public websites can be fetched.', 'PRIVATE_BLOCKED');

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw netErr('Request timed out.', 'FETCH_TIMEOUT');
    const lib = current.protocol === 'https:' ? https : http;
    let timer;
    const res = await new Promise((resolve, reject) => {
      const req = lib.request(current, {
        method: 'GET', signal, lookup: allowPrivate ? undefined : safeLookup,
        headers: { 'User-Agent': 'R.A.I.N./0.1 (local agent)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
      }, resolve);
      timer = setTimeout(() => req.destroy(netErr('Request timed out.', 'FETCH_TIMEOUT')), remaining);
      req.on('error', reject);
      req.end();
    }).finally(() => clearTimeout(timer));

    const status = res.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume();
      try { current = new URL(res.headers.location, current); } catch { throw netErr('Bad redirect.', 'BAD_URL'); }
      continue; // every hop is re-validated at the top of the loop
    }
    const type = String(res.headers['content-type'] || '').toLowerCase();
    if (textOnly && type && !/^(text\/|application\/(json|xml|xhtml|rss|atom|ld\+json|javascript))|\+(json|xml)\b/.test(type)) {
      res.destroy();
      throw netErr(`Unsupported content type "${type.split(';')[0]}". Only text pages can be read.`, 'BAD_TYPE');
    }
    const chunks = [];
    let size = 0, truncated = false;
    const bodyTimer = setTimeout(() => res.destroy(netErr('Request timed out.', 'FETCH_TIMEOUT')), Math.max(1, deadline - Date.now()));
    try {
      for await (const c of res) {
        size += c.length;
        if (size > maxBytes) { const keep = c.length - (size - maxBytes); if (keep > 0) chunks.push(c.subarray(0, keep)); truncated = true; break; }
        chunks.push(c);
      }
    } finally { clearTimeout(bodyTimer); }
    return { status, url: current.href, type, body: Buffer.concat(chunks).toString('utf8'), truncated };
  }
  throw netErr('Too many redirects.', 'BAD_URL');
}

module.exports = { isLoopback, assertAllowed, guardedFetch, isPrivateIp, publicFetch };
