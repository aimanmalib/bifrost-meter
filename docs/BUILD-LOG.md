# Build log

One line per step.

- 2026-11-14: Repository skeleton: Apache-2.0 license, README stub with AI disclosure, package manifest, toolchain decision (ADR 0001).
- 2026-11-14: G0 measured on the pinned gateway: demo stack skeleton (gateway, mock upstream, seed), quota fixtures for 200/401/403, counters moved after mock traffic (ADR 0002, API contract draft).
- 2026-11-14: Pure core (src/core): quota client, shape check, limit model, run-out forecast, formatting, language bundles; unit tests on recorded fixtures; fast gate script (ADR 0003).
- 2026-11-14: VS Code extension without the panel (src/extension): status bar for every state, tooltip table with forecast and command links, seven commands, SecretStorage key, back-off poller, threshold and forecast notifications, English and Malay manifest texts, own gauge icon; design brief (`docs/DESIGN.md`, ADR 0004).
- 2026-11-14: Details panel (webview): every limit with a threshold bar, left, reset and forecast; usage chart; spend per model; key status, gateway URL and version; strict policy with a nonce, five allowed commands, focus kept across refreshes (ADR 0005).
- 2026-11-14: Demo traffic profile (mock requests through a demo key), seed reuses keys on re-run, demo README; contract tests against the pinned gateway with the extension's own client, 6 passed (docs/TEST-RESULTS.md, ADR 0006).
- 2026-11-14: End-to-end tests in code-server with the packaged .vsix against the pinned gateway: key, status bar numbers from the quota response, panel, traffic, warning, 401, 403, offline; 9 passed; dark, light and high contrast screenshots (docs/TEST-RESULTS.md, ADR 0007).
- 2026-11-14: Version floor lowered to VS Code 1.90; spend per model reads the gateway's total_cost; budget limit includes an active admin override; fixtures re-recorded on the pinned gateway; contract 7 passed, end to end 9 passed (ADR 0008).
- 2026-11-14: Design review pass: notification wording, "resets in" in the status bar, a sentence instead of a flat chart, high contrast bar track, readable forecast text in light themes; preview sheets of 14 states in three themes at 320 and 520 px with no horizontal overflow; install, configuration, security, architecture and upstreaming guides; API contract final (ADR 0009).
- 2026-11-14: MCP server `get_budget_status` (stdio, official SDK, `dist/mcp.js` in the `.vsix`), registered with VS Code 1.101+ through the MCP server definition provider API and detected at run time; unit 352 passed, contract 9 passed including two MCP calls on the pinned gateway; setup guide, a real tool call and an `AGENTS.md` example (ADR 0010).
- 2026-11-14: Demo video recorded from the running stack: a separate recording seed with a small budget, one continuous browser recording of the packaged extension, scenes cut at normal speed with burned-in captions (77 s, 1920x1080, silent), README GIF and three screenshots (ADR 0011).
