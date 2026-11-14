#!/usr/bin/env bash
# Fast quality gate: install (when needed), lint, type check, unit tests, build, package.
# Contract and end-to-end tests are separate (npm run test:contract, npm run test:e2e).
set -euo pipefail

# Git hooks export GIT_DIR and friends; tests that run git in temp folders must not inherit them.
while IFS= read -r v; do unset "$v"; done < <(env | grep -o '^GIT_[A-Z_]*' || true)

cd "$(dirname "$0")/.."

# Prefer Node 22 from nvm when the default node is older.
need=$(tr -dc '0-9' < .nvmrc)
major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(major)" != "$need" ] && [ -d "${NVM_DIR:-$HOME/.nvm}/versions/node" ]; then
  candidate=$(ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v${need}."* 2>/dev/null | sort -V | tail -1 || true)
  [ -n "$candidate" ] && export PATH="$candidate/bin:$PATH"
fi
if [ "$(major)" != "$need" ]; then
  echo "gate: Node $need required, found $(node -v 2>/dev/null || echo none)" >&2
  exit 1
fi

step() { printf '\n== %s\n' "$1"; }
started=$(date +%s)

# Reinstall only when package-lock.json changed since the last install.
stamp=node_modules/.lock-sha
lock_sha=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$lock_sha" ]; then
  step "npm ci"
  npm ci --no-audit --no-fund --loglevel=error
  echo "$lock_sha" > "$stamp"
fi

step "lint";      npm run --silent lint
step "typecheck"; npm run --silent typecheck
step "unit";      npx vitest run --reporter=dot
step "build";     npm run --silent build
if node -e 'process.exit(require("./package.json").scripts?.package ? 0 : 1)'; then
  step "package"; npm run --silent package
fi

echo
echo "gate: OK in $(( $(date +%s) - started ))s"
