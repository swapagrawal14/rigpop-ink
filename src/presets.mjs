/**
 * Named looks. Each preset is a base style plus a "key family": the set of
 * inks/paper tones the director may jump between when the film cuts, so a
 * single render can change colour key per shot without the operator doing
 * anything.
 */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...hs) => hs.map(hex);

export const PRESETS = {
  'manga-noir': {
    label: 'Manga noir',
    blurb: 'Bilevel shadows, thick contour, hard dot screen.',
    style: {
      radius: 6, levels: 8, sat: 0.7, black: 6, white: 250,
      edgeLo: 1.0, edgeHi: 17, darkGate: 52, thick: 1, boil: 0.5, jitter: 0.3,
      ink: [16, 15, 20], tint: [236, 234, 226], tintAmt: 0.10,
      half: 0.1, halfDark: 112, paperAmt: 0.07,
      minLine: 26, hold: 0.5, lineGain: 1.3, chromaCarry: 0.5, minRegion: 70, hatch: null,
    },
    keys: [
      { ink: hex('#0e0d12'), tint: hex('#ece9e2'), ramp: ramp('#0e0d12', '#2b2836', '#5a5566', '#a9a4ad', '#ece9e2') },
      { ink: hex('#0b1020'), tint: hex('#e6ecf2'), ramp: ramp('#0b1020', '#23304a', '#4d6180', '#9fb0c4', '#e6ecf2') },
      { ink: hex('#14100c'), tint: hex('#f0e8d8'), ramp: ramp('#14100c', '#33291f', '#6b5a48', '#b8a68d', '#f0e8d8') },
    ],
  },

  ghazal: {
    label: 'Ghazal',
    blurb: 'Warm sepia wash, hairline contour, soft grain — for slow songs.',
    style: {
      radius: 7, levels: 9, sat: 1.0, black: 18, white: 246,
      edgeLo: 1.15, edgeHi: 22, darkGate: 26, thick: 1, boil: 0.45, jitter: 0.2,
      ink: [58, 38, 28], tint: [246, 232, 204], tintAmt: 0.34,
      half: 0.08, halfDark: 96, paperAmt: 0.08,
      minLine: 24, hold: 0.55, chromaCarry: 0.55, minRegion: 60, hatch: null,
    },
    keys: [
      { ink: hex('#2a1a12'), tint: hex('#f7ecd6'), ramp: ramp('#2a1a12', '#5c3a24', '#9c6b40', '#d6a873', '#f7ecd6') },
      { ink: hex('#241c1a'), tint: hex('#f4e7d8'), ramp: ramp('#241c1a', '#4f3a33', '#8b6b5c', '#c9a489', '#f4e7d8') },
      { ink: hex('#2e151a'), tint: hex('#fbeadd'), ramp: ramp('#2e151a', '#6b2f33', '#a75a55', '#d9998a', '#fbeadd') },
    ],
  },

  'pulp-horror': {
    label: 'Pulp horror',
    blurb: 'Acid spot inks, crushed contrast, screen-print dots.',
    style: {
      radius: 5, levels: 7, sat: 1.5, black: 8, white: 252,
      edgeLo: 1.0, edgeHi: 15, darkGate: 60, thick: 1.1, boil: 0.7, jitter: 0.35,
      ink: [24, 6, 14], tint: [214, 240, 190], tintAmt: 0.22,
      half: 0.14, halfDark: 130, paperAmt: 0.06,
      minLine: 24, hold: 0.45, chromaCarry: 0.45, minRegion: 80, hatch: null,
    },
    keys: [
      { ink: hex('#140a12'), tint: hex('#f2dfae'), ramp: ramp('#140a12', '#3b0f2e', '#7a1f3f', '#d1533f', '#f2dfae') },
      { ink: hex('#080c1c'), tint: hex('#eef2e2'), ramp: ramp('#080c1c', '#16224a', '#2f5a86', '#86b4c9', '#eef2e2') },
      { ink: hex('#17060f'), tint: hex('#f6d9c8'), ramp: ramp('#17060f', '#3a0b28', '#6d1745', '#c23c6a', '#f6d9c8') },
      { ink: hex('#120e04'), tint: hex('#f5ecc8'), ramp: ramp('#120e04', '#3a2a08', '#7d5a11', '#c99a2c', '#f5ecc8') },
    ],
  },

  riso: {
    label: 'Riso two-spot',
    blurb: 'Two-ink risograph: poster snapper, four plates apart.',
    style: {
      radius: 6, levels: 6, sat: 1.05, black: 20, white: 250,
      edgeLo: 1.0, edgeHi: 18, darkGate: 40, thick: 1.1, boil: 0.45, jitter: 0.25,
      ink: [22, 24, 44], tint: [252, 214, 190], tintAmt: 0.45,
      half: 0.14, halfDark: 120, paperAmt: 0.07,
      minLine: 28, hold: 0.5, chromaCarry: 0.4, minRegion: 110, hatch: null,
    },
    keys: [
      { ink: hex('#16182c'), tint: hex('#fdeee2'), ramp: ramp('#16182c', '#35375f', '#6d6fa4', '#f6c9a8', '#fdeee2') },
      { ink: hex('#2a0f3c'), tint: hex('#eef7e2'), ramp: ramp('#2a0f3c', '#4b1a66', '#8b3fa2', '#c9e6a8', '#eef7e2') },
      { ink: hex('#0a2a33'), tint: hex('#f9f2d8'), ramp: ramp('#0a2a33', '#14525f', '#2f8a94', '#f0d79a', '#f9f2d8') },
    ],
  },

  blueprint: {
    label: 'Blueprint',
    blurb: 'Ink lines only — no fill, no dots. For blocking shots.',
    style: {
      radius: 4, levels: 2, sat: 0, black: 0, white: 255,
      edgeLo: 1.15, edgeHi: 20, darkGate: 0, thick: 1, boil: 0.5, jitter: 0.2,
      ink: [26, 58, 92], tint: [238, 244, 252], tintAmt: 0.85,
      half: 0, halfDark: 0, paperAmt: 0.04,
      minLine: 40, hold: 0.6, chromaCarry: 0.0, minRegion: 220, hatch: null,
    },
    keys: [
      { ink: hex('#1a3a5c'), tint: hex('#f0f6fe'), ramp: ramp('#1a3a5c', '#3f6b93', '#8fb0cc', '#d3e2ef', '#f0f6fe') },
      { ink: hex('#4a2816'), tint: hex('#faf4e8'), ramp: ramp('#4a2816', '#7a5236', '#b08a63', '#dcc9ac', '#faf4e8') },
    ],
  },
};

export function getPreset(name) {
  const p = PRESETS[name];
  if (!p) {
    throw new Error(`unknown preset "${name}" — try: ${Object.keys(PRESETS).join(', ')}`);
  }
  return p;
}
