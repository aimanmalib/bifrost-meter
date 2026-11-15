# Architecture

Bifrost Meter is one npm package with two layers: a pure core that knows the gateway, and a thin VS Code layer that shows
the result. It reads one endpoint of an unmodified Bifrost gateway and changes nothing on it.

```
 VS Code / code-server                                   Bifrost gateway (unmodified)
+--------------------------------------------+          +-------------------------------+
| src/extension                              |          |                               |
|  poller --> controller --> view/tooltip    |  x-bf-vk |  GET /api/governance/         |
|     ^           |       \-> panelHtml      | -------> |      virtual-keys/quota       |
|     |           v       \-> notifications  |  <------ |  (budgets, rate limits,       |
|  settings   src/core                       |   JSON   |   spend per model)            |
|  secrets     client -> schema -> model     |          |                               |
|              forecast, format, i18n        |  no key  |  GET /api/version             |
|                                            | -------> |                               |
+--------------------------------------------+          +-------------------------------+
```

## src/core (no VS Code import, enforced by lint)

| Module | Job |
| --- | --- |
| `client.ts` | The one HTTP call. 5 second timeout, `x-bf-vk` header, same-origin redirects only, refuses plain `http://` to public hosts unless allowed. Maps 401, 403, 404, timeouts and network errors to named results. |
| `schema.ts` | Shape check of the quota response. A missing required field is a named error, never a zero. |
| `model.ts` | Turns the response into one flat list of limits (budget, tokens, requests; per key, provider or model), applies an active admin override, picks the limit closest to running out. |
| `duration.ts` | Reads the gateway's reset durations (`30s`, `1h30m`, `1d`, `1M`) and computes the next reset. |
| `forecast.ts` | Linear run-out forecast from recent samples; dropped when usage falls or the limit resets. |
| `format.ts` | Percent, money, counts, durations, clock times. Percent used rounds down so "100%" means used up. |
| `i18n.ts` | Language choice and lookup in `l10n/bundle.l10n*.json` (English and Malay, same keys). |

## src/mcp (MCP server, no VS Code import, enforced by lint)

| Module | Job |
| --- | --- |
| `server.ts` | Stdio entry point, bundled as `dist/mcp.js`. |
| `config.ts` | Reads `BIFROST_*` environment variables with the same defaults and limits as the extension settings. |
| `tool.ts` | The `get_budget_status` tool: one quota read, output schema, read-only annotations. |
| `status.ts` | Builds the structured result and text summary from the core's limits and forecast. |

## src/cli (terminal status line, no VS Code import)

| Module | Job |
| --- | --- |
| `cli.ts` | Entry point, bundled as `dist/cli.js`: `status` prints one line, `--format json` the structured result. |
| `line.ts` | Turns one quota reading into the line, with the status bar's own strings and rounding. |

See docs/MCP.md and ADR 0010.

## src/extension (VS Code)

| Module | Job |
| --- | --- |
| `extension.ts` | Wires everything on activation. |
| `settings.ts`, `secrets.ts` | Typed settings; key from secret storage, then the environment. |
| `poller.ts` | Refresh interval, exponential back-off after errors, slower when the window is not focused. |
| `controller.ts` | Fetch, keep samples, decide notifications, render. Takes storage and rendering as parameters, so unit tests run without VS Code. |
| `state.ts`, `view.ts` | The 14 display states of the design brief, plus four settings and connection errors, and their status bar text, icon, background and accessibility label. |
| `tooltip.ts`, `statusBar.ts` | Tooltip table with command links; the only place that touches the status bar item. |
| `panel.ts`, `panelHtml.ts`, `panelStyle.ts`, `chart.ts` | The details panel: pure HTML and SVG generation, then a webview with a strict content security policy. |
| `notifications.ts`, `noteText.ts` | Once per threshold per reset cycle, once per forecast; state kept in the editor's global storage. |
| `commands.ts` | The seven commands. |
| `mcpProvider.ts` | Registers `dist/mcp.js` with the editor's MCP server list when the editor has the API (VS Code 1.101 and later). |

Most modules are pure functions of their input; only `extension.ts`, `statusBar.ts`, `panel.ts` and `commands.ts` call the
VS Code API.

## Data flow of one refresh

1. The poller fires. The controller reads the key and URL and calls `client.fetchQuota`.
2. The response is shape-checked and normalised into limits. The forecast store adds a sample per limit and drops samples
   from an earlier reset cycle.
3. The display state is chosen (OK, warning, critical, used up, error states). The status bar, tooltip and an open panel
   re-render from it. Notifications fire when a threshold or forecast is newly crossed in this cycle.
4. The poller schedules the next refresh: the interval, longer after errors, longer when unfocused.

## Tests

- Unit tests (`test/unit`, vitest) cover the core and every display state in both languages, with fixtures recorded from
  the pinned gateway.
- Contract tests (`npm run test:contract`) start the pinned gateway with a mock upstream and check the responses the core
  relies on.
- End-to-end tests (`npm run test:e2e`) install the packaged `.vsix` in code-server and drive it with Playwright.

Results and how to repeat them: [TEST-RESULTS.md](TEST-RESULTS.md). The response fields: [API-CONTRACT.md](API-CONTRACT.md).
