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
Node.js 22 or later is needed when the client starts it with `node` (the `engines.node` field in `package.json`).

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
- Overall: `read_at`, `gateway`, `key_name`, `key_hint`, `is_active`, `calendar_aligned` (the key's setting when the gateway
  reports it, `null` on v2.5.1, which does not; added after the call below was recorded), `is_exhausted`,
  `will_exhaust_before_reset` (true when
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

It prints the limit closest to running out, with the same words and rounding as the editor status bar, including the
provider or model name at the end when that limit is not the key's own (`Bifrost Budget used up · resets in 23h · openai`).
The exit code is
0 after a reading and 1 when the gateway could not be read or no key is set. `--format json` prints the structured result
of `get_budget_status` instead. The key is never printed.

Claude Code status line (`~/.claude/settings.json`), as one example of an agent that can show a command's output:

```json
{ "statusLine": { "type": "command", "command": "node /path/to/dist/cli.js status" } }
```

tmux: `set -g status-right '#(node /path/to/dist/cli.js status)'` with `status-interval 60`.

Each call is one gateway read and the command keeps no cache, so cache the output yourself if your status line refreshes
more often than once a minute.

## Pre-flight check: `guard`

`guard` answers one question before a long agent run or a CI job: is there enough left on this key to start? It reads the
same environment variables as `status` and decides on the limit closest to running out.

```sh
node /path/to/dist/cli.js guard --min-remaining 20
```

| Exit code | Meaning | Output |
|---|---|---|
| 0 | Go: the closest limit has at least the asked share left, or the key has no limit | one sentence on stdout |
| 2 | Stop: that limit has less left than asked, is used up, or the key is inactive | one sentence on stdout |
| 1 | The quota could not be read (no key, key rejected or expired, gateway offline) or the argument is wrong | one sentence on stderr |

`--min-remaining` is the percent of the limit that must still be left, from 0 to 100 (`20` and `20%` both work). Without
it the value is 0, so `guard` stops only when a limit is used up. The key is never printed.

Output measured on the demo gateway on 2026-11-17: a fresh key, then a key with a limit of 3 requests per hour before and
after 3 real requests through the gateway (keys shortened to their last 4 characters):

```
$ BIFROST_VIRTUAL_KEY=…9cb2 node dist/cli.js guard --min-remaining 10
Bifrost guard: go. Closest limit: 0% · $5.00 left · resets in 23h 59m; at least 10% left is required.
exit 0

$ BIFROST_VIRTUAL_KEY=…7955 node dist/cli.js guard --min-remaining 0
Bifrost guard: go. Closest limit: 0% · 3 requests left · resets in 59m; at least 0% left is required.
exit 0

$ BIFROST_VIRTUAL_KEY=…7955 node dist/cli.js guard --min-remaining 0
Bifrost guard: stop. Closest limit: Requests used up · resets in 59m; at least 0% left is required.
exit 2
```

The contract test `test/contract/guard.test.ts` repeats this run against the pinned gateway image.

### As a CI step

Put it before the step that spends the budget. Exit 2 fails the job with the sentence above in the log, so nobody has to
open the gateway to see why:

```yaml
- name: Check the model budget
  env:
    BIFROST_BASE_URL: ${{ vars.BIFROST_BASE_URL }}
    BIFROST_VIRTUAL_KEY: ${{ secrets.BIFROST_VIRTUAL_KEY }}
  run: node dist/cli.js guard --min-remaining 15
```

To skip the expensive step instead of failing the job, read the exit code yourself (`if node dist/cli.js guard …; then`).
Exit 1 is an error, not a stop: decide separately whether a gateway that cannot be read should block the job.

### Before an agent run

A script that starts an agent on a long task can call `guard` first and stop with the sentence when the key cannot cover
the run. An agent that has the MCP tool can make the same decision itself with `get_budget_status`
([`AGENTS.example.md`](AGENTS.example.md)); `guard` is for the places where nothing reads that tool, such as a scheduled
job or a wrapper script.
