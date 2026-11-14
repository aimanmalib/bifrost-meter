# 0005. Details panel rules

- Status: accepted
- Date: 2026-11-14

## Context

The specification asks for a details panel (webview) with a strict content security policy, theme colours, full keyboard
use and the gateway version. It does not say how the version is read, how often the page is replaced, or what the chart
shows.

## Decision

- **The HTML is built by a pure function** (`panelHtml.ts`, `chart.ts`, `panelStyle.ts`) and unit-tested: the policy, the
  escaping of names from the gateway, the key shown only as its last four characters, every display state in both languages.
  `panel.ts` is the only file that touches the webview API.
- **Policy:** `default-src 'none'`; the one style block and the one script carry a fresh nonce; no images, fonts or network
  from the page; command links are off and there are no local resources. The bars and the chart are inline SVG drawn with
  attributes, so no `style` attribute is needed.
- **The script can only ask for five commands** (Refresh, Set key, Set gateway URL, Copy summary, Show log). Any other
  message is ignored on the extension side. Clear key is not offered in the panel.
- **The page is replaced only when its content changes**, and the script puts keyboard focus back on the same button after a
  replacement, so a refresh does not throw the reader out of place.
- **Gateway version** comes from `GET /api/version` (measured as a JSON string, ADR 0002), read once per gateway URL when the
  panel is open. It sends no key and follows no redirect. When it cannot be read the panel says "version unknown".
- **The chart** shows the samples the forecast keeps for the limit closest to running out, with the limit as a dashed line.
  It is left out with fewer than two samples.

## Consequences

The panel works offline from the gateway: it shows the last known numbers with their time. Screenshots in real editor
themes come from the end-to-end run in code-server.
