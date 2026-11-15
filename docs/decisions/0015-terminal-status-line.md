# 0015: A one-line status for terminals

Status: accepted (2026-11-15)

## Context

Coding agents often run in a terminal, outside VS Code. There the status bar is not visible, and the MCP tool only answers
when the agent decides to call it. The person watching the agent has no standing view of the budget.

## Decision

`dist/cli.js status` prints one line with the limit closest to running out, built from the shared core and the same
strings as the status bar. It reads the environment variables the MCP server already uses and ships in the `.vsix` next
to `dist/mcp.js`. `--format json` returns the structured result of `get_budget_status`. No new dependency.

## Consequences

The line can feed an agent's status line, tmux or a shell prompt. Each call is one quota read, so the caller's refresh
interval sets the cost to the gateway. The command keeps no history, so it carries no run-out forecast.
