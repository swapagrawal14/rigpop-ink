/**
 * Two cheap analyses that the director actually uses:
 *
 *   audio  → onset times (when a hit lands), from an RMS flux curve
 *   video  → per-frame motion energy + hard cut list, from 64×36 luma diffs
 *
 * Neither tries to be "smart". They produce numbers the director can act on
 * and a human can sanity-check in `probe` output.
 */
import { spawn } from 'node:child_process';
import { ffmpegPath, RawReader } from './ffmpeg.mjs';

const ANALYSIS_W = 64;
const ANALYSIS_H = 36;

export async function audioOnsets(file, fps) {
  const ar = 8000;
  const chunks = [];
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(ar), '-f', 'f32le', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || `audio decode ${c}`))));
  });
  const buf = Buffer.concat(chunks);
  const n = Math.floor(buf.length / 4);
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, n);

  const hop = Math.round(ar * 0.032);            // 32 ms
  const env = new Float32Array(Math.floor(n / hop));
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let k = 0; k < hop; k++) { const v = pcm[i * hop + k] || 0; s += v * v; }
    env[i] = Math.sqrt(s / hop);
  }

  // spectral-flux-ish: positive energy change, then an adaptive gate
  const flux = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);

  const W = 16;                                   // ~0.5 s local window
  const sortedFlux = Array.from(flux).sort((a, b) => a - b);
  const p90 = sortedFlux[Math.floor(sortedFlux.length * 0.90)] || 0;
  const floor = Math.max(p90 * 0.45, 0.0012);
  const onsets = [];
  let lastHop = -1e9;
  for (let i = 1; i < flux.length - 1; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(flux.length, i + W + 1);
    const win = Array.from(flux.slice(lo, hi)).sort((a, b) => a - b);
    const med = win[win.length >> 1];
    const localPeak = flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] >= flux[i - 2];
    const gate = Math.max(med * 2.6, floor);
    if (localPeak && flux[i] > gate && i - lastHop > 3) {   // ≥100 ms apart
      onsets.push(i * hop / ar);
      lastHop = i;
    }
  }
  return { onsets, envelope: env, hopSeconds: hop / ar };
}

export async function motionMap(file, { width, height, fps, start = 0, dur = 0 }) {
  const reader = new RawReader(file, {
    width: ANALYSIS_W, height: ANALYSIS_H, fps, start, dur, extra: [],
  });
  const prev = new Float32Array(ANALYSIS_W * ANALYSIS_H);
  const cur = new Float32Array(ANALYSIS_W * ANALYSIS_H);
  const rowMean = new Float64Array(ANALYSIS_H);
  const colMean = new Float64Array(ANALYSIS_W);
  let sampled = 0;
  const diffs = [];
  let frame = 0;
  for (;;) {
    const px = await reader.next();
    if (!px) break;
    for (let i = 0, p = 0; p < cur.length; p++, i += 4) {
      cur[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    if (frame > 0) {
      let s = 0;
      for (let p = 0; p < cur.length; p++) s += Math.abs(cur[p] - prev[p]);
      diffs.push(s / cur.length / 255);
    } else {
      diffs.push(0);
    }
    // accumulate row/column brightness for letterbox detection
    for (let y = 0; y < ANALYSIS_H; y++) {
      let rs = 0;
      for (let x = 0; x < ANALYSIS_W; x++) rs += cur[y * ANALYSIS_W + x];
      rowMean[y] += rs / ANALYSIS_W;
    }
    for (let x = 0; x < ANALYSIS_W; x++) {
      let cs = 0;
      for (let y = 0; y < ANALYSIS_H; y++) cs += cur[y * ANALYSIS_W + x];
      colMean[x] += cs / ANALYSIS_H;
    }
    sampled++;
    prev.set(cur);
    frame++;
  }
  reader.kill();

  const sorted = Array.from(diffs).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1] || 0.001;
  const hi = sorted[Math.floor(sorted.length * 0.95)] || med * 3;

  const cuts = [];
  let lastCut = -1e9;
  for (let i = 3; i < diffs.length - 3; i++) {
    const d = diffs[i];
    const isLocalMax =
      d >= diffs[i - 1] && d >= diffs[i + 1] && d >= diffs[i - 2] &&
      d >= diffs[i + 2] && d >= diffs[i - 3] && d >= diffs[i + 3];
    if (isLocalMax && d > Math.max(med * 3.2, hi * 0.9) && i - lastCut > Math.round(fps * 0.5)) {
      cuts.push(i);
      lastCut = i;
    }
  }

  // normalised drama curve, lightly smoothed so line weight doesn't flicker
  const norm = diffs.map((d) => Math.min(1, d / (hi || 1)));
  const smooth = norm.map((v, i) => {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= norm.length) continue;
      s += norm[j]; c++;
    }
    return s / c;
  });

  // letterbox: contiguous near-black rows/columns hugging the frame edge
  const rm = Array.from(rowMean, (v) => v / Math.max(1, sampled));
  const cm = Array.from(colMean, (v) => v / Math.max(1, sampled));
  const edgeRun = (arr, fromStart) => {
    const n = arr.length;
    let i = 0;
    const order = fromStart ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    for (const k of order) {
      if (arr[k] > 9) break;
      i++;
    }
    return i / n;
  };
  const bars = {
    top: edgeRun(rm, true),
    bottom: edgeRun(rm, false),
    left: edgeRun(cm, true),
    right: edgeRun(cm, false),
  };

  return { frames: diffs.length, cuts, drama: smooth, motion: diffs, baseDiff: med, bars };
}
