# 0013: Slide deck built from a data file

Status: accepted (2026-11-14)

## Context

The submission needs a short slide deck (16:9, at most 12 slides). Slides written by hand drift from the README and the test
results, and nobody can check them in review. The numbers on the slides must match `docs/TEST-RESULTS.md`.

## Decision

- All slide text, image paths, crops and colours live in `deck/slides.yaml`. `deck/build.py` only lays them out with
  `python-pptx` and writes `deck/bifrost-meter.pptx`. Fonts are Arial and Courier New, so the file opens the same way in
  PowerPoint, Keynote and LibreOffice.
- `deck/render.sh` converts the deck to `docs/deck.pdf` and one PNG per slide with LibreOffice in a throwaway container
  (pinned by digest, one CPU). The PNG pages are for checking the slides as images; they are not tracked.
- `npm run deck` runs both. It needs `uv` and Docker. It is not part of `npm run gate`: the deck is a submission file,
  not part of the extension.
- Screenshots come from the tracked images in `docs/images/` and one frame of the recorded demo (`deck/assets/`), so the
  slides show the same real runs as the README.

## Consequences

- Changing a number or a sentence means editing one YAML file and running one command.
- The tracked `.pptx` and PDF must be rebuilt after the YAML changes; the review checks the PNG pages.
- To undo, delete `deck/` and `docs/deck.pdf`; nothing in the extension depends on them.
