'use strict';
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* a missing .env is fine */ }
  return out;
}

function load(overrides = {}) {
  const e = { ...loadEnvFile(path.join(__dirname, '..', '.env')), ...process.env, ...overrides };
  const int = (k, d) => { const n = parseInt(e[k], 10); return Number.isFinite(n) ? n : d; };
  return {
    host: e.HOST || '127.0.0.1',
    port: int('PORT', 3000),
    localUrl: (e.LOCAL_MODEL_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    localModel: e.LOCAL_MODEL_NAME || 'llama3.2',
    systemPrompt: e.SYSTEM_PROMPT || 'You are R.A.I.N., a helpful and honest assistant. If you are unsure, say so.',
    mode: ['offline', 'online'].includes(e.DEFAULT_MODE) ? e.DEFAULT_MODE : 'offline',
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 120000),
    maxBodyBytes: int('MAX_BODY_BYTES', 256 * 1024),
    maxMessages: int('MAX_MESSAGES', 100),
    maxMessageChars: int('MAX_MESSAGE_CHARS', 8000),
    maxContextChars: int('MAX_CONTEXT_CHARS', 24000),
    rateLimitPerMin: int('RATE_LIMIT_PER_MIN', 30),
    // --- Phase 2: agent ---
    workspaceDir: path.resolve(e.WORKSPACE_DIR || path.join(__dirname, '..', 'workspace')),
    auditFile: path.join(__dirname, '..', 'data', 'audit.log'),
    agentMaxSteps: int('AGENT_MAX_STEPS', 12),
    agentMaxCallsPerStep: int('AGENT_MAX_CALLS_PER_STEP', 4),
    agentMaxContextChars: int('AGENT_MAX_CONTEXT_CHARS', 60000),
    agentTimeoutMs: int('AGENT_TIMEOUT_MS', 600000),
    approvalTimeoutMs: int('APPROVAL_TIMEOUT_MS', 120000),
    autoApproveWrites: String(e.AUTO_APPROVE_WRITES || '').toLowerCase() === 'true',
    allowedCommands: (e.ALLOWED_COMMANDS || 'node,python3,python').split(',').map((x) => x.trim()).filter(Boolean),
    commandTimeoutMs: int('COMMAND_TIMEOUT_MS', 30000),
    maxFileBytes: int('MAX_FILE_BYTES', 200000),
    toolOutputMax: int('TOOL_OUTPUT_MAX', 8000),
    cmdOutputMax: int('CMD_OUTPUT_MAX', 20000),
    // --- Online mode: agent web access ---
    autoApproveFetch: String(e.AUTO_APPROVE_FETCH || '').toLowerCase() === 'true',
    fetchTimeoutMs: int('FETCH_TIMEOUT_MS', 15000),
    fetchMaxBytes: int('FETCH_MAX_BYTES', 1000000),
    fetchAllowPrivate: String(e.FETCH_ALLOW_PRIVATE || '').toLowerCase() === 'true', // testing only; lets fetch_url reach localhost/LAN
  };
}

module.exports = { load };
