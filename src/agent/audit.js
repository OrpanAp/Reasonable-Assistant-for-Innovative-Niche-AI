'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Append-only JSON-lines log of tool decisions. It records what was asked and
// decided, never file contents.
function createAudit(file) {
  return {
    log(entry) {
      if (!file) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
      } catch { /* auditing must never crash a task */ }
    },
  };
}

module.exports = { createAudit };
