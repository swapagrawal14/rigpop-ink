/**
 * Named looks. Each preset is a base style plus a "key family": the set of
 * inks/paper tones the director may jump between when the film cuts, so a
 * single render can change colour key per shot without the operator doing
 * anything.
 */
export const PRESETS = {
  'manga-noir': {
    label: 'Manga noir',
    blurb: 'Bilevel shadows, thick contour, hard dot screen.',
    style: {
      radius: 5, levels: 6, sat: 0.62, black: 6, white: 250,
      edgeLo: 0.9, edgeHi: 13, darkGate: 52, thick: 1, boil: 1, jitter: 0.55,
      ink: [16, 15, 20], tint: [236, 234, 226], tintAmt: 0.10,
      half: 0.18, halfDark: 112, paperAmt: 0.10,
    },
    keys: [
      { ink: [14, 14, 18], tint: [236, 234, 226] },
      { ink: [18, 12, 26], tint: [226, 224, 238] },
      { ink: [10, 18, 20], tint: [222, 236, 232] },
    ],
  },

  ghazal: {
    label: 'Ghazal',
    blurb: 'Warm sepia wash, hairline contour, soft grain — for slow songs.',
    style: {
      radius: 5, levels: 10, sat: 0.98, black: 18, white: 246,
      edgeLo: 1.1, edgeHi: 18, darkGate: 26, thick: 1, boil: 1, jitter: 0.30,
      ink: [58, 38, 28], tint: [246, 232, 204], tintAmt: 0.34,
      half: 0.14, halfDark: 96, paperAmt: 0.11,
    },
    keys: [
      { ink: [58, 38, 28], tint: [246, 232, 204] },
      { ink: [48, 40, 46], tint: [240, 228, 214] },
      { ink: [66, 34, 24], tint: [250, 226, 196] },
    ],
  },

  'pulp-horror': {
    label: 'Pulp horror',
    blurb: 'Acid spot inks, crushed contrast, screen-print dots.',
    style: {
      radius: 4, levels: 7, sat: 1.55, black: 8, white: 252,
      edgeLo: 0.9, edgeHi: 11, darkGate: 60, thick: 1, boil: 2, jitter: 0.7,
      ink: [24, 6, 14], tint: [214, 240, 190], tintAmt: 0.22,
      half: 0.28, halfDark: 130, paperAmt: 0.08,
    },
    keys: [
      { ink: [24, 6, 14], tint: [214, 240, 190] },
      { ink: [10, 10, 30], tint: [246, 196, 176] },
      { ink: [30, 4, 30], tint: [200, 244, 236] },
      { ink: [18, 14, 6], tint: [252, 214, 232] },
    ],
  },

  riso: {
    label: 'Riso two-spot',
    blurb: 'Two-ink risograph: poster snapper, four plates apart.',
    style: {
      radius: 5, levels: 4, sat: 1.0, black: 20, white: 250,
      edgeLo: 0.95, edgeHi: 14, darkGate: 40, thick: 1, boil: 1, jitter: 0.6,
      ink: [22, 24, 44], tint: [252, 214, 190], tintAmt: 0.45,
      half: 0.30, halfDark: 120, paperAmt: 0.09,
    },
    keys: [
      { ink: [22, 24, 44], tint: [252, 214, 190] },
      { ink: [46, 12, 60], tint: [204, 244, 208] },
      { ink: [10, 40, 52], tint: [252, 236, 178] },
    ],
  },

  blueprint: {
    label: 'Blueprint',
    blurb: 'Ink lines only — no fill, no dots. For blocking shots.',
    style: {
      radius: 2, levels: 2, sat: 0, black: 0, white: 255,
      edgeLo: 1.05, edgeHi: 15, darkGate: 0, thick: 1, boil: 1, jitter: 0.45,
      ink: [26, 58, 92], tint: [238, 244, 252], tintAmt: 0.85,
      half: 0, halfDark: 0, paperAmt: 0.05,
    },
    keys: [
      { ink: [26, 58, 92], tint: [240, 246, 254] },
      { ink: [74, 40, 22], tint: [250, 244, 232] },
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
