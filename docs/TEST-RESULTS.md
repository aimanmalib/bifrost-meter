# Test results

Latest recorded run of each suite. The fast gate (`bash scripts/gerbang-ujian.sh`: lint, type check, unit tests, build,
package) runs on every change; the suites below need Docker and run when the files they cover change.

## Clean clone (v0.1.0 release check)

`git archive HEAD` of the release commit, unpacked into an empty folder, then inside the pinned
`node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914` (`node:22.23.4-alpine`, Node v22.23.4)
container: `npm ci`, lint, type check, unit tests, build, `npm run package`.

- Date: 2026-11-14
- Result: **all steps passed**; unit **352 passed, 0 failed** in 19 test files; `bifrost-meter.vsix` 244.9 KB (10 files),
  version 0.1.0. This is the file attached to the v0.1.0 release.

## Unit (`npm run gate`)

Lint, type check, unit tests (vitest), production build and `.vsix` package, with no Docker and no network. Runs on every
change.

- Date: 2026-11-15
- Result: **378 passed, 0 failed** in 19 test files; `bifrost-meter.vsix` 245.3 KB (10 files), version 0.1.1

## Contract (`npm run test:contract`)

Runs the extension's own quota client, and the bundled MCP server through the official SDK client over stdio, against the pinned official gateway image and the mock upstream from `demo/`, on a
free `127.0.0.1` port, then removes the stack (`docker compose down -v`). Without Docker the suite is skipped with a message.

- Date: 2026-11-15
- Gateway: `maximhq/bifrost@sha256:5ec9873acaf1687556b6e4dd854b92b539d9debf87a5a683b66338648b84d3c8` (`v2.5.1`)
- Result: **11 passed, 0 failed**; 56 s in total for the v0.1.1 check, including the 200-read latency test below
  (earlier runs: 57 s, 64 s, 67 s and 71 s, of which about 40 s was starting and seeding the gateway)

| Test | Result |
|---|---|
| `/api/version` answers without a key | passed |
| 200 with the seeded budgets and rate limits for every demo key (expected values read from `demo/demo.config.json`) | passed |
| 401 without a key header | passed |
| 401 for an unknown key | passed |
| 403 "expired" for a key past its expiry | passed |
| Budget, token and request counters move after 3 mock requests; spend per model shows a positive amount for each model used | passed |
| After an admin override (3 on a budget of 2) the meter's budget limit is the enforced 5, while `max_limit` stays 2 | passed |
| Calendar-aligned monthly and quarterly keys report `last_reset` on the UTC boundary, and the meter's next reset is the next boundary; a rolling monthly key resets 30 days after `last_reset` | passed |
| MCP: `tools/list` shows `get_budget_status`; `tools/call` returns the same limits as the quota endpoint for the same key, without the key in the result | passed |
| MCP: an unknown key gives a tool error ("Key rejected"), not a crash | passed |
| 200 sequential quota reads all return 200 (latency below) | passed |

### Cost to the gateway

`test/contract/latency.test.ts` reads the quota endpoint 200 times in a row through the extension's own client, on the
same pinned gateway and host as the contract run above (2026-11-14, a shared build host):

| Reads | p50 | p95 | max |
|---|---|---|---|
| 200 | 6.9 ms | 12.2 ms | 96.2 ms |
| 200 (v0.1.0 release check) | 7.1 ms | 51.3 ms | 151.1 ms |
| 200 (v0.1.1 check, 2026-11-15) | 6.8 ms | 13.0 ms | 71.7 ms |

The median holds steady between runs; the tail depends on other work on the shared host.

The meter makes one such read per editor window every 60 s by default (`bifrostMeter.pollIntervalSeconds`, minimum 15),
four times less often while the window is not focused. The packaged `.vsix` is 245 KB.

## One-command demo (`demo/run.sh`)

Run from a clean `git archive` copy of the repository with only Docker on the path (2026-11-14). The first run built the
extension in the pinned Node 22 container, started the stack and printed the editor link in about one minute. A Playwright
check then opened the link without typing anything: the status bar showed the request limit of the traffic key
(`1% · 197 requests left · resets in 59m`) and moved to `3% · 193 requests left` within 20 seconds of mock traffic.
`demo/run.sh stop` left no demo containers.

Run again on 2026-11-15 from a clean copy, on a host where port 8080 was already taken, with nothing but Docker on the
path. Before ADR 0014 the script stopped with Docker's "port is already allocated" error. Now it reported that the demo
gateway uses 8081 and printed the editor link after 75 s, including the build of the extension (45 s on a second run).
With a traffic key name that is not in the config, the start stopped with a message and left no containers.

A Playwright check then opened the printed link without typing anything and watched one budget cycle of the demo key
($1.00, reset every 5 minutes, `demo/run.config.json`). The note from `demo/editor-welcome.md` was open in the editor.
The status bar read `8% · $0.91 left · resets in 4m`, then climbed with the mock traffic: warning colour and one
notification at 78% ("Budget: 78% used, $0.21 left."), critical at 93%, `Budget used up · resets in 1m`, and
`8% · $0.91 left · resets in 4m` again after the gateway reset the budget.

## End to end (`npm run test:e2e`)

Builds and packages the extension, then starts the demo gateway, the mock upstream and code-server with the packaged
`.vsix` installed (`test/e2e/docker-compose.e2e.yml`). code-server shares the gateway's network, so the extension uses its
default URL, `http://localhost:8080`. Playwright (Chromium) drives the editor the way a user does: the command palette, the
key prompt, the theme picker and the status bar. Expected numbers are computed from the live quota response with the
extension's own code. The stack is removed afterwards (`docker compose down -v`).

- Date: 2026-11-15
- Editor: `codercom/code-server@sha256:09565f9e07f5624554e295e8bab0e2fec4a7c533eb3cff459ed6596a4d3d7c1c` (`4.145.2`)
- Gateway: the same pinned image as the contract suite
- Result: **9 passed, 0 failed**; 1.4 min for the v0.1.1 check (earlier: 1.8 min for the v0.1.0 release check, 2.8 min
  after the design review pass of ADR 0009). The extension declares
  `engines.vscode` `^1.90.0` and is compiled against the 1.90 API; this run installs it in code-server 4.145.2

| Test | Result |
|---|---|
| Asks for a key before one is set ("Set Bifrost key") | passed |
| After Set Virtual Key, the status bar shows the percent and amount left from the quota response | passed |
| Clicking the status bar opens the details panel | passed |
| After 3 mock requests and Refresh, the status bar shows the new numbers | passed |
| Dark, light and high contrast themes picked from the theme picker; screenshots saved | passed |
| A key pushed past the warning threshold turns the item to the warning colour and shows one notification | passed |
| An unknown key shows "Key rejected" (401) | passed |
| An expired key shows "Key expired" (403) | passed |
| A gateway URL where nothing answers shows "Gateway offline"; setting the URL back recovers | passed |

Screenshots from this run: `docs/images/e2e-dark.png`, `e2e-light.png`, `e2e-high-contrast.png`, `e2e-warning.png`.

## Preview sheets (`npm run preview:states`)

Renders the 14 display states with the extension's own code in approximations of the default dark, light and high contrast
themes, in English and Malay, and screenshots each panel in WebKit at 320 and 520 px. It fails when a panel scrolls
sideways.

- Date: 2026-11-14
- Result: 14 states x 4 sheets x 2 widths, **no horizontal overflow**
- Sheets: `docs/images/states-dark-en.png`, `states-light-en.png`, `states-high-contrast-en.png`, `states-dark-ms.png`
