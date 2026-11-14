# Moving this upstream

Bifrost Meter is built so the Bifrost maintainers could adopt it if they want to. This page lists what that would take.
Nothing here has been proposed to them yet.

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
| Extension id and publisher | `bifrost-meter`, publisher used for file names only | Their marketplace publisher id |
| Icon | A plain gauge drawn for this project | Their icon, if they want one |
| README notice | "Not affiliated with Maxim AI" | Remove |
| Repository links in `package.json` | This repository | The new location |
| Settings prefix | `bifrostMeter.*` | Can stay; renaming breaks existing settings |

## What else moves with it

- `src/core` has no VS Code import. The same code could serve other editors, a command-line status line or an MCP tool.
- Fixtures in `test/fixtures` were recorded from a pinned gateway image (`docs/API-CONTRACT.md`). The contract tests in
  `test/contract` start that image with a mock upstream, so they could run in the gateway's own CI to catch a quota
  response change before release.
- Translations are in `package.nls*.json` and `l10n/bundle.l10n*.json` (English and Malay, same keys).

## Contributor agreement

Opening a pull request to the Bifrost repositories may require signing their contributor license agreement. Whether to
sign it is the copyright holder's decision and has not been made. Until then, this repository stays the only home of the
code, and anyone may fork it under Apache-2.0.
