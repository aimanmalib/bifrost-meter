# Contributing

Thanks for helping. Bifrost Meter holds a virtual key that can spend a budget, so changes to how the key is stored or
sent get extra scrutiny.

## Set up

Node.js 22 (see `.nvmrc`). Docker is needed only for the contract tests, the end-to-end tests and the demo.

```sh
npm ci
npm run gate            # lint, type check, unit tests, build, package
npm run test:contract   # against the pinned Bifrost gateway in Docker
npm run test:e2e        # Playwright driving code-server
demo/run.sh             # the whole stack with mock traffic; demo/run.sh stop removes it
```

## Before you open a pull request

- Run `npm run gate`; CI runs the same steps plus the contract suite.
- `src/core` must not import `vscode`. The MCP server and the terminal status line reuse it, and lint enforces the rule.
- User-facing text goes in `package.nls*.json` and `l10n/bundle.l10n*.json`, in English and Malay with the same keys.
- A change to how the key is stored, shown or sent needs a test that fails without your change. Read
  [`docs/SECURITY.md`](docs/SECURITY.md) first.
- A change that depends on a gateway response field needs a contract test and a line in
  [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md).
- One topic per pull request; describe how you tested it.

## Reporting security issues

Please don't open a public issue. Use
[private vulnerability reporting](https://github.com/aimanmalib/bifrost-meter/security/advisories/new).

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
