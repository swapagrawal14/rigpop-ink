/**
 * The director. This is the part that makes it not-a-filter.
 *
 * For every frame it decides:
 *
 *   shot     — how many cuts have happened, so the drawing can change ink key
 *              exactly when the picture cuts
 *   beat     — how long since the last audio onset: line thickness punches on
 *              the hit and settles back within ~150 ms, and the boil seed
 *              restarts, so the *wobble* is played, not looped
 *   drama    — normalised frame-to-frame motion: busy frames get heavy contour
 *              and tight dot screens, still frames get hairlines
 *
 * All of it is a pure function of (analyses, preset, seed, frame), so a render
 * is reproducible and a scrub in the browser shows exactly what the file will
 * show.
 */
import { noise2 } from './ink.mjs';

export function makeDirector({ preset, seed = 1, fps = 24, onsets = [], cuts = [], drama = [], features = {} }) {
  const useBeat = features.beat !== false;
  const useCuts = features.cuts !== false;
  const useDrama = features.drama !== false;

  const base = preset.style;
  const keys = preset.keys && preset.keys.length ? preset.keys : [{ ink: base.ink, tint: base.tint }];

  const onsetFrames = onsets.map((t) => t * fps).sort((a, b) => a - b);
  const cutFrames = [...cuts].sort((a, b) => a - b);

  const countLE = (arr, v) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  };

  return function styleForFrame(f) {
    const shot = useCuts ? countLE(cutFrames, f) : 0;

    // --- ink key: one per shot, seeded so the same seed gives the same film
    const key = keys[(shot * 7 + seed) % keys.length];

    // --- beat
    let beatAge = Infinity;      // seconds since the last onset
    if (useBeat && onsetFrames.length) {
      const idx = countLE(onsetFrames, f);
      if (idx > 0) beatAge = (f - onsetFrames[idx - 1]) / fps;
    }
    const pulse = useBeat && beatAge < 0.16 ? 1 - beatAge / 0.16 : 0;
    const onsetsSoFar = useBeat ? countLE(onsetFrames, f) : 0;

    // --- drama
    const d = useDrama ? (drama[f] === undefined ? 0.3 : drama[f]) : 0.3;

    // --- boil seed: changes on every onset (and every cut), plus a slow drift
    // so a held shot still breathes at roughly 3 trembles a second
    const drift = Math.floor(f / 8);
    const boilSeed = (seed * 977 + shot * 131 + onsetsSoFar * 61 + (useBeat ? 0 : drift)) | 0;
    const boil = base.boil + pulse * 0.35;

    return {
      shot,
      pulse,
      drama: d,
      seed: boilSeed,
      minLine: base.minLine,
      hold: base.hold,
      lineGain: base.lineGain,
      // paper is a fixed sheet per shot: keeps grain from crawling and lets the
      // encoder win (a per-frame grain field costs ~3x the bitrate)
      paperSeed: seed * 31 + shot * 17,
      ink: key.ink,
      tint: key.tint,
      ramp: key.ramp,
      accents: key.accents,
      radius: base.radius,
      levels: base.levels,
      sat: base.sat,
      black: base.black,
      white: base.white,
      edgeLo: base.edgeLo,
      edgeHi: base.edgeHi * (1.2 - 0.4 * d) * (1 - 0.08 * pulse),
      darkGate: base.darkGate,
      thick: d > 0.62 || pulse > 0.6 ? base.thick * 1.45 : base.thick,
      boil,
      jitter: base.jitter,
      tintAmt: base.tintAmt,
      paperAmt: base.paperAmt,
      half: base.half * (0.72 + 0.55 * d),
      halfDark: base.halfDark,
      despeckle: base.despeckle !== false,
      // a hint of hand-held camera wobble, in pixels, tied to the beat
      shake: features.shake === false ? 0 : 1.2 + pulse * 2.2,
      shakeX: (noise2(f * 0.13, 0.5, 91) - 0.5) * 2,
      shakeY: (noise2(0.5, f * 0.11, 37) - 0.5) * 2,
    };
  };
}
