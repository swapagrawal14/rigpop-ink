/**
 * Orchestrator: source file in, inked file out.
 * Only src/restyle.mjs and the web server call this; everything below it is pure.
 */
import fs from 'node:fs';
import { InkShader } from './ink.mjs';
import { probe, RawReader, RawWriter } from './ffmpeg.mjs';
import { audioOnsets, motionMap } from './analyze.mjs';
import { makeDirector } from './director.mjs';
import { getPreset } from './presets.mjs';

export async function analyseSource(file, { start = 0, dur = 0, fps, features = {} } = {}) {
  const info = await probe(file);
  const vfps = fps || info.fps;
  const needAudio = features.beat !== false && info.audio;
  const [audio, motion] = await Promise.all([
    needAudio ? audioOnsets(file, vfps).catch(() => ({ onsets: [] })) : Promise.resolve({ onsets: [] }),
    features.cuts === false && features.drama === false
      ? Promise.resolve({ cuts: [], drama: [], frames: 0 })
      : motionMap(file, { width: info.width, height: info.height, fps: vfps, start, dur }),
  ]);
  // windows: audio is analysed over the whole file, pictures over the window —
  // shift onsets onto window-relative time so both line up with frame 0
  const shift = start * vfps;
  const onsets = (audio.onsets || []).map((t) => t * vfps - shift).filter((f) => f >= 0).map((f) => f / vfps);

  return {
    info,
    fps: vfps,
    onsets,
    cuts: motion.cuts || [],
    drama: motion.drama || [],
    bars: motion.bars || { top: 0, bottom: 0, left: 0, right: 0 },
    frames: Math.round((dur > 0 ? dur : info.duration) * vfps),
  };
}

/** letterbox fractions → even pixel crop inside the source frame */
export function cropFromBars(bars, width, height) {
  if (!bars) return { x: 0, y: 0, w: width, h: height };
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const x = even(bars.left * width);
  const y = even(bars.top * height);
  const w = even(width - x - bars.right * width);
  const h = even(height - y - bars.bottom * height);
  // only crop when it buys something — never more than 40% of the frame
  if (bars.top + bars.bottom > 0.4 || bars.left + bars.right > 0.4) return { x: 0, y: 0, w: width, h: height };
  return { x, y, w, h };
}

function filterFor(crop, outW, outH) {
  const parts = [];
  if (crop && (crop.x || crop.y || crop.w < 1e9)) parts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  parts.push(`scale=${outW}:${outH}:flags=bicubic`);
  return parts.join(',');
}

export async function restyle({
  input, output, preset = 'manga-noir', start = 0, dur = 0, scale = 1,
  fps, seed = 1, crf = 18, features = {}, onProgress = () => {},
}) {
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
  const p = getPreset(preset);
  const analysis = await analyseSource(input, { start, dur, fps, features });
  const { info } = analysis;
  const vfps = analysis.fps;

  const crop = features.crop === false ? null : cropFromBars(analysis.bars, info.width, info.height);
  const srcW = crop ? crop.w : info.width;
  const srcH = crop ? crop.h : info.height;
  const width = Math.round((srcW * scale) / 2) * 2;
  const height = Math.round((srcH * scale) / 2) * 2;

  const director = makeDirector({
    preset: p, seed, fps: vfps,
    onsets: analysis.onsets, cuts: analysis.cuts, drama: analysis.drama, features,
  });

  const reader = new RawReader(input, { width, height, fps: vfps, start, dur, vf: filterFor(crop, width, height) });
  const writer = new RawWriter(output, {
    width, height, fps: vfps, srcFile: input, hasAudio: info.audio, crf, start, dur,
  });
  const shader = new InkShader(width, height);
  const total = analysis.frames || Infinity;

  let f = 0;
  const t0 = Date.now();
  for (;;) {
    const px = await reader.next();
    if (!px) break;
    const style = director(f);
    const out = shader.render(px, style);
    // hand-held wobble: shift the finished frame, edge pixels clamped
    if (style.shake > 0.05) wobble(out, width, height, style.shakeX * style.shake, style.shakeY * style.shake);
    await writer.write(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    f++;
    if (f % 12 === 0) {
      const el = (Date.now() - t0) / 1000;
      onProgress({ frame: f, total, fps: f / el, eta: Math.max(0, ((total - f) / (f / el))) });
    }
  }
  reader.kill();
  await writer.close();

  return {
    output, frames: f, width, height, fps: vfps, crop,
    preset, seed,
    shots: analysis.cuts.length + 1,
    onsets: analysis.onsets.length,
    seconds: f / vfps,
    meanDrama: analysis.drama.length
      ? analysis.drama.reduce((a, b) => a + b, 0) / analysis.drama.length
      : 0,
    elapsed: (Date.now() - t0) / 1000,
  };
}

/** sub-pixel-ish frame shift with clamped edges (the "paper moves" feel) */
function wobble(buf, w, h, dx, dy) {
  const ox = Math.round(dx), oy = Math.round(dy);
  if (!ox && !oy) return;
  const src = Buffer.from(buf);
  for (let y = 0; y < h; y++) {
    const sy = y - oy < 0 ? 0 : y - oy > h - 1 ? h - 1 : y - oy;
    const srow = sy * w * 4, drow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const sx = x - ox < 0 ? 0 : x - ox > w - 1 ? w - 1 : x - ox;
      const s = srow + sx * 4, d = drow + x * 4;
      buf[d] = src[s]; buf[d + 1] = src[s + 1]; buf[d + 2] = src[s + 2]; buf[d + 3] = 255;
    }
  }
}

/**
 * single frame → PNG. The darkroom calls this on every slider move, so it
 * accepts the whole timeline context and returns the frame the film would
 * actually have at that moment (same shot key, same beat punch).
 */
export async function stillFrame({
  input, at = 0, preset = 'manga-noir', scale = 1, seed = 1, fps,
  overrides = {}, features = {}, crop = null,
  frameIndex = null, onsets = [], cuts = [], drama = [],
}) {
  const { createCanvas, ImageData } = await import('/home/user/rigpop-agents/node_modules/@napi-rs/canvas/index.js');
  const p = getPreset(preset);
  const info = await probe(input);
  const vfps = fps || info.fps;
  const c = crop || { x: 0, y: 0, w: info.width, h: info.height };
  const width = Math.round((c.w * scale) / 2) * 2;
  const height = Math.round((c.h * scale) / 2) * 2;

  const reader = new RawReader(input, {
    width, height, fps: vfps, start: at, dur: 1 / vfps,
    vf: filterFor(c, width, height),
  });
  const px = await reader.next();
  reader.kill();
  if (!px) throw new Error(`no frame at ${at}s`);

  const director = makeDirector({ preset: p, seed, fps: vfps, onsets, cuts: cuts.map((t) => t * vfps), drama, features });
  const f = frameIndex === null ? 0 : frameIndex;
  const style = { ...director(f), ...overrides };
  const shader = new InkShader(width, height);
  const out = shader.render(px, style);
  if (style.shake) wobble(out, width, height, style.shakeX * style.shake, style.shakeY * style.shake);

  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out), width, height), 0, 0);
  return { png: canvas.toBuffer('image/png'), width, height, shot: style.shot, pulse: style.pulse };
}
