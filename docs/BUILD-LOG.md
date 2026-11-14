# Build log

One line per step.

- 2026-11-14: Repository skeleton: Apache-2.0 license, README stub with AI disclosure, package manifest, toolchain decision (ADR 0001).
- 2026-11-14: G0 measured on the pinned gateway: demo stack skeleton (gateway, mock upstream, seed), quota fixtures for 200/401/403, counters moved after mock traffic (ADR 0002, API contract draft).
- 2026-11-14: Pure core (src/core): quota client, shape check, limit model, run-out forecast, formatting, language bundles; unit tests on recorded fixtures; fast gate script (ADR 0003).
