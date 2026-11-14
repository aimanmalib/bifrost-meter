# 0008. Version floor, spend per model and budget overrides

- Status: accepted
- Date: 2026-11-14
- Changes: the `engines.vscode` line of ADR 0004

## Context

A review against the pinned gateway (v2.5.1) found three places where the extension and the real system disagreed:

- `engines.vscode` was `^1.145.0`, the version inside the code-server used for end-to-end tests. Any editor older than
  that refuses to install the `.vsix`, although the extension only uses older API.
- The spend per model list read `current_usage` on each `per_model_usage` entry. The gateway sends `total_cost`, so the
  list stayed empty on a real gateway. The earlier fixture had no entries because it was recorded 1.5 s after traffic,
  before the gateway wrote them.
- After an admin override on a budget, the gateway enforces `max_limit + override_amount`, but the quota response only
  carries the parts. Reading `max_limit` alone made the meter report "used up" while requests still passed.

## Decision

- **`engines.vscode` is `^1.90.0`** and `@types/vscode` is pinned to 1.90.0, so the compiler rejects newer API. The
  end-to-end test still runs on code-server 4.145.2.
- **Spend per model reads `total_cost`**, falling back to the older names. The demo provider lists two models and the
  traffic rotates over them, so the list has more than one row. Fixtures are recorded at least 15 s after traffic.
- **The budget limit is the enforced one**: `max_limit + override_amount` when `override_mode` is `forever`, or `cycles`
  with `override_cycles_remaining` above 0; otherwise `max_limit`. A contract test sets an override through the
  management API and checks the limit the meter shows.

## Consequences

The fixtures `quota-200-after-traffic` and `quota-200-override` come from the pinned gateway. Tests derive expected
numbers from the fixtures instead of copying them, so re-recording does not break them. If a future gateway adds an
effective limit field to the quota response, the meter should read it first.
