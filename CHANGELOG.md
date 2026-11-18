# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.5] - 2026-11-18

### Added

- `node dist/cli.js guard --min-remaining <percent>`: a pre-flight check for CI steps and agent scripts. It exits 0 to go,
  2 to stop with one sentence (what is left on the closest limit and when it resets), and 1 when the quota cannot be read.
  Thirteen unit tests and a contract test on the pinned gateway; usage in `docs/MCP.md`.
- The meter reads `next_reset`, `token_next_reset`, `request_next_reset` and `effective_max_limit` when the gateway
  sends them (pull requests 10050 and 10044, not in a released gateway yet), and keeps its own rules when it does not.
  `calendar_aligned` is passed through to the MCP result.

### Changed

- Test counts in the README, the deck and `docs/TEST-RESULTS.md` come from the 18 November runs: 427 unit tests,
  13 contract tests, 9 end-to-end tests. The demo video is unchanged; it was recorded on 0.1.4.

## [0.1.4] - 2026-11-15

### Changed

- When the limit closest to running out belongs to a provider or a model under the key, the status bar text and
  `node dist/cli.js status` now end with that provider or model name, for example `Budget used up · resets in 23h ·
  openai`. Limits set on the key itself look the same as before. Eight new unit tests cover it.
- The README links the re-uploaded demo video (the same 79-second film), and the deck shows the new link and the
  current unit test count.

## [0.1.3] - 2026-11-15

### Changed

- Documentation only; the extension code is the same as in 0.1.2. The README lists the desktop monitors that read the
  same quota endpoint, adds limits, the judging criteria table, the three-state strip and a still of the agent session,
  and links the 79-second version of the narrated video.
- The package now includes this changelog.

## [0.1.2] - 2026-11-15

### Added

- A one-line status for terminals: `node dist/cli.js status` prints the limit closest to running out, for an agent's
  status line or tmux. See [`docs/MCP.md`](docs/MCP.md).
- Listed on [Open VSX](https://open-vsx.org/extension/aimanmalib/bifrost-meter), so VSCodium, Cursor and code-server can
  install it from their extension view.

## [0.1.1] - 2026-11-15

### Changed

- Reset times follow the gateway's own window rules. A rolling month is 30 days and a quarter 90, and keys that are
  calendar aligned reset at 00:00 UTC on the calendar boundary.
- The one-command demo uses the next free port when 8080 or 8443 is taken, shows a full budget cycle in about 5 minutes
  and opens a short note in the editor.

## [0.1.0] - 2026-11-14

### Added

- First release: the status bar meter, tooltip and details panel, threshold warnings, the run-out estimate, the MCP
  server with `get_budget_status`, English and Malay text, and the one-command demo.

[Unreleased]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aimanmalib/bifrost-meter/releases/tag/v0.1.0
