# 0011: Demo video recorded from the running stack

Status: accepted (2026-11-14)

## Context

The demo video and the README GIF must show the product in the first seconds, be readable, and show only numbers from
a running gateway. With the default demo key, the strictest limit is the request count, and a mock request costs a small
fraction of a cent, so the budget would not move during a short video.

## Decision

- A separate seed file, `demo/recording.config.json`, creates one key with a USD 0.05 daily budget and loose token and
  request limits. The budget is then the strictest limit, so the status bar shows dollars, and a few dozen mock requests
  take it from OK to warning to used up.
- `test/video/record.video.ts` drives the packaged extension in code-server (the end-to-end stack) and records one
  continuous browser video. It sends slow traffic for a little over two minutes first, so the run-out forecast is real.
  Each scene is logged with its start and end time in the video.
- `scripts/cut-demo.mjs` cuts the scenes at normal speed, joins them in the configured order, burns in English captions
  and adds an end card. Playwright records at the viewport size (1280x720) and does not scale up, so the cut scales
  to 1920x1080; the opening, traffic and hover scenes crop into the status bar corner instead of using a smaller viewport.
- The GIF is a slice of the finished video, so it carries the same captions.
- The MCP scene shows the result of a real `tools/call` against the same gateway, written into the editor as a file.
  The script checks that the full key is not in it.

## Consequences

The video is about 77 seconds, under the 90-second limit. It is not tracked in git; it goes with the release. Recording
again takes about ten minutes and needs Docker and ffmpeg. Scenes, captions and zoom areas change in the config file.
