# Test results

Latest recorded run of each suite. The fast gate (`bash scripts/gerbang-ujian.sh`: lint, type check, unit tests, build,
package) runs on every change; the suites below need Docker and run when the files they cover change.

## Contract (`npm run test:contract`)

Runs the extension's own quota client against the pinned official gateway image and the mock upstream from `demo/`, on a
free `127.0.0.1` port, then removes the stack (`docker compose down -v`). Without Docker the suite is skipped with a message.

- Date: 2026-11-14
- Gateway: `maximhq/bifrost@sha256:5ec9873acaf1687556b6e4dd854b92b539d9debf87a5a683b66338648b84d3c8` (`v2.5.1`)
- Result: **6 passed, 0 failed**; 59 s in total, of which about 41 s is starting and seeding the gateway
- Counters became visible 4.5 s after the last mock request in this run

| Test | Result |
|---|---|
| `/api/version` answers without a key | passed |
| 200 with the seeded budgets and rate limits for every demo key (expected values read from `demo/demo.config.json`) | passed |
| 401 without a key header | passed |
| 401 for an unknown key | passed |
| 403 "expired" for a key past its expiry | passed |
| Budget, token and request counters move after 3 mock requests | passed |

## End to end (`npm run test:e2e`)

Builds and packages the extension, then starts the demo gateway, the mock upstream and code-server with the packaged
`.vsix` installed (`test/e2e/docker-compose.e2e.yml`). code-server shares the gateway's network, so the extension uses its
default URL, `http://localhost:8080`. Playwright (Chromium) drives the editor the way a user does: the command palette, the
key prompt, the theme picker and the status bar. Expected numbers are computed from the live quota response with the
extension's own code. The stack is removed afterwards (`docker compose down -v`).

- Date: 2026-11-14
- Editor: `codercom/code-server@sha256:09565f9e07f5624554e295e8bab0e2fec4a7c533eb3cff459ed6596a4d3d7c1c` (`4.145.2`)
- Gateway: the same pinned image as the contract suite
- Result: **9 passed, 0 failed**; 5.4 min in total, of which 49 s is starting the stack (on a busy shared host)

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
