# Build log

One line per step.

- 2026-11-14: Repository skeleton: Apache-2.0 license, README stub with AI disclosure, package manifest, toolchain decision (ADR 0001).
- 2026-11-14: G0 measured on the pinned gateway: demo stack skeleton (gateway, mock upstream, seed), quota fixtures for 200/401/403, counters moved after mock traffic (ADR 0002, API contract draft).
- 2026-11-14: Pure core (src/core): quota client, shape check, limit model, run-out forecast, formatting, language bundles; unit tests on recorded fixtures; fast gate script (ADR 0003).
- 2026-11-14: VS Code extension without the panel (src/extension): status bar for every state, tooltip table with forecast and command links, seven commands, SecretStorage key, back-off poller, threshold and forecast notifications, English and Malay manifest texts, own gauge icon; design brief (docs/DESIGN.md, ADR 0004).
- 2026-11-14: Details panel (webview): every limit with a threshold bar, left, reset and forecast; usage chart; spend per model; key status, gateway URL and version; strict policy with a nonce, five allowed commands, focus kept across refreshes (ADR 0005).
- 2026-11-14: Demo traffic profile (mock requests through a demo key), seed reuses keys on re-run, demo README; contract tests against the pinned gateway with the extension's own client, 6 passed (docs/TEST-RESULTS.md, ADR 0006).
