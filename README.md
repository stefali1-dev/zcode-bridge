# zcode-bridge

Command `zbridge`. Lets AI agents use the **ZCode desktop app** — start task chats, send messages, switch model / token plan / permission mode, read replies — through a CLI or an MCP server. Built for the case where one agent (Claude Code, another ZCode agent, anything) delegates work to a chat in the ZCode app.

## How it works

```
agent ──MCP──▶ http://127.0.0.1:7433/mcp ─┐
agent ──CLI──▶ zbridge <command> ─────────┤
                                          ▼
                            zbridge serve  (one process)
                            ├── FIFO queue around every window action
                            ├── drives the app over Chromium's DevTools socket
                            └── reads replies from session transcript files
```

- One shared process owns the app window. All callers are its clients, so any number of agents can call at the same time; each window action takes a few seconds, waits never hold the window.
- Reads, waits, and listings never touch the window — they parse the chat transcript files on disk, so they're instant and fully parallel.

## Requirements

- macOS with the ZCode desktop app installed
- Node ≥ 20.11

## Setup

```bash
git clone https://github.com/stefali1-dev/zcode-bridge.git
cd zcode-bridge
npm install && npm run build
npm link          # optional: puts `zbridge` on PATH
```

The app must run with its remote-control socket on (one relaunch, no data lost):

```bash
zbridge doctor --restart
```

`doctor` checks everything (app, socket, selectors, transcripts) and reports what's broken. The bridge refuses to relaunch the app while chats were active in the last 30 seconds unless you pass `--force` — restarting kills in-flight agent sessions.

## CLI

```bash
zbridge send "review this diff"               # new chat; waits for the reply
zbridge send "hard problem" --model glm-5.3    # paid tier instead of the default
zbridge read --chat latest --tail 5            # conversation so far
zbridge wait --chat c1                         # block until a chat finishes
zbridge list                                   # chats known to the bridge
zbridge status                                 # app / socket / queue state
zbridge snapshot | click <ref> | type <ref> <text> | screenshot   # raw UI escape hatch
```

## MCP

```bash
zbridge serve    # start once; any command auto-starts it too
```

Register in any MCP client (Claude Code, ZCode itself, …):

```bash
claude mcp add --transport http zbridge http://127.0.0.1:7433/mcp
```

Endpoint: `http://127.0.0.1:7433/mcp` (stateless streamable HTTP, POST-only).

### Tools

| Tool | What it does |
|---|---|
| `app_status` | app running, socket on, connection, queue depth, known models |
| `chat_send` | send a message (creates a Tasks chat if `chat` omitted), optionally set `model` / `plan` / `mode` first; waits for the reply by default |
| `chat_read` | conversation so far (newest last, truncated) |
| `chat_wait` | block until the chat stops working, return its reply |
| `chats_list` | known chats with running state, model, owner |
| `ui_snapshot` / `ui_click` / `ui_type` / `ui_screenshot` | escape hatch for anything not covered |

`chat_send` is one call by design — settings are optional parameters, omitted settings stay as the chat already has.

## Defaults and safety

- **New chats use `glm-5.3-flash` on the Start Plan bundle** (the free token pool), falling back to the individual plan if the bundle is unavailable. The result reports the `model` and `plan` that actually applied.
- New chats run in **full-access** permission mode (a chat stuck waiting for a confirmation nobody watches is worse); override per call with `mode`.
- Chats are created in the **Tasks** area (no folder needed).
- The server binds to 127.0.0.1 only, has no password, and **refuses browser-originated requests** (cross-origin POSTs and DNS rebinding) — only local processes can use it.

## Limitations

- `effort` is accepted but rejected with a clear error until its control is located in the app's UI.
- The `ui_*` tools are atomic per call; there is no exclusive lease for multi-step click-throughs yet.

## Development

```bash
npm test          # unit tests (queue, transcripts, registry)
zbridge doctor    # live health check against the real app
```

After a ZCode app update, re-verify selectors with `node scripts/dom-dump.mjs` and `node scripts/menu-dump.mjs`; they live in `src/driver/selectors.ts`.
