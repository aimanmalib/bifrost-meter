# 0014: Reset windows follow the gateway's rules; the demo picks free ports and shows a full cycle

Status: accepted (2026-11-15)

## Context

A review of the v0.1.0 release from a clean copy, done the way a Bifrost maintainer would try it, found three gaps.

- `demo/run.sh` failed with a raw Docker error when port 8080 was taken. 8080 is Bifrost's default port, so a machine
  that already runs Bifrost is exactly where the demo failed. A failed start also left containers behind.
- The meter counted "1M" as a calendar month and did not know "1Q". The gateway counts a rolling month as 30 days, a
  quarter as 90 and a year as 365 (`ParseDuration`), and resets calendar-aligned keys at 00:00 UTC on calendar boundaries
  (`GetCalendarPeriodStart`). The countdown could be a day or two off on a rolling monthly budget, and a quarterly budget
  showed no countdown.

- The one-command demo opened an empty editor, and its traffic key had a budget of $5.00 a day. The status bar showed
  the request limit creeping up by a percent at a time, so a reviewer saw neither the budget nor a warning without waiting
  for a long time.

## Decision

- `demo/run.sh` checks both ports after it has removed its own old stack and uses the next free port when one is taken.
  It says which port it chose, says once that the first run downloads about 550 MB, and removes its containers when
  the start fails.
- `demo/run.sh` seeds from its own `demo/run.config.json`: the traffic key has a budget of $1.00 that resets every
  5 minutes, and the mock upstream reports larger token counts, so one cycle shows OK, the warning, critical, "Budget
  used up" and the reset. The editor opens a folder with a short note on what to look at (`demo/editor-welcome.md`). The
  step-by-step demo, the tests and the recording keep their own configs.
- `src/core/duration.ts` uses the gateway's window lengths and knows "Q". For "1d", "1w", "1M", "1Q" and "1Y" it treats
  the window as calendar aligned when `last_reset` sits exactly on its own UTC boundary, because the quota response
  does not carry the key's `calendar_aligned` flag. A quarterly budget's `reset_config.quarter_start_month` is read.
- The rules were measured on the pinned gateway before the change (`docs/API-CONTRACT.md`), and the contract suite now
  creates calendar-aligned and rolling keys and checks the meter's next reset against them.
- The three things the client has to recompute (enforced limit, next reset, calendar alignment) are written up as
  additive fields the quota response could carry (`docs/UPSTREAMING.md`).

## Consequences

Version 0.1.1 replaces 0.1.0 as the release to install. Calendar alignment stays an inference until the gateway reports
it: a rolling window whose `last_reset` falls exactly on midnight UTC of a boundary day is read as calendar aligned. That
gives the same reset time for "1d" and "1w", and is unlikely for the longer units because the gateway stamps times to the
nanosecond.
