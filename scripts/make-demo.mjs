#!/usr/bin/env node
/**
 * Builds the README artefacts from a finished render:
 *   docs/demo.gif      three before/after splits, source on the left, ink on the right
 *   docs/poster.jpg    a single inked frame for the repo card
 *
 *   node scripts/make-demo.mjs out/ink-sintel.mp4
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from '../src/ffmpeg.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inked = process.argv[2] || path.join(ROOT, 'out', 'ink-sintel.mp4');
const source = process.argv[3] || path.join(ROOT, 'demo', 'source-sintel.mp4');
const docs = path.join(ROOT, 'docs');
fs.mkdirSync(docs, { recursive: true });

const ff = (...args) => {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
};

// the same three beats the render is built around: a cut, the busiest action, a held shot
const SEGMENTS = [
  [26.2, 1.1],
  [33.8, 1.1],
  [38.4, 1.1],
];

const TILE_H = 240;
const tiles = [];
SEGMENTS.forEach(([t, d], i) => {
  const out = path.join(docs, `.seg${i}.gif`);
  ff(
    '-ss', String(t), '-t', String(d), '-i', source,
    '-ss', String(t), '-t', String(d), '-i', inked,
    '-filter_complex',
    `[0:v]fps=12,crop=iw:ih*0.78:0:ih*0.11,scale=-2:${TILE_H},setsar=1[a];` +
    `[1:v]fps=12,crop=iw:ih*0.78:0:ih*0.11,scale=-2:${TILE_H},setsar=1[b];` +
    '[a][b]hstack=inputs=2,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];' +
    '[s1][p]paletteuse=dither=none',
    out,
  );
  tiles.push(out);
});

// concat the three segments into one loop
const list = path.join(docs, '.list.txt');
fs.writeFileSync(list, tiles.map((t) => `file '${t}'`).join('\n'));
ff('-f', 'concat', '-safe', '0', '-i', list, '-loop', '0', path.join(docs, 'demo.gif'));
for (const f of [...tiles, list]) fs.unlinkSync(f);

ff('-ss', '26.2', '-i', inked, '-frames:v', '1', '-q:v', '3', path.join(docs, 'poster.jpg'));

const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0);
console.log(`docs/demo.gif    ${kb(path.join(docs, 'demo.gif'))} KB`);
console.log(`docs/poster.jpg  ${kb(path.join(docs, 'poster.jpg'))} KB`);
