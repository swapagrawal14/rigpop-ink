#!/usr/bin/env node
/**
 * rigpop-ink — footage that redraws itself.
 *
 *   rigpop-ink probe  <file>
 *   rigpop-ink still  <file> -o out.png --at 12.4 --preset pulp-horror
 *   rigpop-ink restyle <file> -o out.mp4 --preset manga-noir --scale 1
 *   rigpop-ink presets
 *   rigpop-ink serve  --port 8137
 */
import fs from 'node:fs';
import path from 'node:path';
import { restyle, stillFrame, analyseSource, makeCompare } from '../src/restyle.mjs';
import { PRESETS } from '../src/presets.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-') && a.length > 1) {
    const k = a.replace(/^--?/, '');
    if (k === 'o') { flags.o = argv[++i]; continue; }
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    flags[k] = v;
  } else positional.push(a);
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const featuresFrom = (f) => ({
  beat: f['no-beat'] ? false : true,
  cuts: f['no-cuts'] ? false : true,
  drama: f['no-drama'] ? false : true,
  shake: f['no-shake'] ? false : true,
});

const bar = (p) => {
  const w = 28;
  const k = Math.min(1, p.frame / (p.total || p.frame * 2));
  const fill = Math.round(w * k);
  return `${'█'.repeat(fill)}${'░'.repeat(w - fill)} ${String(p.frame).padStart(5)}  ` +
    `${p.fps.toFixed(1)} f/s  eta ${Math.ceil(p.eta)}s`;
};

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(fs.readFileSync(new URL('./usage.txt', import.meta.url), 'utf8'));
    return;
  }

  if (cmd === 'presets') {
    for (const [k, v] of Object.entries(PRESETS)) {
      console.log(`${k.padEnd(14)} ${v.label.padEnd(16)} ${v.blurb}` +
        `\n${''.padEnd(14)} keys: ${v.keys.length}`);
    }
    return;
  }

  if (cmd === 'probe') {
    const file = positional[0];
    if (!file) throw new Error('usage: rigpop-ink probe <file>');
    const a = await analyseSource(file, { features: {} });
    console.log(`file      ${a.info.file}`);
    console.log(`video     ${a.info.width}x${a.info.height} @ ${a.info.fps} fps  ${a.info.duration.toFixed(2)}s  ${a.info.vcodec}`);
    console.log(`audio     ${a.info.audio ? 'yes' : 'no'}`);
    console.log(`frames    ${a.frames}`);
    console.log(`cuts      ${a.cuts.length}  at ${a.cuts.slice(0, 12).map((f) => (f / a.fps).toFixed(2)).join(', ')}${a.cuts.length > 12 ? '…' : ''}`);
    console.log(`onsets    ${a.onsets.length}  first ${a.onsets.slice(0, 10).map((t) => t.toFixed(2)).join(', ')}…`);
    if (a.onsets.length > 1) {
      const gaps = a.onsets.slice(1).map((t, i) => t - a.onsets[i]).sort((x, y) => x - y);
      console.log(`tempo     ~${(60 / gaps[gaps.length >> 1]).toFixed(1)} bpm (median gap ${gaps[gaps.length >> 1].toFixed(2)}s)`);
    }
    if (a.drama.length) {
      const mean = a.drama.reduce((x, y) => x + y, 0) / a.drama.length;
      const peak = Math.max(...a.drama);
      console.log(`drama     mean ${mean.toFixed(2)} peak ${peak.toFixed(2)}`);
    }
    return;
  }

  if (cmd === 'still') {
    const file = positional[0];
    const out = flags.o || flags.out;
    if (!file || !out) throw new Error('usage: rigpop-ink still <file> -o out.png --at 12.4');
    const r = await stillFrame({
      input: file,
      at: num(flags.at, 0),
      preset: flags.preset || 'manga-noir',
      scale: num(flags.scale, 1),
      seed: num(flags.seed, 1),
      features: featuresFrom(flags),
    });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, r.png);
    console.log(`${out}  ${r.width}x${r.height}`);
    return;
  }

  if (cmd === 'restyle') {
    const file = positional[0];
    const out = flags.o || flags.out;
    if (!file || !out) throw new Error('usage: rigpop-ink restyle <file> -o out.mp4');
    const compare = flags.compare === true || flags.compare === '1';
    const inkedPath = compare ? out.replace(/\.mp4$/i, '') + '.ink.mp4' : out;
    const r = await restyle({
      input: file,
      output: inkedPath,
      preset: flags.preset || 'manga-noir',
      start: num(flags.start, 0),
      dur: num(flags.dur, 0),
      scale: num(flags.scale, 1),
      seed: num(flags.seed, 1),
      crf: num(flags.crf, 18),
      fps: flags.fps ? num(flags.fps, 0) : undefined,
      features: featuresFrom(flags),
      onProgress: (p) => { if (!flags.quiet) process.stdout.write(`\r${bar(p)}`); },
    });
    if (compare) {
      makeCompare({ source: file, inked: inkedPath, output: out, start: num(flags.start, 0), dur: num(flags.dur, 0), crop: r.crop && r.crop.w < 1e9 ? r.crop : null, fps: r.fps });
      console.log(`\n${out}  (source | ink — ink-only copy at ${inkedPath})`);
    }
    if (!flags.quiet) process.stdout.write('\r');
    if (!compare) console.log(`\n${r.output}`);
    console.log(`  ${r.width}x${r.height} @ ${r.fps} fps  ${r.seconds.toFixed(2)}s  ${r.frames} frames`);
    console.log(`  ${r.shots} shots · ${r.onsets} onsets · drama ${r.meanDrama.toFixed(2)} · preset ${r.preset} · seed ${r.seed}`);
    console.log(`  rendered in ${r.elapsed.toFixed(1)}s (${(r.frames / r.elapsed).toFixed(1)} f/s)`);
    return;
  }

  if (cmd === 'serve') {
    const { startServer } = await import('../web/server.mjs');
    const port = num(flags.port, 8137);
    const files = flags.file ? String(flags.file).split(',') : [];
    await startServer({ port, files });
    return;
  }

  throw new Error(`unknown command "${cmd}"`);
}

main().catch((e) => {
  console.error(`\nrigpop-ink: ${e.message}`);
  process.exit(1);
});
