# 0007. End-to-end tests in code-server

- Status: accepted
- Date: 2026-11-14

## Context

The specification asks for an end-to-end run of the packaged extension in code-server against the pinned gateway: set a
key, check the status bar against the quota response, open the panel, send traffic, see the numbers move and a threshold
warning, and see the 401, 403 and offline states. It does not say how the editor reaches the gateway or how the test drives
the editor.

## Decision

- **code-server shares the gateway's network namespace** (`network_mode: service:...`). The extension then reaches the
  gateway at its default URL, `http://localhost:8080`, as it would on a developer machine, and no test-only setting such
  as `allowInsecureHttp` is needed. Only the editor port is published, on `127.0.0.1`.
- **The `.vsix` is installed from the packaged file** with `code-server --install-extension` when the container starts,
  so the test covers what users install, not the source tree.
- **The test drives the editor through the user interface only**: the command palette, the key prompt, the theme picker
  and the status bar. Writing the user settings file while the editor is open did not reach the open window in this
  code-server version, so settings changes go through the extension's own commands instead.
- **Expected numbers come from the live quota response**, computed with the extension's own pure code (strictest limit,
  percent, amount left), so changes to the demo config do not break the test.
- **The offline case points the gateway URL at a closed local port** rather than stopping the gateway, which would also
  take down the editor's network.
- **Chromium only.** The extension runs inside the editor, so the browser engine does not change what is tested.

## Consequences

The run takes several minutes, so it stays outside the fast gate and runs when the extension or the demo changes. The
theme picker's list loads after it opens; the test waits for it before filtering. A newer code-server may rename themes
(this version calls the defaults "Dark 2026" and "Light 2026"); the picker labels live in the test.
