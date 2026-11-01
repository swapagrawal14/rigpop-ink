/**
 * rigpop-ink — the renderer.
 *
 * A frame goes through six stages, all hand-rolled (no ffmpeg filters, no GPU):
 *
 *   1. integrate   — 5 summed-area tables over the RGBA frame (O(1) window stats)
 *   2. kuwahara    — selective flattening into painted regions, not blurry soup
 *   3. cel         — quantise luminance into a small set of paint bands,
 *                    with a black point / white point so shadows can be lifted
 *   4. edge        — Sobel on the *flattened* luma (never the raw frame: raw
 *                    grain turns into confetti), gated out of deep shadow so
 *                    black areas stay solid ink instead of noise
 *   5. ink         — offset the edge mask by a per-frame "boil" vector and
 *                    stamp it in the ink colour over paper grain
 *   6. halftone    — 45° dot screen in the mid-shadow band, print-shop style
 *
 * Every buffer is allocated once; frames are rendered in place.
 */

const TILE = (() => {
  const t = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4) / 5.6;
      t[x + (y << 3)] = d < 0.6 ? 1 : 0;
    }
  }
  return t;
})();

export class InkShader {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const W = w + 1;
    const n = w * h;
    this.S = new Float64Array(W * (h + 1));
    this.S2 = new Float64Array(W * (h + 1));
    this.R = new Float64Array(W * (h + 1));
    this.G = new Float64Array(W * (h + 1));
    this.B = new Float64Array(W * (h + 1));
    this.luma = new Float32Array(n);
    this.edge = new Uint8Array(n);
    this.paper = new Float32Array(n);
    this.out = new Uint8ClampedArray(n * 4);
    this.paperSeed = 1;
    this.frameCount = 0;
  }

  /* ---------------------------------------------------------------- 1. stats */
  integrate(rgba) {
    const { w, h, S, S2, R, G, B, luma } = this;
    const W = w + 1;
    S.fill(0); S2.fill(0); R.fill(0); G.fill(0); B.fill(0);
    for (let y = 0; y < h; y++) {
      let rs = 0, gs = 0, bs = 0, ls = 0, l2 = 0;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        luma[row + x] = l;
        rs += r; gs += g; bs += b; ls += l; l2 += l * l;
        const p = (y + 1) * W + (x + 1);
        R[p] = R[p - W] + rs;
        G[p] = G[p - W] + gs;
        B[p] = B[p - W] + bs;
        S[p] = S[p - W] + ls;
        S2[p] = S2[p - W] + l2;
      }
    }
  }

  /* ------------------------------------------------------------- 2. kuwahara */
  kuwahara(r) {
    const { w, h, S, S2, R, G, B, out } = this;
    const W = w + 1;
    for (let y = 0; y < h; y++) {
      const y0 = y - r < 0 ? 0 : y - r;
      const y1 = y;
      const y2 = y + r > h - 1 ? h - 1 : y + r;
      for (let x = 0; x < w; x++) {
        const x0 = x - r < 0 ? 0 : x - r;
        const x1 = x;
        const x2 = x + r > w - 1 ? w - 1 : x + r;
        let best = Infinity, br = 0, bg = 0, bb = 0;
        for (let q = 0; q < 4; q++) {
          const ax = q & 1 ? x1 : x0, bx = q & 1 ? x2 : x1;
          const ay = q & 2 ? y1 : y0, by = q & 2 ? y2 : y1;
          const area = (bx - ax + 1) * (by - ay + 1);
          if (area <= 0 || bx - ax < 0 || by - ay < 0) continue;
          const i11 = (by + 1) * W + (bx + 1), i01 = ay * W + (bx + 1);
          const i10 = (by + 1) * W + ax, i00 = ay * W + ax;
          const s = S[i11] - S[i01] - S[i10] + S[i00];
          const s2 = S2[i11] - S2[i01] - S2[i10] + S2[i00];
          const v = s2 / area - (s / area) * (s / area);
          if (v < best) {
            best = v;
            br = (R[i11] - R[i01] - R[i10] + R[i00]) / area;
            bg = (G[i11] - G[i01] - G[i10] + G[i00]) / area;
            bb = (B[i11] - B[i01] - B[i10] + B[i00]) / area;
          }
        }
        const o = (y * w + x) * 4;
        out[o] = br; out[o + 1] = bg; out[o + 2] = bb; out[o + 3] = 255;
      }
    }
  }

  /** luma of the flattened frame — this is what edges are found on */
  reluma() {
    const { w, h, luma, out } = this;
    for (let p = 0, i = 0, n = w * h; p < n; p++, i += 4) {
      luma[p] = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
    }
  }

  /* ----------------------------------------------------------------- 3. cel */
  /** per-channel gamma, applied once per frame through a 256-entry LUT */
  tone(gamma) {
    const { out } = this;
    const lut = this.lut || (this.lut = new Uint8ClampedArray(256));
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, gamma);
    for (let i = 0, n = this.w * this.h * 4; i < n; i += 4) {
      out[i] = lut[out[i]]; out[i + 1] = lut[out[i + 1]]; out[i + 2] = lut[out[i + 2]];
    }
  }

  cel(levels, sat, black, white) {
    const { w, h, out } = this;
    const step = (white - black) / (levels - 1);
    const n = w * h * 4;
    for (let i = 0; i < n; i += 4) {
      const r = out[i], g = out[i + 1], b = out[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = 1 / step;
      const q = (v) => {
        const t = black + Math.round((l + (v - l) * sat - black) * k) * step;
        return t < 0 ? 0 : t > 255 ? 255 : t;
      };
      out[i] = q(r); out[i + 1] = q(g); out[i + 2] = q(b);
    }
  }

  /** 3×3 median on the cel output — removes speckle, keeps flat areas flat */
  median() {
    const { w, h, out } = this;
    const src = this.medBuf || (this.medBuf = new Uint8ClampedArray(w * h * 4));
    src.set(out);
    const R = new Array(9), G = new Array(9), B = new Array(9);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const i = ((y + dy) * w + (x + dx)) * 4;
            R[n] = src[i]; G[n] = src[i + 1]; B[n] = src[i + 2]; n++;
          }
        }
        R.sort(asc); G.sort(asc); B.sort(asc);
        const o = (y * w + x) * 4;
        out[o] = R[4]; out[o + 1] = G[4]; out[o + 2] = B[4];
      }
    }
  }

  /* ---------------------------------------------------------------- 4. edge */
  gradMag(x, y) {
    const { w, luma } = this;
    const p = y * w + x;
    const gx =
      -luma[p - w - 1] - 2 * luma[p - 1] - luma[p + w - 1] +
      luma[p - w + 1] + 2 * luma[p + 1] + luma[p + w + 1];
    const gy =
      -luma[p - w - 1] - 2 * luma[p - w] - luma[p - w + 1] +
      luma[p + w - 1] + 2 * luma[p + w] + luma[p + w + 1];
    return (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
  }

  edgeMask(lo, hi, darkGate, desp) {
    const { w, h, luma, edge } = this;
    let sum = 0, cnt = 0;
    for (let y = 1; y < h - 1; y += 3) {
      for (let x = 1; x < w - 1; x += 3) { sum += this.gradMag(x, y); cnt++; }
    }
    const t = (sum / cnt) * lo + hi;
    edge.fill(0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (luma[p] < darkGate) continue;
        const g = this.gradMag(x, y);
        if (g > t * this.strongMul) edge[p] = 2;
        else if (g > t) edge[p] = 1;
      }
    }
    if (desp) this.despeckle();
    return t;
  }

  /** drop lone pixels — a line is a run, not a speck */
  despeckle() {
    const { w, h, edge } = this;
    const cp = new Uint8Array(edge);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (cp[p] !== 1) continue;
        const n =
          cp[p - 1] + cp[p + 1] + cp[p - w] + cp[p + w] +
          cp[p - w - 1] + cp[p - w + 1] + cp[p + w - 1] + cp[p + w + 1];
        if (n < 2) edge[p] = 0;
      }
    }
  }

  /* --------------------------------------------------------------- 5. + 6. */
  paperGrain(amount, seed) {
    // xorshift: cheap, deterministic, and we only touch it once per frame
    let s = (seed * 2654435761) >>> 0 || 1;
    const { paper, w, h } = this;
    for (let i = 0, n = w * h; i < n; i++) {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      paper[i] = 1 - amount * (s / 4294967295);
    }
  }

  /** box-blur the binary edge mask into a smooth coverage field */
  coverage() {
    const { w, h, edge } = this;
    const cov = this.cov || (this.cov = new Float32Array(w * h));
    const tmp = this.covTmp || (this.covTmp = new Float32Array(w * h));
    for (let p = 0; p < w * h; p++) cov[p] = edge[p] === 2 ? 1.45 : edge[p] === 1 ? 1.0 : 0;
    // separable 3-tap blur, twice — cheap antialias + a little line thickness
    const passes = this.blurPasses === undefined ? 2 : this.blurPasses;
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const a = cov[row + (x > 0 ? x - 1 : x)];
          const b = cov[row + x];
          const c = cov[row + (x < w - 1 ? x + 1 : x)];
          tmp[row + x] = (a + b + b + c) * 0.25;
        }
      }
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          const a = tmp[(y > 0 ? y - 1 : y) * w + x];
          const b = tmp[y * w + x];
          const c = tmp[(y < h - 1 ? y + 1 : y) * w + x];
          cov[y * w + x] = (a + b + b + c) * 0.25;
        }
      }
    }
    return cov;
  }

  inkStamp({ boil, seed, thick, ink, tint, tintAmt }) {
    const { w, h, out, paper } = this;
    const cov = this.coverage();
    // boil: sub-pixel wobble of the line, so it trembles instead of jittering
    const ox = (noise2(0.5, 0.5, seed) - 0.5) * boil * 1.6;
    const oy = (noise2(11.5, 3.5, seed) - 0.5) * boil * 1.6;
    const k = (this.lineGain || 1.5) * (thick / 1.6 + 0.55);
    const ir = ink[0], ig = ink[1], ib = ink[2];
    const tr = tint[0], tg = tint[1], tb = tint[2];
    for (let y = 0; y < h; y++) {
      const fy = Math.min(h - 1.001, Math.max(0, y + oy));
      const y0 = fy | 0, vy = fy - y0;
      const r0 = y0 * w, r1 = Math.min(h - 1, y0 + 1) * w;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(w - 1.001, Math.max(0, x + ox));
        const x0 = fx | 0, vx = fx - x0;
        const x1 = Math.min(w - 1, x0 + 1);
        const v =
          (cov[r0 + x0] * (1 - vx) + cov[r0 + x1] * vx) * (1 - vy) +
          (cov[r1 + x0] * (1 - vx) + cov[r1 + x1] * vx) * vy;
        let a = v * k;
        a = a > 1 ? 1 : a;
        const o = (y * w + x) * 4;
        const g = paper[y * w + x];
        let r = out[o] * g, gg = out[o + 1] * g, b = out[o + 2] * g;
        if (tintAmt > 0) {
          const l = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
          const kk = tintAmt * (1 - l * 0.85);
          r += (tr - r) * kk; gg += (tg - gg) * kk; b += (tb - b) * kk;
        }
        if (a > 0) {
          r += (ir - r) * a; gg += (ig - gg) * a; b += (ib - b) * a;
        }
        out[o] = r; out[o + 1] = gg; out[o + 2] = b;
      }
    }
  }

  halftone(strength, darkBelow) {
    const { w, h, out } = this;
    if (strength <= 0) return;
    const step = Math.max(1, Math.round(Math.min(w, h) / 400));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const l = 0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2];
        if (l > darkBelow || l < darkBelow * 0.30) continue;
        const u = Math.floor((x + y) / step) & 7;
        const v = Math.floor((x - y + 4096) / step) & 7;
        const t = TILE[u + (v << 3)];
        if (!t) continue;
        const k = 1 - strength * (1 - l / darkBelow);
        out[o] *= k; out[o + 1] *= k; out[o + 2] *= k;
      }
    }
  }

  /** luminance percentiles from the flattened frame (256-bin histogram) */
  percentiles(lo = 0.02, hi = 0.98) {
    const { luma } = this;
    const hist = this.hist || (this.hist = new Float64Array(256));
    hist.fill(0);
    for (let i = 0, n = this.w * this.h; i < n; i++) {
      let v = luma[i] | 0;
      hist[v < 0 ? 0 : v > 255 ? 255 : v]++;
    }
    const total = this.w * this.h;
    const at = (q) => {
      let acc = 0;
      const target = total * q;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
      return 255;
    };
    return [at(lo), at(hi)];
  }

  /* ------------------------------------------------------------------ public */
  render(rgba, style) {
    const s = { ...DEFAULTS, ...style };
    this.integrate(rgba);
    // radius is expressed in "480-line units" — integral images make a wider
    // brush free, so scale it with the frame instead of making people tune it
    const rk = Math.min(this.w, this.h) / 240;
    this.kuwahara(Math.max(2, Math.round(s.radius * rk)));
    this.reluma();

    // auto levels: put the frame's real range on the paint ramp, so the same
    // preset works on a daylit plate and a night cave without touching a dial
    let black = s.black, white = s.white;
    if (s.auto > 0) {
      const [p1, p99] = this.percentiles(0.02, 0.985);
      const ab = Math.max(0, p1 * 0.8);
      const aw = Math.max(64, Math.min(252, p99 * 1.05 + 4));
      black = s.black + (ab - s.black) * s.auto;
      white = s.white + (aw - s.white) * s.auto;
      if (white - black < 40) white = black + 40;
    }
    this.autoRange = [black, white];

    // shadow lift: a night interior has its detail in the bottom third; open it
    // up before the paint bands are cut, or the whole shot turns to mud
    if (s.lift > 0) {
      const med = this.percentiles(0.5, 0.5)[0];
      const gamma = 1 - s.lift * (1 - Math.min(1, med / 120));
      if (gamma < 0.985) this.tone(gamma);
    }
    this.cel(s.levels, s.sat, black, white);
    if (s.median) this.median();
    if (s.edgeOn === 'cel') this.reluma();   // contours land on paint-band edges
    const jt = 1 + (noise2(3.3, 7.7, s.seed) - 0.5) * s.jitter;
    const gate = s.darkGate * (1 - s.auto) + (black + (white - black) * 0.14) * s.auto;
    this.strongMul = s.strong;
    this.lineGain = s.lineGain;
    this.blurPasses = s.blurPasses;
    const thr = this.edgeMask(s.edgeLo, s.edgeHi * jt, gate, s.despeckle);
    this.paperGrain(s.paperAmt, (s.paperSeed ?? s.seed) + 7);
    this.inkStamp({
      boil: s.boil + s.jitter * 2,
      seed: s.seed,
      thick: s.thick,
      ink: s.ink,
      tint: s.tint,
      tintAmt: s.tintAmt,
    });
    this.halftone(s.half, s.halfDark);
    this.frameCount++;
    this.lastThreshold = thr;
    return this.out;
  }
}

export const DEFAULTS = {
  radius: 3,
  levels: 10,
  sat: 1.15,
  black: 12,
  white: 244,
  edgeLo: 1.0,
  edgeHi: 16,
  darkGate: 34,
  thick: 1,
  boil: 1,
  jitter: 0.35,
  seed: 1,
  ink: [22, 17, 15],
  tint: [244, 236, 214],
  tintAmt: 0.18,
  paperAmt: 0.07,
  half: 0.35,
  halfDark: 118,
  despeckle: true,
  auto: 1,
  edgeOn: 'cel',
  median: true,
  lift: 0.55,
  lineGain: 1.25,
  blurPasses: 1,
  strong: 2.1,
};

const asc = (a, b) => a - b;

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
