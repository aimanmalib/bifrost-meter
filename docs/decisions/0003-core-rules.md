# 0003. Core rules the PRD left open

- Status: accepted
- Date: 2026-11-14

## Context

`src/core` is the pure part of Bifrost Meter (no VS Code import). It checks the quota response, turns it into limits, picks
the one to show, forecasts the run-out and formats numbers. A few behaviours were not fixed by the specification.

## Decision

- **Plain http to "private" hosts is allowed** without `allowInsecureHttp`: loopback, RFC 1918, link-local, 100.64.0.0/10
  (mesh VPNs), IPv6 unique-local and link-local, single-label names (Docker service names such as the demo gateway) and the
  `.localhost`, `.local`, `.internal`, `.lan`, `.home.arpa` suffixes. Anything else over http is refused until the setting is on.
- **Redirects** are followed only inside the same origin, at most 3 hops. A redirect to another origin is reported and not
  followed, so the key never reaches a second host. URLs with a user name or password are refused.
- **`statusBar.metric`** set to a kind the key does not have (for example `tokens` on a budget-only key) falls back to `auto`
  instead of showing "no limit".
- **Rate limits**: `rate_limits` is read when present and `rate_limit` otherwise, de-duplicated by `id`. A token or request
  limit that is `null` or `0` is treated as not set.
- **Reset periods** are parsed as Go-style durations (`30s`, `1h30m`, `1d`, `1w`) plus calendar `M` and `Y`. Month steps
  follow Go's `AddDate` (Jan 31 + 1 month = Mar 3). When the last reset plus the period is already past, the period is
  stepped forward, because the gateway resets lazily.
- **Messages** are looked up by key in `l10n/bundle.l10n.json` and `l10n/bundle.l10n.ms.json` through our own small
  translator, not `vscode.l10n`, because the `bifrostMeter.language` setting must be able to override the editor language,
  and the MCP server and CLI need the same text outside VS Code. Malay duration units are `h` (hari, day) and `j` (jam, hour).
- **Rounding never flatters**: percent used and money left round down, money spent rounds up; 99.6% shows as "99.6%".
- **Dev dependency audit**: the remaining `npm audit` findings are moderate ones in lint tooling (`minimatch` under
  `typescript-eslint`), which never ships in the `.vsix` and never sees untrusted input.

## Consequences

- A gateway reached over plain http on a public address needs one explicit setting; a home-lab or Docker setup does not.
- Adding a language means adding one `bundle.l10n.<lang>.json` file and one line in `src/core/i18n.ts`.
