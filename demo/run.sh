#!/usr/bin/env bash
# One-command demo: the pinned Bifrost gateway, the mock upstream, demo keys, steady mock traffic and code-server in your
# browser with Bifrost Meter installed and already connected. Everything listens on 127.0.0.1 only. Needs Docker.
#
#   demo/run.sh          start (or restart) the demo and print the editor link
#   demo/run.sh stop     remove every demo container and its data
#
# Ports and the setup token live in demo/.env (created from demo/.env.example on the first run).
# Editor settings: demo/editor-settings.json. Keys, budgets and traffic: demo/demo.config.json.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
env_file="$here/.env"
node_image="node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914" # node:22.23.4-alpine, as in docker-compose.yml

say() { printf '[demo] %s\n' "$*" >&2; }
die() { say "$*"; exit 1; }

command -v docker >/dev/null || die "Docker is required: https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "The Docker compose plugin is required."

# demo/.env: copy the example on the first run and fill in a random setup token if it is empty.
if [[ ! -f "$env_file" ]]; then
  cp "$here/.env.example" "$env_file"
  say "created demo/.env from demo/.env.example"
fi
if ! grep -Eq '^BIFROST_SETUP_TOKEN=.+' "$env_file"; then
  token="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  sed -i.bak "s/^BIFROST_SETUP_TOKEN=.*/BIFROST_SETUP_TOKEN=$token/" "$env_file" && rm -f "$env_file.bak"
  grep -q '^BIFROST_SETUP_TOKEN=' "$env_file" || printf 'BIFROST_SETUP_TOKEN=%s\n' "$token" >>"$env_file"
  say "wrote a random BIFROST_SETUP_TOKEN to demo/.env"
fi
# Values already set in the shell win over demo/.env, as they do for docker compose itself.
while IFS='=' read -r k v; do
  if [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ && -z "${!k+x}" ]]; then export "$k=$v"; fi
done <"$env_file"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bifrost-meter-demo}"
export BIFROST_PORT="${BIFROST_PORT:-8080}"
export CODE_SERVER_PORT="${CODE_SERVER_PORT:-8443}"

files=(-f "$here/docker-compose.yml" -f "$root/test/e2e/docker-compose.e2e.yml" -f "$here/docker-compose.run.yml")
dc() { docker compose --progress quiet --env-file "$env_file" "${files[@]}" --profile traffic "$@"; }

if [[ "${1:-}" == "stop" ]]; then
  BIFROST_METER_VSIX=/dev/null BIFROST_METER_DEMO_KEY=unused dc down -v --remove-orphans
  exit 0
fi
[[ $# -eq 0 ]] || die "usage: demo/run.sh [stop]"

# The extension package: $BIFROST_METER_VSIX, else ./bifrost-meter.vsix from `npm run package`, else build it in a container.
vsix="${BIFROST_METER_VSIX:-}"
if [[ -z "$vsix" && -f "$root/bifrost-meter.vsix" ]]; then vsix="$root/bifrost-meter.vsix"; fi
if [[ -z "$vsix" ]]; then
  vsix="$root/out/demo/bifrost-meter.vsix"
  if [[ ! -f "$vsix" ]]; then
    say "building the extension in a Node 22 container (first run only, about a minute)"
    mkdir -p "$root/out/demo"
    docker run --rm --name "bifrost-meter-build-$$" --cpus 2 --memory 2g --user "$(id -u):$(id -g)" \
      -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -e npm_config_update_notifier=false \
      -v "$root:/src:ro" -v "$root/out/demo:/out" "$node_image" sh -ec '
        mkdir /tmp/build && cd /src
        tar cf - --exclude=./node_modules --exclude=./out --exclude=./.git . | tar xf - -C /tmp/build
        cd /tmp/build && npm ci --no-audit --no-fund --loglevel=error && npm run --silent package >/dev/null
        cp bifrost-meter.vsix /out/bifrost-meter.vsix' >&2
  fi
fi
[[ -f "$vsix" ]] || die "extension package not found: $vsix"
export BIFROST_METER_VSIX="$(cd "$(dirname "$vsix")" && pwd)/$(basename "$vsix")"

# Start from a clean stack so the keys printed below are the ones the editor uses.
BIFROST_METER_DEMO_KEY=unused dc down -v --remove-orphans >/dev/null 2>&1 || true

say "starting the gateway and the mock upstream, then creating the demo keys"
seed_out="$(BIFROST_METER_DEMO_KEY=unused dc run --rm -T bifrost-meter-seed)"
key_name="$(sed -n 's/.*"keyName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$here/demo.config.json" | head -n 1)"
demo_key="$(printf '%s\n' "$seed_out" | sed -n "s/^${key_name}: //p" | head -n 1)"
[[ -n "$demo_key" ]] || die "the seed did not print a key named \"$key_name\" (see demo/demo.config.json)"
export BIFROST_METER_DEMO_KEY="$demo_key"

say "starting mock traffic and the editor"
dc up -d --wait bifrost-meter-code-server >/dev/null
docker compose --progress quiet --env-file "$env_file" "${files[@]}" exec -T bifrost-meter-code-server sh -c \
  'mkdir -p /home/coder/.local/share/code-server/User && cat > /home/coder/.local/share/code-server/User/settings.json' \
  <"$here/editor-settings.json"
dc up -d --no-deps bifrost-meter-traffic >/dev/null

cat <<EOF

  Editor:   http://127.0.0.1:${CODE_SERVER_PORT}/
  Gateway:  http://127.0.0.1:${BIFROST_PORT}/

  The meter is in the status bar, bottom right. It uses the key "${key_name}", and mock traffic moves it every few seconds.
  Demo keys (local gateway only, new on every run):
$(printf '%s\n' "$seed_out" | grep -E '^[A-Za-z0-9_.-]+: ' | sed 's/^/    /')

  Stop and delete everything:  demo/run.sh stop

EOF
