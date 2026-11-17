# 0018: Read the quota fields from pending upstream changes

Status: accepted (2026-11-17)

## Context

Pull requests 10050 and 10044 to Bifrost add `calendar_aligned`, `next_reset`, `token_next_reset`,
`request_next_reset` and `effective_max_limit` to the quota response. Neither is merged, and v2.5.1 sends none of
them. Until now the meter derived the same facts itself (ADR 0003, ADR 0008). When a gateway does send them, its own
values are the better source: it knows the anchor of a rolling window and the state of an override.

## Decision

- **Gateway value first, own rules as fallback.** A `next_reset` time is used when it parses and is still ahead of the
  reading; otherwise the meter computes the reset as before. `effective_max_limit` is used as the budget limit when it is a
  number of 0 or more; otherwise the meter adds an active override to `max_limit` as before.
- **New fields are optional extras.** A missing or mistyped one is dropped in the schema check, never reported as
  "Unexpected response". Required fields keep their named errors.
- **`calendar_aligned` is passed through, not used in the calculation.** The `next_reset` fields already carry the
  alignment of whatever governs each window, and a key-level flag would be wrong for windows set elsewhere. The MCP tool
  reports it as `calendar_aligned`, `null` when the gateway does not send it.
- **Fixture from the schema, labelled.** `test/fixtures/quota-200-upstream-next-reset.json` follows the OpenAPI schema in
  both pull requests and says in its `recorded` block that it was not recorded from a released gateway. The contract
  tests keep running against the pinned v2.5.1 image.

## Consequences

Recorded v2.5.1 responses read exactly as before. If the upstream field names change before merging, the meter ignores
the old names and keeps working on its own rules; the fixture and this reader then need an update.
