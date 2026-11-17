# 0016: Rebuild changed slides of the redesigned deck from HTML

Status: accepted (2026-11-17)

## Context

The submitted deck was redesigned on 15 November: the slide text from `deck/slides.yaml`, laid out in HTML and exported
with headless Chromium. The HTML was not kept in the repository. The only build command left was `npm run deck`, which
runs `deck/build.py` (ADR 0013) and writes a plain deck in a different style. On 17 November that command replaced the
redesigned deck, and the closing slide lost its criteria table.

## Decision

- `npm run deck` now runs `deck/redesign/build.sh`. The slides named under `redesign.slides` in `deck/slides.yaml` are
  laid out in HTML with the redesigned look (Barlow and IBM Plex Mono from npm, colours from the YAML theme) and exported
  with Playwright Chromium. Each one replaces the slide with the same number in `deck/bifrost-meter.pptx` and
  `docs/deck.pdf`; the other slides are kept as they are.
- Text and settings that only the redesigned layout uses sit in a `redesign` block under each slide in the YAML. The
  closing slide reads its rows from the README criteria table, so the two cannot drift.
- The plain build stays as `npm run deck:plain`, for checking the text.

## Consequences

- A text change on slides 1, 9, 11 or 12 is one YAML edit and one command. Another slide needs a layout in
  `deck/redesign/render.mjs` before it can be listed.
- The starting point is the redesigned deck in the repository. A run of `npm run deck:plain` must be undone with
  `git checkout` before `npm run deck`.
- To undo, restore `deck/bifrost-meter.pptx` and `docs/deck.pdf` from an earlier commit and delete `deck/redesign/`.
