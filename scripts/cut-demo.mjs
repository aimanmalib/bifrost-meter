// Cuts the demo recording into the final video and the README GIF.
// Input: out/recording/raw.webm + scenes.json (test/video/record.video.ts). Scene order, lengths, captions and GIF
// settings come from demo/recording.config.json. Scenes are cut at normal speed (no speed-up) and joined; captions are
// burned in; a scene without footage (the end card) is a plain card with its caption in the middle. A scene with a
// "clip" uses that file instead of the recording (the agent scene, made by scripts/agent-scene.mjs).
// The recording is at the viewport size; each scene is cropped (a scene may zoom into a region, given in viewport
// pixels) and scaled to the output size.
// Narration is optional: one audio file per scene, named <scene id>.mp3, in the folder set by "voice.dir". The files
// are not part of the repository (the released video is narrated with an AI clone of the author's voice). Without
// them the video is silent, with the same captions. "voice.music" may name a music file to play quietly underneath.
// Output: out/recording/bifrost-meter-demo.mp4 (1920x1080) and docs/images/hero.gif.
// Usage: node scripts/cut-demo.mjs   (needs ffmpeg and ffprobe on PATH)
// A shorter cut: DEMO_SCENES=hook,warning,agent,end DEMO_OUT=short.mp4 node scripts/cut-demo.mjs (the GIF is left alone).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const only = process.env.DEMO_SCENES?.split(',').map((x) => x.trim());
const timeline = rec.scenes.filter((s) => !only || only.includes(s.id)).map((s) => {
  const mark = s.clip ? undefined : marks[s.id];
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
  'Style: Caption,DejaVu Sans,42,&H00FFFFFF,&H00FFFFFF,&H18080808,&H00000000,-1,0,0,0,100,100,0,0,3,16,0,8,150,150,34,1',
  'Style: Card,DejaVu Sans,46,&H00E6E6E6,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,140,140,0,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...timeline.map(
    (s) => `Dialogue: 0,${clock(s.at)},${clock(s.at + s.length)},${s.mark || s.clip ? 'Caption' : 'Card'},,0,0,0,,${s.mark || s.clip ? s.caption.replace(/\n/g, '\\N') : s.caption.replace(/^([^\n]*)/, '{\\b1\\fs64\\c&HFFFFFF&}$1{\\b0\\fs40\\c&HB4B4B4&}').replace(/\n/g, '\\N\\N')}`,
  ),
].join('\n');
const assFile = join(out, 'captions.ass');
writeFileSync(assFile, `${ass}\n`);

// Inputs: the recording first, then one file per clip scene, then one file per narrated scene.
const inputs = ['-i', join(out, 'raw.webm')];
let next = 1;
for (const s of timeline) {
  if (!s.clip) continue;
  const file = join(root, s.clip);
  if (!existsSync(file)) throw new Error(`scene "${s.id}" needs ${s.clip}; run scripts/agent-scene.mjs first`);
  inputs.push('-i', file);
  s.input = next++;
}
const voice = rec.voice ?? {};
const spoken = timeline
  .map((s) => ({ s, file: join(root, voice.dir ?? 'out/recording/voice', `${s.id}.mp3`) }))
  .filter((v) => existsSync(v.file))
  .map((v) => {
    inputs.push('-i', v.file);
    return { ...v, input: next++ };
  });

// Cut, join, caption.
const crop = (r) => `crop=${r.width}:${r.height}:${r.x}:${r.y}`;
const fit = `scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p,setsar=1`;
const parts = timeline.map((s, i) => {
  if (s.mark) return `[0:v]trim=start=${s.mark.start.toFixed(2)}:duration=${s.length.toFixed(2)},setpts=PTS-STARTPTS,${crop(s.zoom ?? full)},${fit}[v${i}]`;
  if (s.clip) return `[${s.input}:v]trim=duration=${s.length.toFixed(2)},setpts=PTS-STARTPTS,${fit}[v${i}]`;
  return `color=c=0x1f1f1f:s=${W}x${H}:r=30:d=${s.length.toFixed(2)},format=yuv420p,setsar=1[v${i}]`;
});
// Narration: each line starts shortly after its scene, the mix is padded to the video length and set to one loudness.
// Optional music bed under the narration, faded in and out, well below the voice.
let musicInput = -1;
if (spoken.length && voice.music && existsSync(join(root, voice.music))) {
  inputs.push('-i', join(root, voice.music));
  musicInput = next++;
}
const bed = musicInput < 0 ? [] : [`[${musicInput}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${at.toFixed(2)},volume=${voice.musicDb ?? -25}dB,afade=t=in:d=1.5,afade=t=out:st=${(at - 3).toFixed(2)}:d=3[bed]`];
const sound = spoken.length
  ? [
      ...bed,
      ...spoken.map((v, i) => {
        const ms = Math.round((v.s.at + (voice.offsetSeconds ?? 0.4)) * 1000);
        return `[${v.input}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${ms}:all=1[a${i}]`;
      }),
      `${spoken.map((_, i) => `[a${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:duration=longest,apad=pad_dur=4,loudnorm=I=${voice.lufs ?? -16}:TP=-1.5:LRA=11,apad=whole_dur=${at.toFixed(2)},atrim=0:${at.toFixed(2)}[voice]`,
      bed.length ? `[voice][bed]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.7:level=false,apad=whole_dur=${at.toFixed(2)},atrim=0:${at.toFixed(2)}[aud]` : '[voice]anull[aud]',
    ]
  : [];
const graph = [
  ...parts,
  `${timeline.map((_, i) => `[v${i}]`).join('')}concat=n=${timeline.length}:v=1:a=0[cat]`,
  `[cat]subtitles=${assFile.replace(/[:\\']/g, '\\$&')}[out]`,
  ...sound,
].join(';');
const mp4 = join(out, process.env.DEMO_OUT ?? 'bifrost-meter-demo.mp4');
const audio = spoken.length ? ['-map', '[aud]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an'];
ff([...inputs, '-filter_complex', graph, '-map', '[out]', ...audio, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);

// README GIF: a slice of the finished video, so it carries the same captions.
if (only) {
  console.log(JSON.stringify({ video: mp4.slice(root.length + 1), seconds: Number(at.toFixed(2)), scenes: timeline.map((s) => s.id) }));
  process.exit(0);
}
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
console.log(JSON.stringify({ video: mp4.slice(root.length + 1), seconds: Number(at.toFixed(2)), narratedScenes: spoken.map((v) => v.s.id), probe: JSON.parse(probe), gifBytes, timeline: timeline.map(({ id, at: t, length }) => ({ id, at: Number(t.toFixed(2)), length: Number(length.toFixed(2)) })) }, null, 2));
