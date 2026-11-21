# Moving this upstream

Bifrost Meter is built so the Bifrost maintainers could adopt it if they want to. This page lists what that would take.
If the Bifrost team wants the extension itself, the repository can move under their organisation. It is Apache-2.0, like
Bifrost. As of 15 November 2026 the offer has not been sent to them directly; one small gateway change has been proposed
(see below).

## Where it could live

Two options, both fine for the code:

1. **Its own repository under the Bifrost organisation**, for example `bifrost-vscode`. The extension has its own build,
   tests and release cycle, so a separate repository keeps the gateway's build untouched. This is the simpler option.
2. **A folder in the gateway repository**, for example `integrations/vscode/`, with a link from the integrations page of the
   Bifrost documentation. This keeps the extension next to the API it reads, so a change to the quota response and the
   matching change to the meter can land together.

Either way, the extension keeps reading only the public quota endpoint. It needs no change to the gateway.

## License

The code is Apache-2.0, the same license as Bifrost. It can be copied into either place without a license change. The
`LICENSE` file and copyright line move with it.

## Names and marks

The extension uses no Bifrost or Maxim AI logo or brand colour. The name "Bifrost" appears only to say which gateway it
works with, and the display name carries "(Unofficial)". If the maintainers adopt it, they decide on:

| What | Now | Change when adopted |
| --- | --- | --- |
| Display name | Bifrost Meter (Unofficial) | Their choice; drop "(Unofficial)" |
| Extension id and publisher | `bifrost-meter`, publisher `aimanmalib` on Open VSX | Their marketplace publisher id |
| Icon | A plain gauge drawn for this project | Their icon, if they want one |
| README notice | "Not affiliated with Maxim AI" | Remove |
| Repository links in `package.json` | This repository | The new location |
| Settings prefix | `bifrostMeter.*` | Can stay; renaming breaks existing settings |

## What else moves with it

- `src/core` has no VS Code import. The same code already serves a command-line status line and an MCP tool, and could
  serve other editors.
- Fixtures in `test/fixtures` were recorded from a pinned gateway image (`docs/API-CONTRACT.md`). The contract tests in
  `test/contract` start that image with a mock upstream, so they could run in the gateway's own CI to catch a quota
  response change before release.
- Translations are in `package.nls*.json` and `l10n/bundle.l10n*.json` (English and Malay, same keys).

## Three fields the quota response could carry

Building a client against `GET /api/governance/virtual-keys/quota` showed three places where every client has to repeat
gateway logic. The response is assembled in `getVirtualKeyQuota` (`transports/bifrost-http/handlers/governance.go`), and
the values already exist on the server.

| Field | Where the gateway already has it | Why a client needs it |
| --- | --- | --- |
| `effective_max_limit`, per budget | `TableBudget.EffectiveMaxLimit()`; the override call on the management API returns it | After an admin override the quota response keeps the base `max_limit` next to `override_amount`. A client that reads `max_limit` alone reports "used up" while requests still pass |
| `next_reset`, per budget and per rate limit window | `WindowStart(now)` plus the window length, or the next calendar boundary | The response has `reset_duration` and `last_reset` only. A client has to copy the 30-day month, the 90-day quarter and the calendar rules to show a countdown |
| `calendar_aligned`, per key | The virtual key's own flag | A client cannot see it. Bifrost Meter infers it from `last_reset`, which is right in practice but still a guess |

The response sketched in issue 6482 already carries `remaining` and `next_reset` per budget, so the first two are in
line with what operators ask for. All three are additive and read-only, so existing clients keep working. The contract tests in `test/contract` pin
today's behaviour for each one (an override, calendar boundaries, the 30-day rolling month) against the pinned gateway,
so they would show such a change. The details and the measurements are in `docs/API-CONTRACT.md`.

The first field is ready as a patch against the gateway's `dev` branch (commit `a3cd2b5`):
[`docs/upstream/0001-quota-effective-max-limit.patch`](upstream/0001-quota-effective-max-limit.patch). It adds the field in
`buildBudgetsWithUsage`, a unit test for four override cases, the schema entry and a changelog line, 66 lines in all. With
it, the 86 handler tests matching `TestGetVirtualKeyQuota|Override|Budget` pass in the `golang:1.27.3` image; without the
handler change the new test fails. The full suite and the generated `openapi.json` were not run or rebuilt.
The patch file now carries the whole pull request: a follow-up commit corrected a code comment and moved the new test so it no
longer splits the doc comment of the test after it. The test run above was made before that commit.

On 15 November 2026 this first field was proposed upstream as
[issue 10043](https://github.com/maximhq/bifrost/issues/10043) and
[pull request 10044](https://github.com/maximhq/bifrost/pull/10044). The other two fields, `next_reset` and `calendar_aligned`, were proposed later the same day as
[pull request 10050](https://github.com/maximhq/bifrost/pull/10050) ([issue 10049](https://github.com/maximhq/bifrost/issues/10049)), with unit tests
for the reset arithmetic.

Status on 21 November 2026: a Bifrost maintainer reviewed pull request 10050 and approved it on 17 November 2026 ("LG").
Merging `dev` to clear a changelog conflict dismissed that approval, as the repository does on every push; a re-review is
requested. On 20 November an automated review bot asked for a provider test case, so the pull request shows "Changes
requested" until that is resolved; the author answered on 21 November. It is open and not merged. Pull request 10044 is open and waiting for a maintainer review; an automated review
bot asked for an extra Postman test case.

## Contributor agreement

Pull requests to the Bifrost repositories fall under their contributor license agreement, and pull request 10044 is
subject to it. Moving the extension itself there is a separate step, offered at the top of this page. Until it happens,
this repository stays the home of the extension, and anyone may fork it under Apache-2.0.
