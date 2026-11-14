# 0009. Design review pass: wording, flat chart, high contrast bar, state sheets

- Status: accepted
- Date: 2026-11-14

## Context

Every display state was reviewed as an image in dark, light and high contrast, at panel widths of 320 and 520 pixels, in
English and Malay. Four things read badly:

- Notifications built from the limit name read "Requests is at 80%".
- The status bar ended with a bare "4h", which could be read as time used or time left.
- On a new key the usage chart was a flat line along the bottom, which looks like a broken chart.
- In high contrast themes the bar track and the used part had nearly the same colour.
- In light themes the forecast line, written in the theme's warning colour, was too pale on white for small text.

## Decision

- Notifications lead with the limit name and a colon: "Requests: 80% used, 6 left." This works for every limit name and
  scope in both languages.
- The status bar says "resets in 4h" (Malay "set semula dalam 4j"), also in the used-up state. `statusBar.format: compact`
  remains for narrow windows.
- While usage has not moved, the panel says so in words instead of drawing the chart.
- High contrast themes drop the track fill and keep its outline, so the used part stands out.
- The forecast line uses the normal text colour with a thin warning-coloured mark on its left.
- `npm run preview:states` renders all 14 states (the 13 of the design brief plus the insecure URL error) with the
  extension's own code into review sheets and fails on horizontal overflow. Its theme colours are approximations of the
  editor's default themes; screenshots in real themes still come from the end-to-end tests.

## Consequences

The status bar text is a few characters longer in `full` format. The preview sheets are a review aid, not a test of the
real editor.
