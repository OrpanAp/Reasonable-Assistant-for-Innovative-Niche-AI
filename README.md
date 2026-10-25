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
- **Online:** the network guard allows outside requests. The agent gets a fifth tool, `fetch_url`, that reads public web pages (see below). In Offline mode that tool is not offered at all.

## Troubleshooting
- "Local model not reachable": start Ollama / llama-server, and check `LOCAL_MODEL_URL` and `LOCAL_MODEL_NAME`.
- Slow replies: use a smaller model; CPU-only machines work best with 1B-3B models.
- Chat history is stored in your browser (localStorage), not on the server.

## Phase 2: coding agent
Tick **Agent** in the header. The model can then work inside the `workspace/` folder using four tools:
`list_dir`, `read_file`, `write_file`, `run_command`. In **Online** mode it also gets `fetch_url`. It loops (propose tool, run it, read the result, repeat)
for at most `AGENT_MAX_STEPS` steps.

- **Approvals:** every `write_file` and every `run_command` shows an Approve/Deny card. No answer within
  `APPROVAL_TIMEOUT_MS` counts as a denial. `AUTO_APPROVE_WRITES=true` skips the write prompt only; commands always ask.
- **Workspace jail:** file paths are resolved inside `workspace/` and symlink escapes are rejected.
- **Commands:** only programs in `ALLOWED_COMMANDS` (default `node,python3,python`), no shell, timeout, output cap,
  and a stripped environment so API keys are not passed to child processes.
- **Audit log:** `data/audit.log` records each tool decision (never file contents).
- **Models:** native tool calling is used when the model supports it; otherwise it falls back to a JSON-in-text protocol.

### Web access (Online mode only)
- `fetch_url` does a read-only GET of a public `http(s)` page and gives the model its readable text. Every fetch shows an Approve/Deny card with the URL
  (`AUTO_APPROVE_FETCH=true` skips the prompt).
- **Public internet only:** loopback, LAN, link-local and cloud-metadata addresses are refused (checked on the resolved IP, on every redirect), as are non-80/443 ports,
  URLs with credentials, non-text content, and pages over `FETCH_MAX_BYTES` (truncated). Timeout: `FETCH_TIMEOUT_MS`.
- Fetched text is labelled as untrusted so the model treats it as information, not instructions. A web page can still try to steer a small model, which is why each fetch asks first.
- Switching to Offline removes the tool and any attempt to call it is refused before the approval prompt.

### Important limits (read this)
- `run_command` is **not a security sandbox**. An approved `node` or `python` program runs with your user's
  permissions and can read files or use the network outside the workspace. Read the command before approving.
  Real isolation needs a container or a separate OS user.
- Offline mode blocks R.A.I.N.'s own requests, but cannot stop a program you approve from using the network.
- In agent mode the final answer appears all at once (tool steps stream live; the answer text does not).
- One agent task runs at a time. Tool traces are shown but not sent back to the model on later messages.
- Small local models make more mistakes with tools; larger coder models (e.g. Qwen2.5-Coder 14B+) do much better.

## If the agent or Online mode misbehaves
- **Online mode only affects Agent.** Plain chat never leaves your machine. Tick **Agent**, switch to **Online**, and the model gets `fetch_url`; each fetch asks for approval. `fetch_url` returns page text with links as `text (url)` so the model can follow them.
- **The model has to decide to call the tool.** There is no built-in search engine tool. Give it a URL, or ask it to fetch a search page such as `https://html.duckduckgo.com/html/?q=your+query` and then open a result.
- **Agent prints JSON instead of acting:** the model does not support native tool calls and used a format R.A.I.N. could not read. Common shapes (`{"tool","args"}`, `{"name","parameters"}`, `{"name","arguments"}`, `<tool_call>` tags) are understood; if yours still fails, try a larger or coder model (Qwen2.5-Coder, Llama 3.1+).
- **The model ignores its tools or forgets the task after fetching a page:** the context window is probably too small, so the start of the prompt (instructions and tool list) is silently cut off. Raise it in your model server (for Ollama, recent versions accept `OLLAMA_CONTEXT_LENGTH=8192`, or set `num_ctx` in a Modelfile) and keep `TOOL_OUTPUT_MAX` modest.
- **"Stopped after N steps":** raise `AGENT_MAX_STEPS` (default 12; an older copy of `.env` may still say 8).
- **Sloppy arguments are repaired, safely:** `"python3 app.py"` in one string becomes command plus args, `example.com` becomes `https://example.com`. The allow-list, workspace jail and approvals still apply and no shell is used.
