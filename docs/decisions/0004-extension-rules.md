# 0004. Extension rules the PRD left open

- Status: accepted
- Date: 2026-11-14

## Context

The VS Code side of Bifrost Meter (`src/extension`) shows the core's numbers in the status bar, the tooltip and
notifications. Some behaviours were not fixed by the specification.

## Decision

- **`engines.vscode` was `^1.145.0`** (changed to `^1.90.0` in ADR 0008), the VS Code version inside code-server 4.145.2, the editor the end-to-end test runs in.
  The extension uses no API newer than that. If the end-to-end test pins a different code-server, the floor follows it.
- **`bifrostMeter.baseUrl` and `bifrostMeter.allowInsecureHttp` are application-scoped** (user settings only). A workspace
  `.vscode/settings.json` from a cloned repository could otherwise point the stored key at another host, or allow it to
  travel over plain http. The `BIFROST_BASE_URL` environment variable applies only when the user has not set the URL.
- **The logic has no VS Code import.** The refresh cycle (`controller.ts`), the poller, the status text, the tooltip, the
  notification rules and the settings reader are plain TypeScript, unit-tested with a fake clock and recorded gateway
  answers. Only `extension.ts`, `statusBar.ts` and `commands.ts` touch the editor API; a stand-in API test checks the wiring.
- **`statusBar.format`** is a choice of `full`, `compact` and `percent` rather than a free template, so every text stays
  translated in both languages.
- **Notifications** announce only the highest new level, so a jump from 10 % to used up shows one message, not three.
  The per-limit state still advances while notifications are off, so turning them on does not replay old thresholds.
  An inactive key gets no notifications; the status bar already says it is inactive.
- **Back-off**: after an error the interval doubles each time, up to 5 minutes (or the interval itself when it is longer).
  While the window is not focused the delay is four times longer, under the same ceiling; focusing the window refreshes at
  once.
- **Open Details** shows a read-only list of every limit until the details panel lands. When there is no data it opens the
  key prompt (not configured) or the log (errors).
- **Dev dependency audit**: `@vscode/vsce` adds one more moderate `minimatch` finding. It runs only at packaging time on
  our own files and never ships in the `.vsix`.
