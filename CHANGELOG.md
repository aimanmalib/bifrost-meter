# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aimanmalib/bifrost-meter/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aimanmalib/bifrost-meter/releases/tag/v0.1.0
