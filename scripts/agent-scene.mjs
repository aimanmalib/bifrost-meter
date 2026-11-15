// Renders the "agent" scene of the demo video from a recorded agent session (demo/agent-session.json): the prompt, the
// MCP tool call, its result and the agent's reply, replayed at reading speed. Nothing on screen is invented: every
// text and number comes from that file. Frames are drawn at fixed times, so the clip is the same on every run.
// Output: out/recording/agent.mp4 at the output size of demo/recording.config.json.
// Usage: node scripts/agent-scene.mjs   (needs ffmpeg on PATH and the Playwright browser)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/recording');
const rec = JSON.parse(readFileSync(join(root, 'demo/recording.config.json'), 'utf8')).recording;
const session = JSON.parse(readFileSync(join(root, 'demo/agent-session.json'), 'utf8'));
const scene = rec.scenes.find((s) => s.id === 'agent');
if (!scene) throw new Error('demo/recording.config.json has no scene with id "agent"');
const cfg = rec.agentScene;
const seconds = scene.seconds;

// The tool result, shortened to the fields the scene talks about. Numbers are rounded for display only.
const round = (n) => Math.round(n * 10000) / 10000;
const limitLine = (l) =>
  `    { "kind": "${l.kind}", "limit": ${l.limit}, "used": ${round(l.used)}, "remaining": ${round(l.remaining)}, ` +
  `"percent": ${round(l.percent)}, "reset_period": "${l.reset_period}" }`;
const r = session.tool_result;
const resultLines = [
  '{',
  `  "key_name": "${r.key_name}", "key_hint": "${r.key_hint}", "is_exhausted": ${r.is_exhausted},`,
  '  "limits": [',
  ...r.limits.map((l, i) => limitLine(l) + (i < r.limits.length - 1 ? ',' : '')),
  '  ]',
  '}',
];
const day = new Date(session.recorded_at).toISOString().slice(0, 10);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${rec.viewport.width}px; height: ${rec.viewport.height}px; background: #1f1f1f; color: #d4d4d4;
         font: 15px/1.5 "DejaVu Sans Mono", "Liberation Mono", monospace; overflow: hidden; }
  .win { position: absolute; left: 110px; top: 96px; width: 1060px; height: 568px; background: #181818;
         border: 1px solid #3c3c3c; border-radius: 10px; overflow: hidden; }
  .bar { height: 34px; background: #2a2a2a; border-bottom: 1px solid #3c3c3c; display: flex; align-items: center;
         padding: 0 14px; color: #9d9d9d; font: 13px "DejaVu Sans", sans-serif; gap: 8px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #555; }
  .bar span { margin-left: 10px; }
  .body { padding: 18px 22px; white-space: pre-wrap; word-break: break-word; }
  .you { color: #9cdcfe; } .you b { color: #6a9955; font-weight: normal; }
  .tool { color: #dcdcaa; margin-top: 14px; } .tool i { color: #808080; font-style: normal; }
  .res { color: #b5b5b5; margin-top: 6px; font-size: 14px; line-height: 1.45; }
  .res em { color: #e2c08d; font-style: normal; }
  .say { color: #ffffff; margin-top: 14px; } .say b { color: #4ec9b0; font-weight: normal; }
  .foot { position: absolute; left: 110px; top: 676px; width: 1060px; color: #8a8a8a; font: 13px "DejaVu Sans", sans-serif; }
  .hide { visibility: hidden; }
</style>
<div class="win"><div class="bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>${esc(session.agent)} · MCP server: ${esc(session.mcp_server)}</span></div>
<div class="body"><div class="you" id="you"></div><div class="tool hide" id="tool">● ${esc(session.tool)}  <i>MCP tool, no arguments</i></div><div class="res hide" id="res"></div><div class="say" id="say"></div></div></div>
<div class="foot">Real session with ${esc(session.agent)}, recorded ${day}. Replayed at reading speed; the tool result is shortened to the fields shown.</div>
<script>
  const prompt = ${JSON.stringify(session.prompt)};
  const reply = ${JSON.stringify(session.reply)};
  const lines = ${JSON.stringify(resultLines)};
  const cfg = ${JSON.stringify(cfg)};
  const typed = (text, t, from, perSecond) => text.slice(0, Math.max(0, Math.floor((t - from) * perSecond)));
  window.draw = (t) => {
    const you = typed(prompt, t, cfg.promptAt, cfg.promptCharsPerSecond);
    document.getElementById('you').innerHTML = you ? '<b>&gt;</b> ' + you.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
    document.getElementById('tool').classList.toggle('hide', t < cfg.toolAt);
    const res = document.getElementById('res');
    res.classList.toggle('hide', t < cfg.resultAt);
    res.innerHTML = lines.map((l) => (l.includes('"budget"') ? '<em>' + l + '</em>' : l)).join('\\n');
    const say = typed(reply, t, cfg.replyAt, cfg.replyCharsPerSecond);
    document.getElementById('say').innerHTML = say ? '<b>●</b> ' + say.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
  };
  window.draw(0);
</script>`;

const frames = join(out, 'agent-frames');
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: rec.viewport, deviceScaleFactor: rec.output.width / rec.viewport.width });
await page.setContent(html);
const total = Math.round(seconds * cfg.fps);
for (let i = 0; i < total; i++) {
  await page.evaluate(`window.draw(${i / cfg.fps})`);
  await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
}
await browser.close();

const mp4 = join(out, 'agent.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(cfg.fps), '-i', join(frames, 'f%04d.png'),
  '-vf', `scale=${rec.output.width}:${rec.output.height}:flags=lanczos,fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', mp4], { stdio: 'inherit' });
rmSync(frames, { recursive: true, force: true });
console.log(JSON.stringify({ clip: mp4.slice(root.length + 1), seconds, frames: total }));
