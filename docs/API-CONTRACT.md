# Bifrost quota API contract

Bifrost Meter reads exactly one endpoint. This page records what it sends, what it reads, and what was measured on the
pinned gateway. Fixtures in `test/fixtures/` were recorded from that gateway with `scripts/record-fixtures.mjs`;
key values in them are cut down to their last 4 characters.

- Tested with: `maximhq/bifrost@sha256:5ec9873acaf1687556b6e4dd854b92b539d9debf87a5a683b66338648b84d3c8`
  (`GET /api/version` → `"v2.5.1"`).
- Measured: 2026-11-14, local demo stack (`demo/`), mock upstream, no real provider.

## Request

```
GET {baseUrl}/api/governance/virtual-keys/quota
x-bf-vk: <virtual key>
```

- No admin credential. The virtual key in the header is the credential.
- `Authorization: Bearer sk-bf-…` also returns 200 (fixture `quota-200-bearer-header.json`). The extension always sends
  `x-bf-vk`, because that header accepts any key value, not only `sk-bf-` ones.

## Responses

| Case | Status | Body | Fixture |
|---|---|---|---|
| Valid key | 200 | quota object (below) | `quota-200-fresh.json` |
| Valid key after 5 mock requests | 200 | counters moved | `quota-200-after-traffic.json` |
| Key with no budget and no rate limit | 200 | `budgets: []`, `rate_limit: null`, `rate_limits: []` | `quota-200-no-limits.json` |
| Inactive key | 200 | `is_active: false` | `quota-200-inactive.json` |
| No key header | 401 | `error.message` starts "Missing virtual key" | `quota-401-missing-key.json` |
| Unknown key | 401 | `error.message` = "Virtual key not found" | `quota-401-unknown-key.json` |
| Expired key | 403 | `error.message` = "Virtual key has expired" | `quota-403-expired.json` |
| Gateway older than v1.5.0 | 404 | route missing (from upstream docs, not measured) | — |

Error bodies share one shape: `{ "status_code": n, "error": { "message": "…" }, … }`.

## Fields the extension reads (200)

Top level, exactly as returned: `virtual_key_name`, `is_active`, `budgets`, `rate_limit`, `rate_limits`, `provider_configs`,
`model_configs`.

- `budgets[]`: `max_limit` (USD), `current_usage` (USD), `reset_duration` (for example `1d`, `1h`), `last_reset` (ISO time),
  `override_amount`, `override_mode`, `override_cycles_remaining` (only after an admin override),
  `reset_config.quarter_start_month` (only on a quarterly budget with a fiscal calendar), `per_model_usage[]`.
- `budgets[].per_model_usage[]`: `model`, `provider`, `total_cost` (USD since the last reset), `total_requests`,
  `total_tokens`. The meter shows `total_cost` per model, highest first.
- **Enforced budget limit.** After an admin override the gateway enforces `max_limit + override_amount` when
  `override_mode` is `forever`, or `cycles` with `override_cycles_remaining` above 0. The quota response has no field
  for that sum, so the meter computes it. Measured: an override of 5 on a budget of 5 answered `effective_max_limit: 10`
  on the management call, while the quota response kept `max_limit: 5` with `override_amount: 5`.
- `rate_limit` (object or `null`): `token_max_limit`, `token_current_usage`, `token_reset_duration`, `token_last_reset`,
  `request_max_limit`, `request_current_usage`, `request_reset_duration`, `request_last_reset`. A limit that is not set is
  absent or `null`.
- `rate_limits[]`: same shape as `rate_limit`.

## Reset windows

The quota response gives `reset_duration` and `last_reset`, not the time of the next reset. The meter derives it with the
gateway's own window rules (`framework/configstore/tables/utils.go` and `budget.go` in v2.5.1). Measured on the pinned
gateway on 2026-11-15:

- **Rolling windows.** `d` is 24 hours, `w` 7 days, `M` 30 days, `Q` 90 days and `Y` 365 days; other values are Go
  durations such as `30s`, `5m` or `1h30m`. `last_reset` stays on a lattice of that length. A `1m` budget created at
  `04:06:27.847221039Z` reported `last_reset: 04:07:27.847221039Z` one minute later. The next reset is `last_reset` plus
  a whole number of lengths.
- **Calendar-aligned windows.** A key created with `calendar_aligned` resets its `1d`, `1w`, `1M`, `1Q` and `1Y` windows
  at 00:00 UTC on the calendar boundary. On Sunday 2026-11-15 such keys reported `last_reset` `2026-11-15T00:00:00Z` for
  `1d`, `2026-11-09T00:00:00Z` (the Monday) for `1w`, `2026-11-01T00:00:00Z` for `1M` and `2026-10-01T00:00:00Z` for `1Q`.
- **Which kind a window is.** The quota response does not carry `calendar_aligned`. The meter treats a `1d`, `1w`, `1M`,
  `1Q` or `1Y` window as calendar aligned when its `last_reset` sits exactly on its own UTC boundary, and as rolling
  otherwise. For `1d` and `1w` both readings give the same reset time.

The contract suite creates a calendar-aligned monthly key, a calendar-aligned quarterly key and a rolling monthly key on
the pinned gateway and checks that the meter's next reset is the next boundary for the first two and `last_reset` plus
30 days for the third.

## Measured counter movement

Five `POST /v1/chat/completions` calls through key `demo-team-a` (model `openai/gpt-4o-mini`, mock upstream reporting
120 prompt + 80 completion tokens per call):

| Counter | Before | After |
|---|---|---|
| `budgets[0].current_usage` (USD) | 0 | 0.00033 |
| `rate_limit.token_current_usage` | 0 | 1000 |
| `rate_limit.request_current_usage` | 0 | 5 |
| `budgets[0].per_model_usage` entries | 0 | 0 (read too early; see below) |

Cost is computed by the gateway from its own pricing catalog and the token counts; no real provider is called.

Counters are written asynchronously. In the contract runs they became visible 2 to 9 seconds after the last request, so a
reading taken right after a request can still show the old value. The extension polls on an interval, which hides this
lag; the contract test waits up to 30 seconds for the counters to move.

`per_model_usage` is filled later than the counters. Re-recorded 15 seconds after six calls rotating over
`openai/gpt-4o-mini` and `openai/gpt-4o`: two entries, three requests and 600 tokens each, with `total_cost` 0.0033 USD
for `gpt-4o` and 0.000198 USD for `gpt-4o-mini` (`test/fixtures/quota-200-after-traffic.json`).

## When fields are missing

- Required: `virtual_key_name` (string), `is_active` (boolean) and `budgets` (array). Inside each budget, `max_limit` and
  `current_usage` must be numbers. When one is missing or has the wrong type, the meter shows "Unexpected response" and
  names the field in the tooltip, the panel and the log. It never shows a silent zero.
- Optional: `rate_limit` may be `null` or absent, `rate_limits`, `provider_configs` and `model_configs` may be absent, and a
  rate limit field that is `null` means "no limit of that kind". A key with no limit at all shows "No limit".
- Unknown fields are ignored, so newer gateways that add fields keep working.

## What the response does not say

Three things a client has to work out for itself today. Each could be one more field in the quota response;
`docs/UPSTREAMING.md` lists them as a proposal.

| Not in the response | What the meter does instead |
|---|---|
| The enforced limit after an admin override | Adds `override_amount` to `max_limit` when the override mode and remaining cycles say it is active |
| The time of the next reset, and whether the window is calendar aligned | Derives both from `reset_duration` and `last_reset` with the rules under "Reset windows" |
| Budgets on a team or customer above the key | Nothing: a virtual key cannot read them. The README lists this as a limit |
