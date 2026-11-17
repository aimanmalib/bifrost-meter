#!/usr/bin/env bash
# Redesigned deck: lay out the slides listed under `redesign` in deck/slides.yaml as HTML, export them with
# headless Chromium (Playwright), and put them into deck/bifrost-meter.pptx and docs/deck.pdf in place of the
# same slide numbers. Fonts (Barlow, IBM Plex Mono; SIL Open Font License) come from npm at pinned versions.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=deck/build/redesign
FONTS="$OUT/fonts"
mkdir -p "$FONTS"
if [ ! -f "$FONTS/barlow-latin-900-normal.woff2" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  npm pack -q --pack-destination "$tmp" @fontsource/barlow@5.3.0 @fontsource/ibm-plex-mono@5.3.0 >/dev/null
  for t in "$tmp"/*.tgz; do tar -xzf "$t" -C "$tmp" package/files; done
  cp "$tmp"/package/files/barlow-latin-{400,500,700,900}-normal.woff2 \
     "$tmp"/package/files/ibm-plex-mono-latin-{400,500}-normal.woff2 "$FONTS/"
fi
uv run -q --with pyyaml==6.0.2 python -I deck/redesign/deck.py spec
node deck/redesign/render.mjs
uv run -q --with python-pptx==1.0.2 --with pypdf==5.4.0 python -I deck/redesign/deck.py splice
