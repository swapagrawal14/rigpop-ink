# changelog

## 0.2.0 — the "stop looking like camouflage" release

The 0.1 render quantised R, G and B independently. That shifts hue per channel and lands on
muddy olive/pink, and on dark footage the bands follow sensor noise, so frames read as
camouflage rather than artwork. 0.2 replaces the middle of the shader.

**Changed**
- **palette ramps** — every preset key carries five hand-picked ink→paper colours; the frame
  is posterised by luminance onto that ramp instead of per-channel quantisation
- **region merge** — equal-band regions below `minRegion` are repainted with the commonest
  neighbour, so only large shapes survive
- **band contours** — lines come from the band map (jump ≥ 2 → fat, 1 → hairline): closed,
  exactly on the paint edge, no threshold to tune
- **pruneLines** — 4-connected contour runs shorter than `minLine` are deleted (a stroke is
  not a sprinkle)
- **temporal hold** — the coverage field is blended with the previous frame and reset per
  shot; lines stop shimmering every frame
- calmer directing: the beat nudges line weight and boil instead of seizing
- SPEC §3.4/§3.5 rewritten; known limits now name the dark-handheld-interior case explicitly

**Added**
- `night` preset for dark interiors (heavy shadow lift, four big shapes, faint screentone)
- optional screentone stage (`hatch`) — off in every preset, because it amplifies noise on
  dark plates and looks great on clean ones
- `--compare` — source | ink side-by-side in one command, ink-only kept as `<out>.ink.mp4`
- darkroom: pigment carry, shape size, line hold sliders + a side-by-side toggle that applies
  to renders
- `npm test` — determinism and preset smoke checks

## 0.1.0
First working renderer: integral-image Kuwahara flatten, shadow lift + auto levels, cel
bands, Sobel contours with despeckle, sub-pixel ink boil over a coverage field, scaled dot
screen, letterbox autocrop, and the director (onsets → boil, cuts → ink key, drama → line
weight). CLI + darkroom.
