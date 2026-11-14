# Example `AGENTS.md` lines for Bifrost Meter

Paste into a project's `AGENTS.md` (or the agent instructions file your tool reads) when the `bifrost-meter` MCP server is
available. See [MCP.md](MCP.md) for setup.

```markdown
## Model budget

This project's model calls go through a Bifrost gateway with a budget and rate limits on our virtual key.

- Before a long task (many files, long test loops, large refactors), call the `get_budget_status` tool.
- If any limit has `is_exhausted: true`, or `will_exhaust_before_reset: true`, or less than 10% `remaining`, tell the user
  what is left and when it resets (`resets_at`) before you start, and ask whether to go ahead.
- Do not try to work around a limit (other keys, other gateways). If the tool returns an error, report it to the user.
```
