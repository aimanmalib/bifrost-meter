# MCP server: `get_budget_status`

Bifrost Meter ships a small [Model Context Protocol](https://modelcontextprotocol.io) server next to the extension. It gives a
coding agent the same numbers the status bar shows, so the agent can check what is left on its Bifrost virtual key before
it starts a long task.

- One tool, `get_budget_status`, with no arguments. Read-only: it sends one `GET` to the quota endpoint and nothing else.
- Transport: stdio. File: `dist/mcp.js` (one bundled file, inside the `.vsix`; `node dist/mcp.js` after `npm run build`).
- Built with the official MCP TypeScript SDK. It calls no model and sends no telemetry.

## Configuration

The server reads its environment only.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BIFROST_BASE_URL` | `http://localhost:8080` | Gateway URL, as in `bifrostMeter.baseUrl`. |
| `BIFROST_VIRTUAL_KEY` | (none) | The virtual key. Without it the tool returns an error that says so. |
| `BIFROST_ALLOW_INSECURE_HTTP` | `0` | `1` allows plain `http` to a public host (the key would travel unencrypted). Loopback and private addresses never need it. |
| `BIFROST_METER_LANGUAGE` | `auto` | `en` or `ms` for the text summary; `auto` follows `LANG`. Field names stay English. |
| `BIFROST_METER_FORECAST_WINDOW_MINUTES` | `30` | Look-back window for the run-out forecast (5 to 1440). |

The same rules as the extension apply: the key goes only to the configured gateway, redirects to another host are refused,
and the key never appears in the result, the text or the server's error output (only its last four characters, as
`key_hint`).

## In VS Code: registered for you

On VS Code 1.101 and later, the extension registers the server with the editor through the MCP server definition provider
API (`contributes.mcpServerDefinitionProviders` and `vscode.lm.registerMcpServerDefinitionProvider`). It appears as
"Bifrost Meter" in the MCP server list and in the chat tool picker. It runs with the editor's own runtime, uses the gateway
URL and options from your settings, and gets the key from the editor's secret storage at the moment the server starts. The
key is not part of the listed server definition. Changing the key or the settings tells the editor to restart the server.

On older editors the extension skips this step and works as before; use the manual setup below.

## Manual setup for other MCP clients

Find `dist/mcp.js`: inside the installed extension folder (for example
`~/.vscode/extensions/aimanmalib.bifrost-meter-<version>/dist/mcp.js`), or in a clone after `npm ci && npm run build`.
Node.js 20 or later is needed when the client starts it with `node`.

VS Code without the automatic registration, `.vscode/mcp.json` (the key is asked for once and kept by the editor):

```json
{
  "inputs": [
    { "type": "promptString", "id": "bifrost-key", "description": "Bifrost virtual key", "password": true }
  ],
  "servers": {
    "bifrost-meter": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/dist/mcp.js"],
      "env": { "BIFROST_BASE_URL": "http://localhost:8080", "BIFROST_VIRTUAL_KEY": "${input:bifrost-key}" }
    }
  }
}
```

Clients that use an `mcpServers` file (Claude Desktop, Cursor and others):

```json
{
  "mcpServers": {
    "bifrost-meter": {
      "command": "node",
      "args": ["/path/to/dist/mcp.js"],
      "env": { "BIFROST_BASE_URL": "http://localhost:8080", "BIFROST_VIRTUAL_KEY": "<your virtual key>" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add bifrost-meter --env BIFROST_BASE_URL=http://localhost:8080 --env BIFROST_VIRTUAL_KEY=<your virtual key> -- node /path/to/dist/mcp.js
```

A key written into a client's config file is stored in plain text by that client. Prefer the client's own secret prompt
where it has one (as in the VS Code example).

## What the tool returns

Structured content (described by the tool's output schema) and the same facts as short text. The tool reports facts only;
what to do with them is up to the agent and the user.

- Per limit: `kind` (`budget`, `tokens`, `requests`), `scope` (`key`, `provider`, `model`) and `scope_label`, `unit`
  (`usd`, `tokens`, `requests`), `limit`, `used`, `remaining`, `percent`, `is_exhausted`, `reset_period`, `resets_at`,
  `forecast` (`insufficient_data`, `steady`, `rising`, `exhausted`), `exhausts_at`, `will_exhaust_before_reset`.
- Overall: `read_at`, `gateway`, `key_name`, `key_hint`, `is_active`, `is_exhausted`, `will_exhaust_before_reset` (true when
  any limit is forecast to run out before its reset, false when every open limit is known to be safe, null while the
  forecast still lacks readings).
- The forecast needs at least two readings two minutes apart in the same server process. The first call therefore always
  says `insufficient_data`.
- Errors (no key, key rejected or expired, gateway offline, unexpected response) come back as a tool error with one
  sentence saying what is wrong, not as a crash.

A real call, made by the contract tests with the SDK client over stdio against the pinned gateway image and the mock
upstream (`npm run test:contract`; the gateway ran on a random local port):

```text
Key demo-team-a (…8280), read at 2026-11-14T18:46:36.270Z.
Budget: $0.0013 of $5.00 used (<0.1%), $4.99 left, resets in 23h 59m.
Tokens: 600 of 100k used (0.6%), 99.4k tokens left, resets in 59m.
Requests: 3 of 200 used (1%), 197 requests left, resets in 59m.
No forecast yet: it needs two readings at least 2m apart.
```

```json
{
  "read_at": "2026-11-14T18:46:36.270Z",
  "gateway": "http://127.0.0.1:35785",
  "key_name": "demo-team-a",
  "key_hint": "…8280",
  "is_active": true,
  "is_exhausted": false,
  "will_exhaust_before_reset": null,
  "limits": [
    {
      "kind": "requests",
      "scope": "key",
      "scope_label": null,
      "unit": "requests",
      "limit": 200,
      "used": 3,
      "remaining": 197,
      "percent": 1.5,
      "is_exhausted": false,
      "reset_period": "1h",
      "resets_at": "2026-11-14T19:46:13.872Z",
      "forecast": "insufficient_data",
      "exhausts_at": null,
      "will_exhaust_before_reset": null
    }
  ]
}
```

(The budget and token entries have the same shape and are left out here.)

## Telling an agent to use it

See [`AGENTS.example.md`](AGENTS.example.md) for a few lines to paste into a project's `AGENTS.md`.

## Prior art

[bifrost-budget](https://github.com/Jasonrve/bifrost-budget) is an MCP server in Python that reads Bifrost budgets with
admin credentials and Entra sign-in, over HTTP. This server differs in scope: it reads only the user's own virtual key,
runs over stdio, and installs with the editor extension.

## Terminal status line

The same reading is available as one line of text, for places where an agent runs outside the editor: an agent's status
line, tmux, or a shell prompt. `dist/cli.js` is in the `.vsix` next to `dist/mcp.js` and reads the same environment
variables.

```sh
BIFROST_BASE_URL=http://localhost:8080 BIFROST_VIRTUAL_KEY=<your key> node /path/to/dist/cli.js status
```

Output measured on the demo gateway on 2026-11-15, three readings some seconds apart, then a wrong key:

```
Bifrost 17% · $0.82 left · resets in 3m
Bifrost 26% · $0.73 left · resets in 3m
Bifrost 37% · $0.62 left · resets in 3m
Bifrost Key rejected
```

It prints the limit closest to running out, with the same words and rounding as the editor status bar. The exit code is
0 after a reading and 1 when the gateway could not be read or no key is set. `--format json` prints the structured result
of `get_budget_status` instead. The key is never printed.

Claude Code status line (`~/.claude/settings.json`), as one example of an agent that can show a command's output:

```json
{ "statusLine": { "type": "command", "command": "node /path/to/dist/cli.js status" } }
```

tmux: `set -g status-right '#(node /path/to/dist/cli.js status)'` with `status-interval 60`.
