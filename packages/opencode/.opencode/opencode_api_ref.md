# OpenCode HTTP API Reference

OpenCode `serve` exposes REST, Server-Sent Events (SSE), WebSocket, and the embedded web UI on the same HTTP server.

- Default host: `127.0.0.1`
- Default port: `0`, which first tries `4096`, then falls back to any free port
- OpenAPI document: `GET /doc`
- Request and response bodies are JSON unless an endpoint is explicitly streaming or WebSocket-based

Start a local server:

```bash
opencode serve --hostname 127.0.0.1 --port 4096
```

Development command from this package:

```bash
cd /Users/chenqi/opencode/packages/opencode
bun run --conditions=browser ./src/index.ts serve --hostname 127.0.0.1 --port 4096
```

---

## Authentication

Authentication is controlled by `OPENCODE_SERVER_PASSWORD`.

- If `OPENCODE_SERVER_PASSWORD` is not set, the server is unsecured and prints a warning on startup.
- If `OPENCODE_SERVER_PASSWORD` is set, requests must use HTTP Basic auth.
- Username defaults to `opencode`.
- Username can be overridden with `OPENCODE_SERVER_USERNAME`.

Header format:

```http
Authorization: Basic <base64(username:password)>
```

Example:

```bash
export OPENCODE_SERVER_PASSWORD="secret"
AUTH="$(printf 'opencode:%s' "$OPENCODE_SERVER_PASSWORD" | base64)"
curl -H "Authorization: Basic $AUTH" http://127.0.0.1:4096/global/health
```

For some clients, a query token is also accepted:

```text
?auth_token=<base64(username:password)>
```

---

## Workspace Routing

Most instance routes can be evaluated against a specific local directory or workspace.

| Mechanism | Example | Notes |
|-----------|---------|-------|
| Query `directory` | `?directory=/Users/chenqi/opencode` | Selects a local working directory |
| Header `x-opencode-directory` | `x-opencode-directory: /Users/chenqi/opencode` | Used when `directory` query is absent |
| Query `workspace` | `?workspace=wrk_...` | Selects a registered workspace |

Resolution order for the local directory is:

1. `directory` query parameter
2. `x-opencode-directory` request header
3. server process current working directory

When a session already belongs to a workspace, session-scoped routes prefer that session workspace.

---

## Error Responses

The server uses Effect HttpApi schemas, so exact error variants differ by endpoint. Common statuses:

| Status | Meaning |
|--------|---------|
| 400 | Invalid path, query, or JSON body |
| 401 | Missing or invalid Basic auth when auth is enabled |
| 404 | Resource not found |
| 409 | Conflict, for example an operation that cannot run in the current state |
| 500 | Internal server error |
| 503 | Workspace sync/proxy target unavailable |

Use `GET /doc` for the exact schema of each endpoint.

---

## Typical Session Workflow

### 1. Start the server

```bash
cd /Users/chenqi/opencode/packages/opencode
bun run --conditions=browser ./src/index.ts serve --hostname 127.0.0.1 --port 4096
```

### 2. Create a session

`POST /session`

Request body is optional. Common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Initial session title |
| `parentID` | string | No | Parent session when creating a child session |
| `agent` | string | No | Agent name |
| `model` | object | No | Model reference |
| `metadata` | object | No | Session metadata |
| `permission` | object | No | Permission ruleset |
| `workspaceID` | string | No | Workspace ID |

Example:

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  'http://127.0.0.1:4096/session?directory=/Users/chenqi/opencode' \
  -d '{"title":"API smoke test"}'
```

### 3. Send a prompt

`POST /session/{sessionID}/message`

The request body is `PromptInput` without `sessionID`.

Common fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parts` | array | Yes | User prompt parts |
| `messageID` | string | No | Reuse a specific message ID |
| `model` | object | No | `{ "providerID": "...", "modelID": "..." }` |
| `agent` | string | No | Agent override |
| `noReply` | boolean | No | Store the user message without running a model turn |
| `format` | string | No | Response format |
| `system` | string | No | System prompt override |
| `variant` | string | No | Prompt variant |

Text prompt example:

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  'http://127.0.0.1:4096/session/ses_xxx/message?directory=/Users/chenqi/opencode' \
  -d '{
    "parts": [
      { "type": "text", "text": "Reply with exactly OK." }
    ]
  }'
```

### 4. Subscribe to events

`GET /event`

The response is `text/event-stream`. Use it to follow session, message, permission, and runtime events.

```bash
curl -N 'http://127.0.0.1:4096/event?directory=/Users/chenqi/opencode'
```

### 5. Read messages

```bash
curl -sS 'http://127.0.0.1:4096/session/ses_xxx/message?directory=/Users/chenqi/opencode'
```

---

## Core Endpoints

### Health, Config, And Server Control

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/global/health` | Health check |
| `GET` | `/global/event` | Global SSE event stream |
| `GET` | `/global/config` | Read global config |
| `PATCH` | `/global/config` | Update global config |
| `POST` | `/global/dispose` | Dispose global server resources |
| `POST` | `/global/upgrade` | Start server upgrade |
| `GET` | `/config` | Read instance config |
| `PATCH` | `/config` | Update instance config |
| `GET` | `/config/providers` | List configured providers |
| `GET` | `/doc` | OpenAPI JSON document |

### Provider Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/provider` | List providers and models |
| `GET` | `/provider/auth` | List provider auth status |
| `POST` | `/provider/:providerID/oauth/authorize` | Start provider OAuth |
| `POST` | `/provider/:providerID/oauth/callback` | Complete provider OAuth |
| `PUT` | `/auth/:providerID` | Store provider credentials |
| `DELETE` | `/auth/:providerID` | Remove provider credentials |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/session` | List sessions |
| `GET` | `/session/status` | Current session run status |
| `POST` | `/session` | Create session |
| `GET` | `/session/:sessionID` | Get session metadata |
| `PATCH` | `/session/:sessionID` | Update session, such as title |
| `DELETE` | `/session/:sessionID` | Delete session |
| `GET` | `/session/:sessionID/children` | List child sessions |
| `GET` | `/session/:sessionID/todo` | Get session todo list |
| `GET` | `/session/:sessionID/diff` | Get session diff |
| `GET` | `/session/:sessionID/message` | List session messages |
| `GET` | `/session/:sessionID/message/:messageID` | Get one message |
| `POST` | `/session/:sessionID/message` | Send prompt and wait for response |
| `POST` | `/session/:sessionID/prompt_async` | Submit prompt asynchronously |
| `POST` | `/session/:sessionID/abort` | Abort active work |
| `POST` | `/session/:sessionID/init` | Initialize session |
| `POST` | `/session/:sessionID/share` | Share session |
| `DELETE` | `/session/:sessionID/share` | Unshare session |
| `POST` | `/session/:sessionID/summarize` | Summarize session |
| `POST` | `/session/:sessionID/fork` | Fork session |
| `POST` | `/session/:sessionID/command` | Execute a session command |
| `POST` | `/session/:sessionID/shell` | Run a shell command through the session |
| `POST` | `/session/:sessionID/revert` | Revert to a message/part boundary |
| `POST` | `/session/:sessionID/unrevert` | Undo a revert |
| `POST` | `/session/:sessionID/permissions/:permissionID` | Reply to permission request |
| `DELETE` | `/session/:sessionID/message/:messageID` | Delete message |
| `DELETE` | `/session/:sessionID/message/:messageID/part/:partID` | Delete message part |
| `PATCH` | `/session/:sessionID/message/:messageID/part/:partID` | Update message part |

### Events

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/event` | Instance SSE event stream |
| `GET` | `/global/event` | Global SSE event stream |

SSE frames use the standard `text/event-stream` wire format. Event payload schemas are included in `/doc`.

### Permissions And Questions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/permission` | List pending permission requests |
| `POST` | `/permission/:requestID/reply` | Reply to a permission request |
| `GET` | `/question` | List pending questions |
| `POST` | `/question/:requestID/reply` | Reply to a question |
| `POST` | `/question/:requestID/reject` | Reject a question |

### Files, Search, And VCS

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/find` | Search text with ripgrep |
| `GET` | `/find/file` | Search files |
| `GET` | `/find/symbol` | Search workspace symbols |
| `GET` | `/file` | List files |
| `GET` | `/file/content` | Read file content |
| `GET` | `/file/status` | File VCS status |
| `GET` | `/path` | Current path information |
| `GET` | `/vcs` | VCS repository info |
| `GET` | `/vcs/status` | VCS status |
| `GET` | `/vcs/diff` | VCS diff summary |
| `GET` | `/vcs/diff/raw` | Raw VCS diff |
| `POST` | `/vcs/apply` | Apply a patch |

Common query examples:

```text
/file?path=src/index.ts&directory=/Users/chenqi/opencode
/file/content?path=src/index.ts&directory=/Users/chenqi/opencode
/find?pattern=SessionPrompt&directory=/Users/chenqi/opencode
/find/file?query=session&limit=20&directory=/Users/chenqi/opencode
```

### Project And Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/project` | List projects |
| `GET` | `/project/current` | Get current project |
| `POST` | `/project/git/init` | Initialize git in current project |
| `PATCH` | `/project/:projectID` | Update project |
| `GET` | `/project/:projectID/directories` | List project directories |
| `POST` | `/experimental/project/:projectID/copy` | Create a project copy |
| `DELETE` | `/experimental/project/:projectID/copy` | Remove a project copy |
| `POST` | `/experimental/project/:projectID/copy/refresh` | Refresh project copy state |
| `GET` | `/experimental/workspace/adapter` | List workspace adapters |
| `GET` | `/experimental/workspace` | List workspaces |
| `POST` | `/experimental/workspace` | Create workspace |
| `POST` | `/experimental/workspace/sync-list` | Sync workspace list |
| `GET` | `/experimental/workspace/status` | Workspace connection status |
| `DELETE` | `/experimental/workspace/:id` | Remove workspace |
| `POST` | `/experimental/workspace/warp` | Warp a session into a workspace |
| `POST` | `/experimental/control-plane/move-session` | Move a session to another project directory |

### PTY

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pty/shells` | List available shells |
| `GET` | `/pty` | List PTY sessions |
| `POST` | `/pty` | Create PTY session |
| `GET` | `/pty/:ptyID` | Get PTY session |
| `PUT` | `/pty/:ptyID` | Update PTY session |
| `DELETE` | `/pty/:ptyID` | Remove PTY session |
| `POST` | `/pty/:ptyID/connect-token` | Create WebSocket connect token |
| `GET` | `/pty/:ptyID/connect` | WebSocket PTY connection |

PTY WebSocket connections use a short-lived connect token created by `/pty/:ptyID/connect-token`.

### MCP

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mcp` | List MCP server status |
| `POST` | `/mcp` | Add MCP server config |
| `POST` | `/mcp/:name/auth` | Start MCP auth |
| `POST` | `/mcp/:name/auth/callback` | Complete MCP auth callback |
| `POST` | `/mcp/:name/auth/authenticate` | Authenticate MCP |
| `DELETE` | `/mcp/:name/auth` | Remove MCP auth |
| `POST` | `/mcp/:name/connect` | Connect MCP server |
| `POST` | `/mcp/:name/disconnect` | Disconnect MCP server |

### TUI Remote Control

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tui/append-prompt` | Append text to the TUI prompt |
| `POST` | `/tui/open-help` | Open help dialog |
| `POST` | `/tui/open-sessions` | Open sessions dialog |
| `POST` | `/tui/open-themes` | Open themes dialog |
| `POST` | `/tui/open-models` | Open model dialog |
| `POST` | `/tui/submit-prompt` | Submit current TUI prompt |
| `POST` | `/tui/clear-prompt` | Clear current prompt |
| `POST` | `/tui/execute-command` | Execute a TUI command |
| `POST` | `/tui/show-toast` | Show a TUI toast |
| `POST` | `/tui/publish` | Publish a TUI event |
| `POST` | `/tui/select-session` | Select a TUI session |
| `GET` | `/tui/control/next` | Poll next TUI control request |
| `POST` | `/tui/control/response` | Send TUI control response |

### Commands, Agents, Skills, And References

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/command` | List commands |
| `GET` | `/agent` | List agents |
| `GET` | `/skill` | List skills |
| `GET` | `/lsp` | List LSP status |
| `GET` | `/formatter` | List formatters |
| `GET` | `/reference` | List reference sources |

### Experimental

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/experimental/console` | Get active Console provider metadata |
| `GET` | `/experimental/console/orgs` | List switchable Console orgs |
| `POST` | `/experimental/console/switch` | Switch Console org |
| `GET` | `/experimental/tool` | List tool definitions for a provider/model |
| `GET` | `/experimental/tool/ids` | List tool IDs |
| `GET` | `/experimental/worktree` | List worktrees |
| `POST` | `/experimental/worktree` | Create worktree |
| `DELETE` | `/experimental/worktree` | Remove worktree |
| `POST` | `/experimental/worktree/reset` | Reset worktree |
| `GET` | `/experimental/session` | List sessions with experimental query controls |
| `POST` | `/experimental/session/:sessionID/background` | Toggle session background state |
| `GET` | `/experimental/resource` | Read experimental resource data |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sync/start` | Start workspace sync |
| `POST` | `/sync/replay` | Replay sync events |
| `POST` | `/sync/steal` | Steal session into workspace |
| `POST` | `/sync/history` | List sync event history |

---

## V2 `/api/*` Endpoints

The server also mounts the newer V2 API from `@opencode-ai/server`. These routes use a stable envelope on many responses, usually `{ "data": ... }`, and are the preferred surface for newer durable Session V2 clients. Exact request and response schemas are available from `GET /doc`.

### V2 Sessions And Messages

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/session` | List V2 sessions |
| `POST` | `/api/session/:sessionID/prompt` | Durably admit one prompt and schedule execution |
| `POST` | `/api/session/:sessionID/compact` | Compact a session conversation |
| `POST` | `/api/session/:sessionID/wait` | Wait for a session agent loop to become idle |
| `GET` | `/api/session/:sessionID/context` | Get active context messages after the last compaction |
| `GET` | `/api/session/:sessionID/message` | List projected session messages |
| `GET` | `/api/event` | V2 event stream |

Common query fields for `GET /api/session`:

| Query | Type | Description |
|-------|------|-------------|
| `directory` | absolute path | Filter by local directory |
| `project` | string | Filter by project ID |
| `subpath` | relative path | Narrow a project query |
| `workspace` | string | Filter by workspace ID |
| `limit` | number | Page size |
| `order` | `asc` or `desc` | First-page order |
| `search` | string | Search sessions |
| `cursor` | string | Opaque pagination cursor |

V2 prompt example:

```bash
curl -sS \
  -H 'Content-Type: application/json' \
  'http://127.0.0.1:4096/api/session/ses_xxx/prompt?directory=/Users/chenqi/opencode' \
  -d '{
    "prompt": {
      "parts": [
        { "type": "text", "text": "Reply with exactly OK." }
      ]
    },
    "delivery": "steer"
  }'
```

### V2 Support Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | V2 health check |
| `GET` | `/api/provider` | List providers |
| `GET` | `/api/provider/:providerID` | Get one provider |
| `GET` | `/api/model` | List models |
| `GET` | `/api/agent` | List agents |
| `GET` | `/api/command` | List commands |
| `GET` | `/api/skill` | List skills |
| `GET` | `/api/fs/read` | Read filesystem entry |
| `GET` | `/api/fs/list` | List filesystem entries |
| `GET` | `/api/permission/request` | List permission requests |
| `GET` | `/api/permission/saved` | List saved permissions |
| `DELETE` | `/api/permission/saved/:id` | Remove saved permission |
| `GET` | `/api/session/:sessionID/permission` | List session permission requests |
| `POST` | `/api/session/:sessionID/permission/:requestID/reply` | Reply to session permission request |
| `GET` | `/api/question/request` | List question requests |
| `POST` | `/api/session/:sessionID/question/:requestID/reply` | Reply to session question |
| `POST` | `/api/session/:sessionID/question/:requestID/reject` | Reject session question |

---

## Useful Smoke Tests

Health:

```bash
curl -sS http://127.0.0.1:4096/global/health
```

Fetch OpenAPI:

```bash
curl -sS http://127.0.0.1:4096/doc > /tmp/opencode-openapi.json
```

List sessions for a workspace directory:

```bash
curl -sS 'http://127.0.0.1:4096/session?directory=/Users/chenqi/opencode'
```

Create session, then submit an async prompt:

```bash
SESSION_ID="$(
  curl -sS \
    -H 'Content-Type: application/json' \
    'http://127.0.0.1:4096/session?directory=/Users/chenqi/opencode' \
    -d '{"title":"API smoke test"}' \
  | jq -r '.id'
)"

curl -sS \
  -H 'Content-Type: application/json' \
  "http://127.0.0.1:4096/session/$SESSION_ID/prompt_async?directory=/Users/chenqi/opencode" \
  -d '{
    "parts": [
      { "type": "text", "text": "Reply with exactly OK." }
    ]
  }'
```

Watch events while a prompt is running:

```bash
curl -N 'http://127.0.0.1:4096/event?directory=/Users/chenqi/opencode'
```

---

## Notes For Client Authors

- Prefer `GET /doc` for generated clients and exact schemas.
- Prefer `/session/:sessionID/prompt_async` plus `/event` for UI clients that need streaming/progress behavior.
- Prefer `/session/:sessionID/message` for simple scripts that can wait until the model turn completes.
- Always pass `directory` or `x-opencode-directory` from desktop/web clients so calls do not accidentally resolve against the server process cwd.
- When auth is enabled, remember that `/doc`, the embedded UI, SSE routes, and PTY WebSocket setup are also protected.
