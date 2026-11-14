# 0012: One-command demo

Status: accepted (2026-11-14)

## Context

Trying the meter took three manual steps: start the stack, copy a demo key from the seed log, then install the `.vsix` in
an editor and paste the key. A reviewer with only Docker should see the meter working from one command, and the
maintainers should not keep a second copy of the editor setup next to the one the end-to-end tests use.

## Decision

- `demo/run.sh` reuses the end-to-end overlay (`test/e2e/docker-compose.e2e.yml`) for code-server and adds a small overlay,
  `demo/docker-compose.run.yml`, that passes the demo key and gateway URL to the editor through `BIFROST_VIRTUAL_KEY` and
  `BIFROST_BASE_URL`. These are the extension's documented environment fallbacks, so the demo uses the same code path a
  user without a secret prompt would.
- The seed runs once with `docker compose run`, and the script takes the key named in `traffic.keyName` from its output.
  The stack is removed and started fresh on each run, so the printed keys are the ones in use.
- If no `.vsix` is given or present, the script builds one in the pinned Node 22 image from a copy of the source, so the
  host's `node_modules` is not touched and Node is not required on the host.
- Ports and the setup token live in `demo/.env`, which the script creates from `demo/.env.example` with a random token.
  Editor settings are in `demo/editor-settings.json`. Every port is bound to `127.0.0.1`.

## Consequences

The first run needs network access for the images and npm packages and takes about a minute on a warm Docker cache. The
three-step path stays documented for people who want to use their own editor.
