#!/usr/bin/env node
/**
 * Smoke test — no test framework, just the invariants that actually matter:
 *
 *   1. probe reads a clip
 *   2. a still renders, is the right size, and is not a blank frame
 *   3. the same seed renders the same bytes (determinism contract, SPEC §6)
 *   4. a different seed renders different bytes (the seed is wired up)
 *   5. every preset renders without throwing
 *
 *   npm test            (skips if demo/source-sintel.mp4 is missing)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseSource, stillFrame } from '../src/restyle.mjs';
import { PRESETS } from '../src/presets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIP = path.join(ROOT, 'demo', 'source-sintel.mp4');

const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
let n = 0;
const ok = (name) => { n++; console.log(`  ok  ${name}`); };

if (!fs.existsSync(CLIP)) {
  console.log('  --  no demo clip (npm run fetch:demo), nothing to test');
  process.exit(0);
}

const analysis = await analyseSource(CLIP, { features: {} });
assert.ok(analysis.info.duration > 1, 'duration');
assert.ok(analysis.frames > 10, 'frame count');
ok(`probe: ${analysis.info.width}x${analysis.info.height} ${analysis.info.duration.toFixed(1)}s, ` +
   `${analysis.cuts.length} cuts, ${analysis.onsets.length} onsets`);

const base = { input: CLIP, at: 26, preset: 'manga-noir', scale: 0.5 };
const a = await stillFrame({ ...base, seed: 7 });
assert.ok(a.png.length > 4000, 'still is not empty');
assert.equal(a.width % 2, 0);
ok(`still: ${a.width}x${a.height}, ${(a.png.length / 1024).toFixed(0)} KB`);

const b = await stillFrame({ ...base, seed: 7 });
assert.equal(hash(a.png), hash(b.png));
ok(`determinism: same seed → ${hash(a.png)}`);

const c = await stillFrame({ ...base, seed: 8 });
assert.notEqual(hash(a.png), hash(c.png));
ok(`seed is wired: seed 8 → ${hash(c.png)}`);

for (const name of Object.keys(PRESETS)) {
  const r = await stillFrame({ ...base, preset: name, scale: 0.25 });
  assert.ok(r.png.length > 1000, `${name} rendered`);
}
ok(`presets: ${Object.keys(PRESETS).join(', ')}`);

console.log(`\n  ${n} checks passed`);
