# Bifrost Meter demo

You are looking at an editor in your browser with **Bifrost Meter (Unofficial)** installed and already connected to a
real Bifrost gateway that runs next to it. Model replies come from a mock upstream, so nothing here costs anything.

## Where to look

1. **Bottom right, in the status bar.** The item with the gauge icon shows the limit closest to running out: percent
   used, amount left and the time to the next reset.
2. **Hover over it** for every limit on the key.
3. **Click it** for the details panel: budget, tokens, requests, a usage chart and spend per model.

## What happens over the next 5 minutes

The demo key `demo-team-a` has a budget of $1.00 that resets every 5 minutes, and mock traffic spends it steadily
(both are set in `demo/run.config.json`).

| About | The meter shows |
| --- | --- |
| 0:00 to 2:30 | OK. After two minutes of readings it estimates when the budget runs out |
| 2:35 | Warning colour at 75%, with one notification |
| 3:05 | Critical colour at 90%, with one notification |
| 3:30 | "Budget used up". The gateway now refuses requests for this key |
| 5:00 | The gateway resets the budget and the meter starts again |

Times are approximate. The meter reads the gateway every 15 seconds in this demo; run **Bifrost Meter: Refresh** from
the Command Palette to read it now.

## Try another key

`demo/run.sh` printed a second key, `demo-team-b`, with a limit of 30 requests per minute. Run
**Bifrost Meter: Set Virtual Key** and paste it to see a different limit take the status bar.

## For agents

The same numbers are available to coding agents through the MCP tool `get_budget_status`. See `docs/MCP.md` in the
repository.
