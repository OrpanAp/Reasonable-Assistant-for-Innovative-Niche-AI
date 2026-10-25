'use strict';
// Every outbound request in R.A.I.N. must go through guardedFetch so that
// offline mode is enforced in exactly one place.
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

module.exports = { isLoopback, assertAllowed, guardedFetch };
