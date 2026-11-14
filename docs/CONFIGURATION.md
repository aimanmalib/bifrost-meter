# Configuration

All settings live under `bifrostMeter.*` in the editor settings. The key is not a setting: it is kept in the editor's
secret storage (see [SECURITY.md](SECURITY.md)).

| Setting | Default | What it does |
| --- | --- | --- |
| `bifrostMeter.baseUrl` | `http://localhost:8080` | Address of the Bifrost gateway. When not set, `BIFROST_BASE_URL` is used. |
| `bifrostMeter.pollIntervalSeconds` | `60` (at least 15) | Seconds between refreshes. Slower after errors (doubling, at most 5 minutes) and while the window is not focused. |
| `bifrostMeter.thresholds.warn` | `75` | Percent used at which the status bar turns to the warning colour and a notification is shown. |
| `bifrostMeter.thresholds.critical` | `90` | Percent used at which the status bar turns to the error colour and a notification is shown. |
| `bifrostMeter.statusBar.metric` | `auto` | Which limit the status bar shows: `auto` (the one closest to running out), `budget`, `tokens` or `requests`. |
| `bifrostMeter.statusBar.format` | `full` | `full` (percent, remaining, reset), `compact` (percent and remaining) or `percent`. |
| `bifrostMeter.notifications.enabled` | `true` | One notification per threshold per reset cycle, and one when the forecast says a limit runs out before it resets. |
| `bifrostMeter.forecast.windowMinutes` | `30` (5 to 1440) | Minutes of recent usage the run-out forecast is based on. |
| `bifrostMeter.language` | `auto` | `auto` follows the editor language; `en` or `ms` force English or Malay. |
| `bifrostMeter.allowInsecureHttp` | `false` | Allow plain `http://` to hosts outside loopback and private networks. The key is then sent unencrypted. |

## Commands

All commands are in the Command Palette under **Bifrost Meter**.

| Command | What it does |
| --- | --- |
| Set Virtual Key | Saves the key in secret storage and refreshes. |
| Clear Virtual Key | Removes the saved key. |
| Set Gateway URL | Sets `bifrostMeter.baseUrl`. |
| Refresh | Reads the quota now. |
| Open Details | Opens the details panel (same as clicking the status bar item). |
| Copy Summary | Copies one line per limit to the clipboard, without the key. |
| Show Log | Opens the output channel. The log never contains the key. |

## Examples

A team gateway on the internal network, a quieter status bar and earlier warnings:

```json
{
  "bifrostMeter.baseUrl": "http://bifrost.internal:8080",
  "bifrostMeter.statusBar.format": "compact",
  "bifrostMeter.thresholds.warn": 60,
  "bifrostMeter.thresholds.critical": 85
}
```

Always show the USD budget, even when a rate limit is closer:

```json
{ "bifrostMeter.statusBar.metric": "budget" }
```

## Which address counts as private

Plain `http://` is allowed without `allowInsecureHttp` for loopback (`localhost`, `127.0.0.0/8`, `::1`), RFC 1918 ranges,
link-local, shared address space `100.64.0.0/10` (used by mesh VPNs), IPv6 unique-local and link-local, single-label names
such as Docker service names, and names ending in `.localhost`, `.local`, `.internal`, `.lan` or `.home.arpa`. Anything
else needs `https://`.
