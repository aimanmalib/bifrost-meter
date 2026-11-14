// Cuts the demo recording into the final video and the README GIF.
// Input: out/recording/raw.webm + scenes.json (test/video/record.video.ts). Scene order, lengths, captions and GIF
// settings come from demo/recording.config.json. Scenes are cut at normal speed (no speed-up) and joined; captions are
// burned in; a scene without footage (the end card) is a plain card with its caption in the middle.
// The recording is at the viewport size; each scene is cropped (a scene may zoom into a region, given in viewport
// pixels) and scaled to the output size.
// Output: out/recording/bifrost-meter-demo.mp4 (1920x1080, silent) and docs/images/hero.gif.
// Usage: node scripts/cut-demo.mjs   (needs ffmpeg and ffprobe on PATH)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/recording');
const rec = JSON.parse(readFileSync(join(root, 'demo/recording.config.json'), 'utf8')).recording;
const { scenes: marks } = JSON.parse(readFileSync(join(out, 'scenes.json'), 'utf8'));
const { width: W, height: H } = rec.output;
const full = { x: 0, y: 0, ...rec.viewport };
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

// Timeline: each scene's place in the final video.
let at = 0;
const timeline = rec.scenes.map((s) => {
  const mark = marks[s.id];
  const length = mark ? Math.min(s.seconds, mark.end - mark.start) : s.seconds;
  const item = { ...s, mark, at, length };
  at += length;
  return item;
});
if (at > rec.maxSeconds) throw new Error(`video would be ${at.toFixed(1)} s; the limit is ${rec.maxSeconds} s`);

// Captions (ASS): a bar at the top for scenes (the status bar and notifications live at the bottom), centred large text for the end card.
const clock = (t) => {
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const ass = [
  '[Script Info]',
  'ScriptType: v4.00+',
  `PlayResX: ${W}`,
  `PlayResY: ${H}`,
  'WrapStyle: 0',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Caption,DejaVu Sans,38,&H00FFFFFF,&H00FFFFFF,&H20101010,&H00000000,0,0,0,0,100,100,0,0,3,14,0,8,160,160,36,1',
  'Style: Card,DejaVu Sans,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...timeline.map(
    (s) => `Dialogue: 0,${clock(s.at)},${clock(s.at + s.length)},${s.mark ? 'Caption' : 'Card'},,0,0,0,,${s.caption.replace(/\n/g, '\\N')}`,
  ),
].join('\n');
const assFile = join(out, 'captions.ass');
writeFileSync(assFile, `${ass}\n`);

// Cut, join, caption.
const crop = (r) => `crop=${r.width}:${r.height}:${r.x}:${r.y}`;
const parts = timeline.map((s, i) =>
  s.mark
    ? `[0:v]trim=start=${s.mark.start.toFixed(2)}:duration=${s.length.toFixed(2)},setpts=PTS-STARTPTS,${crop(s.zoom ?? full)},scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p,setsar=1[v${i}]`
    : `color=c=0x1f1f1f:s=${W}x${H}:r=30:d=${s.length.toFixed(2)},format=yuv420p,setsar=1[v${i}]`,
);
const graph = [
  ...parts,
  `${timeline.map((_, i) => `[v${i}]`).join('')}concat=n=${timeline.length}:v=1:a=0[cat]`,
  `[cat]subtitles=${assFile.replace(/[:\\']/g, '\\$&')}[out]`,
].join(';');
const mp4 = join(out, 'bifrost-meter-demo.mp4');
ff(['-i', join(out, 'raw.webm'), '-filter_complex', graph, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);

// README GIF: a slice of the finished video, so it carries the same captions.
const g = rec.gif;
const from = timeline.find((s) => s.id === g.from);
const gif = join(root, 'docs/images/hero.gif');
ff([
  '-ss', String(from.at), '-t', String(g.seconds), '-i', mp4,
  '-vf', `fps=${g.fps},scale=${g.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  gif,
]);
const gifBytes = statSync(gif).size;
if (gifBytes > g.maxBytes) throw new Error(`hero.gif is ${gifBytes} bytes; the limit is ${g.maxBytes}`);

const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', mp4], { encoding: 'utf8' });
console.log(JSON.stringify({ video: mp4.slice(root.length + 1), seconds: Number(at.toFixed(2)), probe: JSON.parse(probe), gifBytes, timeline: timeline.map(({ id, at: t, length }) => ({ id, at: Number(t.toFixed(2)), length: Number(length.toFixed(2)) })) }, null, 2));
