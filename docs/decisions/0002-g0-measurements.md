# 0002. What the pinned gateway actually does (G0 measurements)

- Status: accepted
- Date: 2026-11-14

## Context

Before writing the extension we ran the pinned official image (ADR 0001) with a mock upstream and recorded what the quota
endpoint returns. Three behaviours differ from what the upstream docs or our first plan suggested. The measured behaviour wins.

## Decision

1. **Provider keys are created separately.** `POST /api/providers` accepts `network_config` but ignores a `keys` array.
   The seed creates the provider, then calls `POST /api/providers/{provider}/keys`.
2. **Virtual keys list their models explicitly.** With `provider_configs[].allowed_models: ["*"]` every inference call was
   refused with 403 `model_blocked`. An explicit list (from `demo/demo.config.json`) works. The seed always sends the list.
3. **Setup token is enough for a private base URL on v2.5.1.** Creating a provider with `network_config.base_url` pointing
   at the mock upstream and `allow_private_network: true` worked with only the `X-Bifrost-Setup-Token` header. Newer
   upstream docs say this needs a real admin session, so a gateway upgrade may need the seed to use a config file instead.
4. **Compose service names carry the project prefix** (`bifrost-meter-gateway`, `bifrost-meter-mock-upstream`,
   `bifrost-meter-seed`) so they cannot clash with other stacks on a shared Docker network.
5. **Setup token comes from the environment.** Compose refuses to start without `BIFROST_SETUP_TOKEN`; `demo/.env.example`
   shows how to set it. No default value is committed.

Also measured: USD usage does move without a real provider (0 → 0.00033 after five mock calls), so the demo can show the
budget meter itself, not only tokens and requests. `per_model_usage` stayed empty; the panel must not depend on it.

## Consequences

- Upgrading the gateway digest means re-running `scripts/record-fixtures.mjs` and checking points 1 to 3 again.
- Details and fixtures: `docs/API-CONTRACT.md`, `test/fixtures/`.
