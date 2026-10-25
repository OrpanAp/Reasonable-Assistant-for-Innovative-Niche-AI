# R.A.I.N.
### Reasonable Assistant for Innovative Niche AI

**A local-first AI chat assistant with an optional, approval-driven coding agent.** Run an OpenAI-compatible local model, chat through a lightweight browser interface, and optionally let the agent inspect, create, and execute code inside a dedicated workspace.

R.A.I.N. is built with Node.js core modules and browser-native technologies. The application itself has **zero npm runtime dependencies** and does not require a hosted AI API key.

> **Project status:** The repository includes the core chat experience and a tool-using coding-agent mode. It is an independent project; model quality, tool support, and response speed depend on the local model runtime and model you configure.

---

## At a glance

- **Local-model support** — connect to an OpenAI-style chat-completions endpoint such as Ollama, llama.cpp's `llama-server`, or LM Studio.
- **Streaming chat** — receive responses incrementally in the browser.
- **Offline-first network policy** — offline mode blocks R.A.I.N.'s own outbound requests to non-loopback hosts.
- **Optional coding agent** — list and read workspace files, write files, and run allow-listed programs.
- **Human approval gates** — file writes and command execution require approval by default.
- **Workspace path checks** — reject traversal and symlink escapes from the configured workspace.
- **Guardrails for local execution** — command allow-list, execution timeout, output limits, and a reduced child-process environment.
- **Lightweight stack** — Node.js built-ins, plain HTML/CSS/JavaScript, and Node's built-in test runner.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configure your model](#configure-your-model)
- [Using R.A.I.N.](#using-rain)
- [Coding agent and tools](#coding-agent-and-tools)
- [Configuration reference](#configuration-reference)
- [HTTP API](#http-api)
- [Project structure](#project-structure)
- [Tests](#tests)
- [Security model and limitations](#security-model-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Roadmap ideas](#roadmap-ideas)
- [Contributing](#contributing)
- [License](#license)

## How it works

```text
Your browser
    │
    ▼
R.A.I.N. web interface ── local Node.js HTTP server
                                │
                                ├── Chat API ── streaming provider adapter
                                │                    │
                                │                    ▼
                                │             Local model server
                                │
                                └── Agent API ── model tool calls
                                                     │
                                                     ▼
                                          Workspace tools + approvals
```

The browser communicates with the local Node.js server. The server forwards model requests to the configured model endpoint. In agent mode, the model can request one of four tools; R.A.I.N. validates each request and asks for approval before executing write or command actions (unless write approvals have explicitly been auto-enabled).

R.A.I.N. does not bundle or download a language model. Install and run a model server separately.

## Requirements

- **Node.js 18 or newer**
- A compatible local model server and a model downloaded for that runtime
- A modern browser

No `npm install` is needed for the current project because `package.json` defines no third-party dependencies.

## Quick start

### 1. Start a local model server

Choose one compatible runtime.

**Option A — Ollama**

Install [Ollama](https://ollama.com/) and pull a model:

```bash
ollama pull llama3.2
```

Start Ollama using its normal service or application workflow. Its default API address is `http://127.0.0.1:11434`.

**Option B — llama.cpp**

Start `llama-server` with your own GGUF model:

```bash
llama-server -m /path/to/your-model.gguf --port 8080
```

Then configure R.A.I.N. to use `http://127.0.0.1:8080`.

**Option C — LM Studio**

Start a local model and enable its OpenAI-compatible API server. Set `LOCAL_MODEL_URL` to the server's base URL and `LOCAL_MODEL_NAME` to the model identifier accepted by that server.

### 2. Configure environment variables (optional)

Copy `.env.example` to `.env` in the project root. The defaults are suitable for a typical local Ollama setup, so you can skip this step if your model server uses the default address.

Git Bash / macOS / Linux:

```bash
cp .env.example .env
```

Windows Command Prompt:

```bat
copy .env.example .env
```

Edit `.env` only where your setup differs from the defaults. See [Configuration reference](#configuration-reference).

### 3. Start R.A.I.N.

From the repository root:

```bash
node src/server.js
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The server prints its host, port, network mode, model name, and model URL on startup. Keep the model server running while using R.A.I.N.

### 4. Run the tests

```bash
npm test
```

This invokes Node's built-in test runner; no test framework installation is required.

## Configure your model

R.A.I.N.'s provider adapter expects an OpenAI-compatible API with these endpoints:

- `GET /v1/models` — used for the connection status check
- `POST /v1/chat/completions` — used for chat and agent requests

The configured URL is the **base URL**, not the full chat-completions endpoint. For example:

```dotenv
LOCAL_MODEL_URL=http://127.0.0.1:11434
LOCAL_MODEL_NAME=llama3.2
DEFAULT_MODE=offline
```

For a llama.cpp server, for example:

```dotenv
LOCAL_MODEL_URL=http://127.0.0.1:8080
LOCAL_MODEL_NAME=your-model
```

Use the model identifier your runtime expects. Compatibility varies: a model may chat successfully but not support native tool calling. The agent includes a JSON-in-text fallback for models that do not accept native tool definitions, but results will vary by model.

## Using R.A.I.N.

### Chat mode

1. Start your model server and R.A.I.N.
2. Open the local web interface.
3. Confirm the status indicates that the model is reachable.
4. Enter a message and send it. Responses stream into the conversation.
5. Use **New chat** to clear the visible conversation and start again.

Conversation history is stored in the browser's `localStorage`; it is not persisted in a server-side chat database. Browser storage can be cleared by the browser or user.

### Network modes

- **Offline** — R.A.I.N.'s network guard permits requests only to recognized loopback hosts such as `127.0.0.1`, `localhost`, and `::1`. This is the default.
- **Online** — the guard permits requests to non-loopback hosts as well. This enables future or custom network-backed integrations, but does not by itself add a web-search feature to this version.

**Important:** Offline mode controls requests made through R.A.I.N.'s guarded provider path. It is not an operating-system firewall and cannot prevent a program you approve in agent mode from making its own network requests.

## Coding agent and tools

Enable **Agent (tools)** in the interface to ask R.A.I.N. to work on code in its workspace. The agent follows a bounded loop: request a tool, execute or reject it, return the result to the model, and repeat until the model finishes or the step limit is reached.

### Available tools

| Tool | Purpose | Approval |
| --- | --- | --- |
| `list_dir` | List entries in a workspace directory | Not required |
| `read_file` | Read a UTF-8 text file within the workspace | Not required |
| `write_file` | Create or overwrite a text file in the workspace | Required by default |
| `run_command` | Run an allow-listed program with arguments | Always required |

The agent's workspace defaults to `./workspace` at the project root. It is created automatically when the server starts. Use relative paths in requests.

### Approval behavior

- A pending write or command displays an **Approve / Deny** card in the interface.
- If no decision is received before `APPROVAL_TIMEOUT_MS`, the action is denied.
- `AUTO_APPROVE_WRITES=true` skips approval prompts for `write_file` only. **Commands still always require approval.**
- The agent is limited by `AGENT_MAX_STEPS` and the command timeout/output limits.
- Tool decisions are appended to `data/audit.log` as JSON Lines. The audit log records tool decisions and summaries, not file contents.

### Practical guidance

- Start by asking the agent to inspect the workspace before making changes.
- Review the exact file path, content, command, and arguments shown in each approval prompt.
- Keep important projects and secrets outside the workspace and do not run untrusted code.
- Back up important files before allowing an agent to overwrite them.

## Configuration reference

All settings are optional. Defaults below reflect the current `.env.example` and application configuration.

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface address for the HTTP server. Keep loopback for local-only use. |
| `PORT` | `3000` | HTTP server port. |
| `LOCAL_MODEL_URL` | `http://127.0.0.1:11434` | Base URL for the local OpenAI-compatible model server. |
| `LOCAL_MODEL_NAME` | `llama3.2` | Model identifier sent in API requests. |
| `DEFAULT_MODE` | `offline` | Initial network mode: `offline` or `online`. |
| `REQUEST_TIMEOUT_MS` | `120000` | Timeout for a chat request. |
| `RATE_LIMIT_PER_MIN` | `30` | Maximum chat/agent requests per client IP in a rolling minute. |
| `MAX_MESSAGE_CHARS` | `8000` | Maximum characters per message. |
| `MAX_CONTEXT_CHARS` | `24000` | Approximate character budget for chat context. |
| `MAX_BODY_BYTES` | `262144` | Maximum JSON request body size in bytes. |
| `MAX_MESSAGES` | `100` | Maximum messages accepted in a request. |
| `WORKSPACE_DIR` | `./workspace` | Directory accessible to agent tools. Relative values resolve from the process working directory. |
| `AUTO_APPROVE_WRITES` | `false` | Skip approval prompts for file writes. Commands still require approval. |
| `ALLOWED_COMMANDS` | `node,python3,python` | Comma-separated program names permitted by `run_command`. |
| `AGENT_MAX_STEPS` | `8` | Maximum model/tool loop steps per agent task. |
| `AGENT_MAX_CALLS_PER_STEP` | `4` | Maximum native tool calls handled in one step. |
| `AGENT_TIMEOUT_MS` | `600000` | Overall agent task timeout. |
| `APPROVAL_TIMEOUT_MS` | `120000` | Time to wait for a tool approval before denying it. |
| `COMMAND_TIMEOUT_MS` | `30000` | Maximum runtime for an approved child process. |
| `MAX_FILE_BYTES` | `200000` | Maximum size for files read or written by tools. |
| `TOOL_OUTPUT_MAX` | `8000` | Maximum tool output characters passed back to the model. |
| `CMD_OUTPUT_MAX` | `20000` | Maximum combined command output characters retained. |

Additional variables such as `AGENT_MAX_CONTEXT_CHARS` and `SYSTEM_PROMPT` are also read by the configuration loader. See `src/config.js` for the full list of supported values and defaults.

## HTTP API

The local server exposes the following routes:

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/` | Serves the web interface. |
| `GET` | `/api/health` | Returns mode, model name, and model reachability. |
| `POST` | `/api/mode` | Changes the current mode. JSON body: `{"mode":"offline"}` or `{"mode":"online"}`. |
| `POST` | `/api/chat` | Streams a chat response as newline-delimited JSON (NDJSON). |
| `POST` | `/api/agent` | Runs an agent task and streams tool events and response deltas as NDJSON. |
| `POST` | `/api/approve` | Resolves a pending tool approval. JSON body: `{"id":"<approval-id>","approve":true}`. |

Chat and agent requests accept a JSON body shaped like:

```json
{
  "messages": [
    { "role": "user", "content": "Explain this function." }
  ]
}
```

The final message must be from the user. Supported roles are `user` and `assistant`. Responses from streaming routes consist of one JSON object per line; chat emits `delta` events and a final `done` event, while agent mode can also emit tool-call, tool-result, approval, and error events.

## Project structure

```text
.
├── public/
│   ├── index.html       # Chat UI
│   ├── app.js           # Browser behavior, streaming, approvals, local history
│   └── style.css        # Responsive interface styling
├── src/
│   ├── server.js         # HTTP server, API routes, static files, limits and checks
│   ├── config.js         # Environment loading and configuration
│   ├── validate.js       # Request validation and context trimming
│   ├── netguard.js       # Central outbound-request policy
│   ├── providers/
│   │   └── local.js      # OpenAI-compatible local-model adapter
│   └── agent/
│       ├── tools.js      # Workspace tools and command execution
│       ├── loop.js       # Agent loop, tool-call parsing and approvals
│       └── audit.js      # JSONL audit logging
├── test/
│   ├── server.test.js    # Server, validation, network policy and API tests
│   └── agent.test.js     # Tool and agent behavior tests
├── data/                 # Runtime settings and audit log
├── workspace/            # Agent-accessible working directory
├── .env.example          # Example configuration
└── package.json
```

Runtime files such as settings, audit logs, and workspace content may be created when the application runs.

## Tests

Run the full suite:

```bash
npm test
```

The tests cover request validation, context trimming, offline network policy, streaming responses, invalid requests, host/origin checks, rate limiting, workspace path containment, tool approvals, command allow-listing, timeouts, and child-process environment reduction.

## Security model and limitations

R.A.I.N. includes defense-in-depth measures for a local developer tool, but it is **not a hardened sandbox**.

- **Approved commands run with your operating-system user's permissions.** The workspace is their working directory, not a security boundary. An approved program may access other files available to your user or use the network.
- **Offline mode is not a firewall.** It governs R.A.I.N.'s own guarded outbound requests; it cannot constrain code run by an approved command.
- **Keep the server local.** The default host is `127.0.0.1`. Do not expose it to a public network without additional authentication, access controls, and a security review.
- **Treat model output as untrusted.** Inspect every proposed write and command before approval. AI-generated commands can be destructive or incorrect.
- **Protect sensitive data.** Avoid placing credentials, private keys, or production data in the workspace. Child processes receive a reduced environment, but that is not a substitute for OS-level isolation.
- **Use OS or container isolation for stronger guarantees.** For higher-risk workloads, run R.A.I.N. in a disposable container or under a separate low-privilege operating-system account.

The project applies host and origin checks, input limits, request rate limiting, content-security headers, workspace path checks, execution timeouts, output caps, and audit logging. These controls reduce risk; they do not eliminate it.

## Troubleshooting

### The interface says “Local model not reachable”

1. Confirm the model server is running.
2. Check `LOCAL_MODEL_URL` in `.env` and ensure it is the base URL.
3. Confirm the configured runtime exposes `/v1/models` and `/v1/chat/completions`.
4. Check `LOCAL_MODEL_NAME` matches the identifier your runtime accepts.

### Requests are blocked in offline mode

Offline mode only allows recognized loopback hostnames. If your model server is on another machine or uses a non-loopback hostname, switch to online mode only if you understand and accept the network implications.

### Replies are slow or time out

Model speed depends on hardware, model size, context length, and runtime settings. Try a smaller or more quantized model and reduce the amount of conversation history. Increase `REQUEST_TIMEOUT_MS` only when a longer wait is acceptable.

### Agent tool calls do not work

Some local models do not support native tool calling. R.A.I.N. attempts a JSON-in-text fallback, but a model that does not reliably follow the requested format may fail to use tools. Try a stronger coding model with tool-calling support and review the server logs for errors.

### The agent cannot access a path

Agent paths must remain inside `WORKSPACE_DIR`. Absolute paths, parent-directory traversal, and symlink escapes are rejected intentionally. Move or copy the files you want to work on into the workspace.

### Port 3000 is already in use

Set a different port in `.env`, for example `PORT=3001`, restart the server, and open the matching local URL.

## Roadmap ideas

Potential directions for future development—not promises of existing functionality:

- More provider adapters behind the same provider interface
- Clearer task history and agent-session controls
- Additional automated security and compatibility tests
- Optional isolated command execution through containers
- Explicitly designed integrations for retrieval or web access

## Contributing

Issues, bug reports, and focused pull requests are welcome. When reporting a problem, include your Node.js version, operating system, model runtime, relevant configuration with secrets removed, and the steps needed to reproduce it.

For changes involving agent tools or network behavior, please include tests and document any new security assumptions.

## License

No license file was found during this README review. Until a license is added to the repository, do not assume that the code is available for unrestricted reuse. If you intend to publish or accept contributions, add an appropriate `LICENSE` file.
