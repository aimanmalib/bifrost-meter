# 0006. Demo traffic and contract tests

- Status: accepted
- Date: 2026-11-14

## Context

The specification asks for an optional `traffic` profile that keeps the meter moving, and for contract tests against the
pinned gateway that skip cleanly without Docker. It does not say how the traffic service gets a virtual key, how the tests
start the gateway, or how long to wait for counters.

## Decision

- **The traffic service finds its key by name.** It lists virtual keys with the same setup token the seed uses and picks
  the one named in `demo.config.json` (`traffic.keyName`). No key is passed between containers or written to disk.
- **The seed reuses keys with the same name**, so `docker compose up` a second time does not create duplicates.
- **Contract tests start their own stack** from `demo/docker-compose.yml` (gateway and mock upstream only) on a free
  `127.0.0.1` port with a fresh setup token, run the demo seed, and always run `docker compose down -v` afterwards. They
  read the extension's own client (`src/core`), so a change in the gateway's answer fails here before it fails in the editor.
- **Expected limits come from `demo/demo.config.json`**, not from numbers in the test, so editing the demo stays safe.
- **Counters are polled for up to 30 seconds** after traffic, because the gateway writes usage asynchronously (2 to 6
  seconds measured).

## Consequences

A gateway upgrade that drops key listing for the setup token would need the traffic service to read keys from the seed's
output instead. The contract run takes about a minute, most of it gateway start-up, so it is not part of the fast gate.
