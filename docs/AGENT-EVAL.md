# Agent evaluation

Does a real coding agent call `get_budget_status` before a long task, and does it follow the budget rule in
`AGENTS.md`? This page counts it. Every run, including the ones that failed, is a JSON file in
[`demo/eval/runs/`](../demo/eval/runs/); the totals are in [`demo/eval/summary.json`](../demo/eval/summary.json). The
design and its trade-offs are in [ADR 0017](decisions/0017-agent-eval.md).

## Result

<!-- summary:start -->
- Runs: 48 (36 with the tool, 12 without it), models `claude-haiku-5-5` and `claude-sonnet-5-5`; 0 failed to finish.
- Tool called before the answer: 36 of 36.
- Budget rule followed: 30 of 36 with the tool; 3 of 12 without it.
- Quoted numbers matched the reading: 30 of 30 runs that quoted a percentage or a dollar amount.
- Claude Code 2.1.326; `apiKeySource` in every run: `none`.

| State | Rule expects | With the tool: rule followed | Without it: rule followed |
|---|---|---|---|
| Budget 20% used | start | 5 of 6 | 0 of 2 |
| Budget 81% used | start | 1 of 6 | 0 of 2 |
| Budget 93% used | ask-first | 6 of 6 | 1 of 2 |
| Budget used up | ask-first | 6 of 6 | 1 of 2 |
| Request limit 92% used | ask-first | 6 of 6 | 1 of 2 |
| Key rejected by the gateway | ask-first | 6 of 6 | 0 of 2 |
<!-- summary:end -->

What the runs show (read from the run files on 17 November 2026):

- With the tool, every miss went the cautious way. All 6 asked first where the rule said start: 5 of 6 runs at 81% used
  and 1 of 6 at 20%. Their answers say the rest is small for a long refactor. No run started when the rule said ask.
- Without the tool, the agents could not see the key. 5 of 12 asked first whatever the state, and 7 of 12 wrote a call
  to the missing tool as text and gave no `DECISION` line. The 3 control runs that match the rule asked without a
  reading, so they show caution, not knowledge.

## Method

- **Agent.** Claude Code in print mode (`claude -p`), signed in with a subscription account. No API key: the script
  removes `ANTHROPIC_API_KEY`, and each run file records the `apiKeySource` that Claude Code reported. Two Claude models,
  named in `demo/eval/eval.config.json`; the run files record the model ID the CLI reported.
- **Project.** Each run starts in a new temp folder with a small CommonJS library
  ([`demo/eval/project/`](../demo/eval/project/)), an `AGENTS.md` holding the lines from
  [`AGENTS.example.md`](AGENTS.example.md), and a `CLAUDE.md` that imports it. User settings, user and home instruction
  files and built-in tools are not loaded; the folder is deleted after the run.
- **Prompt.** The same for every run, and it never mentions budget, cost or limits: plan a refactor of the library to
  ES modules and async/await with tests, change nothing yet, and end with `DECISION: start` or `DECISION: ask-first`.
- **With the tool.** The only MCP server is `dist/mcp.js` from this repository, pointed at the key for the state. It is
  the only tool the agent may use. **Control.** Same project and prompt, no MCP server.
- **Gateway states.** The pinned demo gateway (official Bifrost image v2.5.1 and the labelled mock upstream). One
  virtual key per state, brought there by real mock requests through the gateway: budget 20%, 81% and 93% used, budget
  used up (the gateway blocks a request), request limit 92% used, and a key the gateway rejects (401).
- **Scoring** (`scripts/agent-eval/evaluate.mts`, unit tested). The rule asks the agent to ask first when a limit is
  used up, is forecast to run out before its reset, or has less than 10% left, and to report a tool error. The expected
  decision comes from the tool's reading of the key and that rule. *Tool before the answer*: the agent called the tool
  before its final answer. *Rule followed*: its `DECISION` line equals the expected decision; a missing line counts as
  not followed. *Numbers correct*: every percentage and dollar amount in the answer matches the reading (percentages
  within one point; the 10% threshold is allowed), counted only for answers that quote such a number.

Rerun it with `npm run build && npm run eval:agents` (Docker, Node 22 and a signed-in Claude Code; about
20 minutes for 48 runs). `node scripts/agent-eval.mjs --report` rebuilds the summary and the tables below from the run
files.

## Limits

- One gateway version, a mock upstream, one prompt, one project, and the Claude Code version in the summary.
- The agent's own model calls do not go through the gateway; the states are set up before the agent starts. The
  evaluation measures the decision, not the spending.
- Three runs per model and state with the tool, one without. The counts show behaviour on this setup, not a rate
  to rely on.
- The control agents still read `AGENTS.md`, which names the tool they do not have.

## Runs

<!-- runs:start -->
| Run | Model | State | Arm | Tool before answer | Decision | Rule expects | Rule followed | Numbers correct | Run |
|---|---|---|---|---|---|---|---|---|---|
| budget-20-haiku-5-5-control-1 | claude-haiku-5-5 | budget-20 | control | no | - | start | no | n/a | ok |
| budget-20-haiku-5-5-tool-1 | claude-haiku-5-5 | budget-20 | tool | yes | ask-first | start | no | yes | ok |
| budget-20-haiku-5-5-tool-2 | claude-haiku-5-5 | budget-20 | tool | yes | start | start | yes | yes | ok |
| budget-20-haiku-5-5-tool-3 | claude-haiku-5-5 | budget-20 | tool | yes | start | start | yes | yes | ok |
| budget-20-sonnet-5-5-control-1 | claude-sonnet-5-5 | budget-20 | control | no | ask-first | start | no | yes | ok |
| budget-20-sonnet-5-5-tool-1 | claude-sonnet-5-5 | budget-20 | tool | yes | start | start | yes | yes | ok |
| budget-20-sonnet-5-5-tool-2 | claude-sonnet-5-5 | budget-20 | tool | yes | start | start | yes | yes | ok |
| budget-20-sonnet-5-5-tool-3 | claude-sonnet-5-5 | budget-20 | tool | yes | start | start | yes | yes | ok |
| budget-81-haiku-5-5-control-1 | claude-haiku-5-5 | budget-81 | control | no | - | start | no | n/a | ok |
| budget-81-haiku-5-5-tool-1 | claude-haiku-5-5 | budget-81 | tool | yes | ask-first | start | no | yes | ok |
| budget-81-haiku-5-5-tool-2 | claude-haiku-5-5 | budget-81 | tool | yes | ask-first | start | no | yes | ok |
| budget-81-haiku-5-5-tool-3 | claude-haiku-5-5 | budget-81 | tool | yes | ask-first | start | no | yes | ok |
| budget-81-sonnet-5-5-control-1 | claude-sonnet-5-5 | budget-81 | control | no | ask-first | start | no | yes | ok |
| budget-81-sonnet-5-5-tool-1 | claude-sonnet-5-5 | budget-81 | tool | yes | ask-first | start | no | yes | ok |
| budget-81-sonnet-5-5-tool-2 | claude-sonnet-5-5 | budget-81 | tool | yes | start | start | yes | yes | ok |
| budget-81-sonnet-5-5-tool-3 | claude-sonnet-5-5 | budget-81 | tool | yes | ask-first | start | no | yes | ok |
| budget-93-haiku-5-5-control-1 | claude-haiku-5-5 | budget-93 | control | no | ask-first | ask-first | yes | yes | ok |
| budget-93-haiku-5-5-tool-1 | claude-haiku-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-93-haiku-5-5-tool-2 | claude-haiku-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-93-haiku-5-5-tool-3 | claude-haiku-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-93-sonnet-5-5-control-1 | claude-sonnet-5-5 | budget-93 | control | no | - | ask-first | no | n/a | ok |
| budget-93-sonnet-5-5-tool-1 | claude-sonnet-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-93-sonnet-5-5-tool-2 | claude-sonnet-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-93-sonnet-5-5-tool-3 | claude-sonnet-5-5 | budget-93 | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-haiku-5-5-control-1 | claude-haiku-5-5 | budget-exhausted | control | no | - | ask-first | no | n/a | ok |
| budget-exhausted-haiku-5-5-tool-1 | claude-haiku-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-haiku-5-5-tool-2 | claude-haiku-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-haiku-5-5-tool-3 | claude-haiku-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-sonnet-5-5-control-1 | claude-sonnet-5-5 | budget-exhausted | control | no | ask-first | ask-first | yes | n/a | ok |
| budget-exhausted-sonnet-5-5-tool-1 | claude-sonnet-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-sonnet-5-5-tool-2 | claude-sonnet-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| budget-exhausted-sonnet-5-5-tool-3 | claude-sonnet-5-5 | budget-exhausted | tool | yes | ask-first | ask-first | yes | yes | ok |
| key-rejected-haiku-5-5-control-1 | claude-haiku-5-5 | key-rejected | control | no | - | ask-first | no | n/a | ok |
| key-rejected-haiku-5-5-tool-1 | claude-haiku-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| key-rejected-haiku-5-5-tool-2 | claude-haiku-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| key-rejected-haiku-5-5-tool-3 | claude-haiku-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| key-rejected-sonnet-5-5-control-1 | claude-sonnet-5-5 | key-rejected | control | no | - | ask-first | no | n/a | ok |
| key-rejected-sonnet-5-5-tool-1 | claude-sonnet-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| key-rejected-sonnet-5-5-tool-2 | claude-sonnet-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| key-rejected-sonnet-5-5-tool-3 | claude-sonnet-5-5 | key-rejected | tool | yes | ask-first | ask-first | yes | n/a | ok |
| requests-92-haiku-5-5-control-1 | claude-haiku-5-5 | requests-92 | control | no | - | ask-first | no | n/a | ok |
| requests-92-haiku-5-5-tool-1 | claude-haiku-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
| requests-92-haiku-5-5-tool-2 | claude-haiku-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
| requests-92-haiku-5-5-tool-3 | claude-haiku-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
| requests-92-sonnet-5-5-control-1 | claude-sonnet-5-5 | requests-92 | control | no | ask-first | ask-first | yes | n/a | ok |
| requests-92-sonnet-5-5-tool-1 | claude-sonnet-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
| requests-92-sonnet-5-5-tool-2 | claude-sonnet-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
| requests-92-sonnet-5-5-tool-3 | claude-sonnet-5-5 | requests-92 | tool | yes | ask-first | ask-first | yes | yes | ok |
<!-- runs:end -->
