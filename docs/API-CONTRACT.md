# Bifrost quota API contract (draft)

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
  `per_model_usage[]`.
- `rate_limit` (object or `null`): `token_max_limit`, `token_current_usage`, `token_reset_duration`, `token_last_reset`,
  `request_max_limit`, `request_current_usage`, `request_reset_duration`, `request_last_reset`. A limit that is not set is
  absent or `null`.
- `rate_limits[]`: same shape as `rate_limit`.

## Measured counter movement

Five `POST /v1/chat/completions` calls through key `demo-team-a` (model `openai/gpt-4o-mini`, mock upstream reporting
120 prompt + 80 completion tokens per call):

| Counter | Before | After |
|---|---|---|
| `budgets[0].current_usage` (USD) | 0 | 0.00033 |
| `rate_limit.token_current_usage` | 0 | 1000 |
| `rate_limit.request_current_usage` | 0 | 5 |
| `budgets[0].per_model_usage` entries | 0 | 0 |

Cost is computed by the gateway from its own pricing catalog and the token counts; no real provider is called.

## When fields are missing

Draft rule, finalised with the core schema module: a missing required top-level field is a named schema error shown to
the user ("unexpected response from gateway"), never a silent zero. Optional parts (`rate_limit: null`, empty `budgets`)
mean "no limit of that kind".
