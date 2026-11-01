#!/usr/bin/env node
/**
 * The demo clip is not committed (it is someone else's film). This pulls it once.
 *
 *   Sintel trailer — © Blender Foundation | durian.blender.org — CC-BY 3.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'demo', 'source-sintel.mp4');
const URL_ = 'https://media.w3.org/2010/05/sintel/trailer.mp4';

fs.mkdirSync(path.dirname(DEST), { recursive: true });
if (fs.existsSync(DEST)) {
  console.log(`already here: ${DEST}`);
  process.exit(0);
}
console.log(`fetching ${URL_}`);
const res = await fetch(URL_);
if (!res.ok) throw new Error(`http ${res.status}`);
fs.writeFileSync(DEST, Buffer.from(await res.arrayBuffer()));
console.log(`saved ${DEST} (${(fs.statSync(DEST).size / 1e6).toFixed(1)} MB)`);
console.log('Sintel © Blender Foundation | durian.blender.org | CC-BY 3.0');
