# Design brief

## Who uses it

A developer who sends model calls through a Bifrost gateway with a virtual key. They spend the day in the editor. They want to
know, without leaving it, how much of the key's budget and rate limits is left and when it resets. They do not hold admin
credentials and cannot change the limits.

## What must read at a glance

One status bar item on the right answers "how close am I to the limit that runs out first?":

```
$(dashboard) 62% · $3.80 left · 4h
```

- The percent comes first because it is the comparison number. The remaining amount follows in its own unit (USD, tokens or
  requests). The reset countdown is last and is dropped when the reset time cannot be read.
- The item follows the editor theme. It changes background only at the thresholds: the theme's warning background at `warn`
  (75 % by default), the error background at `critical` (90 %) and when a limit is used up. Colour is never the only signal:
  the icon and the words change too, and the accessibility label spells the whole state out.
- `statusBar.format` trims the text for narrow windows: `full`, `compact` (percent and remaining) or `percent`.

Hovering opens the tooltip: a small table of every limit (scope, used of limit, percent, reset), the run-out forecast when one
exists, the time of the last update, and two links (Refresh, Open details). Clicking the item opens the details panel.

## States

Each state has an icon, a short text and a full accessibility label. Icons are the editor's own codicons.

| State | Icon | Text (English) | Background |
| --- | --- | --- | --- |
| Not configured | key | Set Bifrost key | none |
| Loading | loading (spins) | Bifrost… | none |
| OK | dashboard | 62% · $3.80 left · 4h | none |
| Warning | warning | 81% · $1.90 left · 4h | warning |
| Critical | error | 94% · $0.30 left · 4h | error |
| Used up | circle-slash | Budget used up · 4h | error |
| Key inactive | circle-slash | Key inactive | warning |
| 401 key rejected | lock | Key rejected | error |
| 403 key expired | lock | Key expired | error |
| Offline or timeout | debug-disconnect | Gateway offline | none, last known numbers kept in the tooltip |
| 404 gateway too old | question | Gateway too old | warning |
| Unexpected response | question | Unexpected response | warning |
| No limits | dashboard | No limit | none |

Settings errors (a plain `http://` URL to a public host, an invalid URL, a redirect to another host) use the lock or question
icon with a text that names the setting to fix.

## Direction

Calm and dense. The meter is a passenger in the editor, so it borrows everything from the theme: font, colours, focus rings.
The one accent is the threshold colour, and it appears only when there is something to act on. Numbers use tabular figures in
the panel so columns line up as they change. Progress bars always carry their number as text.

## Left out on purpose

- No brand colours or logos of the gateway or its maker. The extension icon is a plain gauge drawn for this project.
- No animation besides the editor's own loading spinner, no blur, no gradients.
- No notification for routine refreshes. Notifications fire once per threshold per reset cycle, and once when the forecast
  says the budget runs out before the reset. They can be switched off.
- No key, not even part of it, in the status bar text. The tooltip and panel show only the last four characters.
