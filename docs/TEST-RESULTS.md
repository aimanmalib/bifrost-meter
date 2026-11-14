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

Not recorded yet.
