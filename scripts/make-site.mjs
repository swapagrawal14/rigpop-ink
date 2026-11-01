#!/usr/bin/env node
/**
 * Builds the static showroom in public/ — the thing Vercel can actually serve.
 *
 * The live darkroom (web/server.mjs) needs a long-lived process, an ffmpeg binary
 * and native canvas, so it stays local. This script renders the assets a static
 * page can show: one still per preset, the source frame they came from, the
 * before/after loop and a side-by-side clip.
 *
 *   node scripts/make-site.mjs [atSecond]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stillFrame, cropFromBars, analyseSource } from '../src/restyle.mjs';
import { ffmpegPath } from '../src/ffmpeg.mjs';
import { PRESETS } from '../src/presets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIP = path.join(ROOT, 'demo', 'source-sintel.mp4');
const OUT = path.join(ROOT, 'public', 'assets');
const AT = Number(process.argv[2] || 26);
const WIDTH = 760;

if (!fs.existsSync(CLIP)) {
  console.error('no demo clip — run: npm run fetch:demo');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const ff = (...args) => {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${args[0]}`);
};

const a = await analyseSource(CLIP, { features: {} });
const crop = cropFromBars(a.bars, a.info.width, a.info.height);
const cropFilter = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${WIDTH}:-2:flags=lanczos`;

// 1. the source frame, cropped exactly like the renders
ff('-ss', String(AT), '-i', CLIP, '-frames:v', '1', '-vf', cropFilter, '-q:v', '3',
  path.join(OUT, 'source.jpg'));
console.log('  source.jpg');

// 2. one still per preset, same frame, same crop
for (const [key, preset] of Object.entries(PRESETS)) {
  const tmp = path.join(OUT, `.${key}.png`);
  const r = await stillFrame({ input: CLIP, at: AT, preset: key, scale: 1, seed: 7, crop });
  fs.writeFileSync(tmp, r.png);
  ff('-i', tmp, '-vf', `crop=${Math.min(r.width, crop.w)}:${Math.min(r.height, crop.h)}:0:0,scale=${WIDTH}:-2:flags=lanczos`,
    '-q:v', '3', path.join(OUT, `${key}.jpg`));
  fs.unlinkSync(tmp);
  console.log(`  ${key}.jpg  (${preset.label})`);
}

// 3. the before/after loop + the side-by-side clip, if they exist
const gif = path.join(ROOT, 'docs', 'demo.gif');
if (fs.existsSync(gif)) {
  fs.copyFileSync(gif, path.join(OUT, 'demo.gif'));
  console.log('  demo.gif');
}
const compare = path.join(ROOT, 'out', 'compare-v3.mp4');
if (fs.existsSync(compare)) {
  ff('-i', compare, '-vf', 'scale=900:-2:flags=lanczos', '-c:v', 'libx264', '-crf', '27',
    '-preset', 'slow', '-an', '-movflags', '+faststart', path.join(OUT, 'compare.mp4'));
  console.log('  compare.mp4');
}

console.log(`\nshowroom → public/  (${Object.keys(PRESETS).length} presets, frame @ ${AT}s)`);
