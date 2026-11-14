# 0010. MCP server and automatic registration in VS Code

- Status: accepted
- Date: 2026-11-14

## Context

The design brief asks for an MCP server with one tool, `get_budget_status`, bundled with the extension and registered with
the editor when the editor supports it. VS Code's API for this is `vscode.lm.registerMcpServerDefinitionProvider` with the
`contributes.mcpServerDefinitionProviders` contribution point; it is stable from VS Code 1.101 (the official sample targets
`^1.101.0`). The extension's version floor is 1.90.

## Decision

- `src/mcp/` holds the server (stdio, official TypeScript SDK 1.32.2 with zod 4, both bundled into `dist/mcp.js` and listed
  as development dependencies). It reuses the core client, limit model and forecast, and the extension's settings rules
  and text helpers, so the tool and the status bar cannot disagree. Lint keeps `vscode` out of `src/mcp`.
- The tool takes no arguments, is annotated read-only and idempotent, and declares an output schema. Errors are tool errors
  with a one-sentence reason.
- The forecast uses readings from earlier calls in the same server process; nothing is stored on disk. With one call
  `will_exhaust_before_reset` is `null` rather than a guess.
- The extension detects the provider API at run time and registers the server only when both the function and the
  `McpStdioServerDefinition` class exist. The floor stays at 1.90; older editors get the manual setup in docs/MCP.md.
- The server runs with `process.execPath` (the editor's runtime, as the VS Code API documentation suggests for Node.js
  servers) and `ELECTRON_RUN_AS_NODE=1`, so no separate Node.js install is needed.
- The key is added to the server's environment in `resolveMcpServerDefinition`, when the editor starts the server, not in
  the listed definition, which the editor may cache. Key and settings changes fire the provider's change event.

## Consequences

- `dist/mcp.js` is about 0.9 MB, mostly zod and ajv from the SDK. Accepted: the SDK is the reference implementation and the
  file is only loaded when an agent starts the server.
- If an editor starts the server without calling the resolver, the tool answers that `BIFROST_VIRTUAL_KEY` is not set
  rather than failing silently; the manual setup is the fallback.
- Tests: unit tests for the result builder and the registration (fake editor API), an SDK client over stdio against
  recorded responses, and the same client against the pinned gateway in the contract suite.
