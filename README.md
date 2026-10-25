# R.A.I.N. - Phase 1 (Foundation) + Phase 2 (Coding agent)

A zero-dependency, local-first chat platform. No npm packages, no third-party APIs, free to run.
Requires Node.js 18+ and any local model server that speaks the OpenAI-style `/v1/chat/completions` API
(Ollama, llama.cpp `llama-server`, LM Studio).

## Run it
1. Install a local model runtime and download a model once (this step needs internet):
   - Ollama: install it, then `ollama pull llama3.2`
   - or llama.cpp: `llama-server -m your-model.gguf --port 8080` and set `LOCAL_MODEL_URL=http://127.0.0.1:8080`
2. Copy `.env.example` to `.env` and adjust (optional).
3. `node src/server.js` then open http://127.0.0.1:3000
4. Tests: `npm test` (or `node --test`)

## Layout
- `src/server.js` HTTP server, routes, rate limit, host/origin checks, streaming
- `src/providers/local.js` talks to the local model server (swap in other providers with the same `streamChat` interface)
- `src/netguard.js` the single gate for outbound requests; offline mode blocks everything except localhost
- `src/validate.js` server-side input validation and context trimming
- `src/config.js` .env loading
- `public/` responsive chat UI (no external assets, works offline)
- `test/` automated tests

## Modes
- **Offline:** only localhost requests are allowed. Nothing can leave your machine.
- **Online:** the network guard allows outside requests. In Phase 1 nothing uses this yet; the web-fetch tool arrives in Phase 2.

## Troubleshooting
- "Local model not reachable": start Ollama / llama-server, and check `LOCAL_MODEL_URL` and `LOCAL_MODEL_NAME`.
- Slow replies: use a smaller model; CPU-only machines work best with 1B-3B models.
- Chat history is stored in your browser (localStorage), not on the server.

## Phase 2: coding agent
Tick **Agent (tools)** in the header. The model can then work inside the `workspace/` folder using four tools:
`list_dir`, `read_file`, `write_file`, `run_command`. It loops (propose tool, run it, read the result, repeat)
for at most `AGENT_MAX_STEPS` steps.

- **Approvals:** every `write_file` and every `run_command` shows an Approve/Deny card. No answer within
  `APPROVAL_TIMEOUT_MS` counts as a denial. `AUTO_APPROVE_WRITES=true` skips the write prompt only; commands always ask.
- **Workspace jail:** file paths are resolved inside `workspace/` and symlink escapes are rejected.
- **Commands:** only programs in `ALLOWED_COMMANDS` (default `node,python3,python`), no shell, timeout, output cap,
  and a stripped environment so API keys are not passed to child processes.
- **Audit log:** `data/audit.log` records each tool decision (never file contents).
- **Models:** native tool calling is used when the model supports it; otherwise it falls back to a JSON-in-text protocol.

### Important limits (read this)
- `run_command` is **not a security sandbox**. An approved `node` or `python` program runs with your user's
  permissions and can read files or use the network outside the workspace. Read the command before approving.
  Real isolation needs a container or a separate OS user.
- Offline mode blocks R.A.I.N.'s own requests, but cannot stop a program you approve from using the network.
- In agent mode the final answer appears all at once (tool steps stream live; the answer text does not).
- One agent task runs at a time. Tool traces are shown but not sent back to the model on later messages.
- Small local models make more mistakes with tools; larger coder models (e.g. Qwen2.5-Coder 14B+) do much better.
