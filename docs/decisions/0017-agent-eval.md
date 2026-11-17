# 0017: Measure the budget tool with real agent runs

Status: accepted (2026-11-17)

## Context

The README said a coding agent can check its budget with `get_budget_status` before a long task. Only one recorded
session backed that claim. We want a repeatable count of how often a real agent calls the tool and follows the budget
rule in `AGENTS.md`, and a baseline without the tool.

## Decision

`scripts/agent-eval.mjs` runs the evaluation; `demo/eval/eval.config.json` holds the models, states, prompt, rule
threshold and repeat counts.

- **Gateway states come from real traffic.** The script starts the pinned demo stack (official Bifrost image and the
  labelled mock upstream), creates one virtual key per state with the demo seed, and sends mock requests through the
  gateway until the key reaches its state. A probe key first measures the cost of one request, so a budget of 100
  requests can be set. The rejected-key state uses a key the gateway does not know. No quota response is faked.
- **Request limit at 92%, not 90%.** With the rule "ask when less than 10% is left", 90% used sits exactly on the
  line. 46 of 50 requests keeps the state on one side of it.
- **The agent is Claude Code in print mode** (`claude -p --output-format stream-json`) on the signed-in account; the
  script removes `ANTHROPIC_API_KEY` from its environment, and every run records `apiKeySource` from the `init` event.
- **Isolation.** Each run gets a fresh temp project: a small CommonJS library, `AGENTS.md` with the lines from
  `docs/AGENTS.example.md`, and a one-line `CLAUDE.md` that imports it. User settings are not loaded
  (`--setting-sources project,local`), user and home instruction files are excluded (`claudeMdExcludes`), no session is
  saved, and built-in tools are off. With the tool, the only MCP server is `dist/mcp.js`
  (`--strict-mcp-config`) and only its tool is allowed. The control runs have no MCP server.
- **The prompt never mentions budget, cost or limits.** It asks for a refactor plan and a final `DECISION: start` or
  `DECISION: ask-first` line, so the decision can be read without judgment.
- **Scoring is code.** `scripts/agent-eval/evaluate.mts` derives the expected decision from the tool reading and the
  rule, reads the decision line, and checks quoted percentages and dollar amounts against the reading. Unit tests cover
  it, and the gate runs them.
- **No evaluation framework.** `inspect_ai` and `promptfoo` would add a Python runtime or a service to a VS Code
  extension repository for one tool and 48 runs. A small Node script that anyone can rerun is enough.

## Consequences

Every run, including failed ones, is a JSON file in `demo/eval/runs/`; key values are cut to their last four
characters and home or temp paths are replaced. Results hold for one gateway version, a mock upstream, one prompt and
the Claude Code version recorded in the summary. The agent's own model calls do not go through the gateway, so the
evaluation tests the agent's decision, not its spending. A rerun costs subscription usage on the account that runs it.
