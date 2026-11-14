# 0001. Toolchain

- Status: accepted
- Date: 2026-11-14

## Context

Bifrost Meter is a VS Code extension plus a small MCP server. It has to build, test and package the same way on a laptop and in
CI, with as few moving parts as possible.

## Decision

- **Node.js 22** (`.nvmrc`). The extension host bundles its own runtime; Node 22 is for the build, tests and the MCP server.
- **TypeScript** in strict mode, one npm package, `package-lock.json` committed.
- **esbuild** bundles the extension and the MCP server into single files under `dist/`.
- **vitest** runs unit tests (pure core, no VS Code import) and the contract tests against a Bifrost container.
- **@vscode/vsce** packages the `.vsix`. The extension is not published to any marketplace.
- No runtime dependencies in the extension except the MCP SDK (bundled). HTTP uses the built-in `fetch`.
- **Bifrost under test** is the official image, unmodified and pinned by digest:
  `maximhq/bifrost@sha256:5ec9873acaf1687556b6e4dd854b92b539d9debf87a5a683b66338648b84d3c8` (`/api/version` reports `v2.5.1`).
  Tags can move; a digest cannot, so test results stay reproducible.

## Consequences

- Upgrading Bifrost means changing one digest and re-running the contract tests.
- Contributors need Node 22 and Docker for the full test set; unit tests need Node only.
