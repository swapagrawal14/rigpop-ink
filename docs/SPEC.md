# rigpop-ink — specification

Status: v0.1 (working). This document describes what the renderer computes, why each stage
is ordered the way it is, and what the director is allowed to change. If the code and this
document disagree, the document is the intent and the code is the bug.

---

## 1. Why this is not a filter chain

A normal video-look pass is a stack of `ffmpeg` filters: `edgedetect`, `curves`,
`hue`, `noise`. It is stateless per frame, blind to the edit, and blind to the soundtrack.

rigpop-ink is a **renderer with a director**. The pixel work is hand-written (it has to be:
the interesting operations — selective variance flattening, contour classes, a coverage
field sampled with sub-pixel offset — are not in any ffmpeg filter), and the *parameters* of
that pixel work are decided per frame from an analysis of the clip:

```
             ┌──────────────┐
  audio  ───▶│  onsets      │──┐
  video  ───▶│  cuts        │──┼──▶ director ──▶ style(frame) ──▶ shader ──▶ frame
  video  ───▶│  drama curve │──┘                                    ▲
             └──────────────┘                                  decoded rgba
```

The invariant that makes it useful: `style(frame)` is a **pure function** of the analyses,
the preset and the seed. No wall-clock, no frame-to-frame state, no randomness that is not
seeded. Consequences: a scrub in the browser shows exactly the frame the file will contain,
renders are reproducible, and the four directing rules can be switched off individually to
A/B them.

---

## 2. Analyses

### 2.1 Audio onsets (`audioOnsets`)

Audio is decoded to mono 8 kHz f32. Envelope is RMS over 32 ms hops. Flux is the positive
first difference of the envelope. A hop is an onset when:

* it is a local maximum over ±1 hop and ≥ 2 hops back,
* its flux exceeds `max(2.6 × local median, p90(flux) × 0.45, 0.0012)`,
* it is at least 100 ms after the previous onset.

Output is a list of times in seconds. `probe` reports the median gap as a tempo estimate —
a sanity check, not a beat tracker. Dense percussive scores produce many onsets (that is
fine; the boil is rate-limited by the 100 ms floor, so the drawing trembles at up to 10 Hz).

### 2.2 Motion, cuts, drama (`motionMap`)

The video is decoded a second time at 64×36 luma. For every frame:

* `d[i] = mean |luma_i − luma_{i−1}| / 255` — motion energy
* `med` = median of `d`, `hi` = 95th percentile of `d`
* **cut**: `d[i]` is a local max over ±3 frames and `d[i] > max(3.2 × med, 0.9 × hi)`, and at
  least 0.5 s since the previous cut
* **drama**: `min(1, d[i]/hi)`, box-smoothed over ±2 frames

Row and column means are accumulated at the same time and used for **letterbox detection**:
contiguous near-black rows/columns hugging each edge (mean < 9/255). More than 40% on either
axis is treated as a false positive and ignored.

### 2.3 Cropping

Letterbox fractions become an even-aligned pixel rect inside the source frame. When a crop
exists, the decode filter is `crop=cw:ch:cx:cy,scale=W:H:flags=bicubic`, so the shader only
ever sees real picture. Output dimensions follow the *cropped* rect.

---

## 3. The shader

All stages operate in place on buffers allocated once per `InkShader`. Frame size is
`W×H` RGBA.

### 3.1 Summed-area tables

Five integral images over `(W+1)×(H+1)`: Σ luma, Σ luma², ΣR, ΣG, ΣB. Any axis-aligned
window's mean and variance is four reads. Cost is O(pixels) regardless of window size.

### 3.2 Kuwahara flattening

For each pixel, four quadrants of radius `r` around the pixel (NW, NE, SW, SE). For each
quadrant compute variance from the integral images; output the mean of the *lowest-variance*
quadrant. Effect: flat regions flatten, edges are preserved — a painted look rather than a
blurred one.

`r` is expressed in 480-line units and scaled: `r = max(2, round(radius × min(W,H)/240))`.
Because the integral images make radius free, this is a resolution-independent "brush size".

### 3.3 Shadow lift and auto levels

1. `med` = median luminance of the flattened frame (256-bin histogram).
2. `gamma = 1 − lift × (1 − min(1, med/120))`; if `gamma < 0.985`, apply it through a
   256-entry LUT to all three channels. A night interior (median ≈ 30) gets ≈ 0.72.
3. `[p2, p98.5]` from the flattened frame's histogram define `black` and `white`:
   `black = mix(preset.black, p2 × 0.8, auto)`, `white = mix(preset.white, clamp(p98.5 × 1.05 + 4, 64, 252), auto)`.
   A minimum span of 40 levels is enforced.

Without 3.3, one preset cannot survive both a day exterior and a cave: the paint bands are
cut on an absolute luminance ramp, so dark footage collapses into two bands of mud.

### 3.4 Cel bands

Per channel, pull toward luma by `sat`, then quantise to `levels` steps spanning
`[black, white]`. Output is the "printed ink" plate.

An optional **3×3 median** (default on) removes salt-and-pepper caused by quantising noisy
midtone regions; it does not move contours because it runs before edge detection.

### 3.5 Contours

Sobel (|Gx| + |Gy|) over the **flattened, cel-quantised** luma. Operating on the flat image
rather than the raw frame is the difference between clean ink and confetti.

* threshold `t = mean(gradient) × edgeLo + edgeHi × jitterMul`
* pixels darker than `gate` are skipped, where `gate = mix(preset.darkGate, black + 0.14(white−black), auto)`
  — inside deep shadow the ink stays solid instead of noisy
* `|G| > 2.1 t` → **strong contour** (fat brush), else `|G| > t` → **detail line** (thin)
* despeckle: a lone line pixel with fewer than 2 line neighbours is dropped

### 3.6 Ink boil

The binary mask becomes a **coverage field**: strong = 1.45, detail = 1.0, then a separable
3-tap blur (once, default). The field is sampled **bilinearly** at `(x + ox, y + oy)` where
`(ox, oy)` is a per-frame offset from `boil × 1.6` px of smooth value noise seeded by
`seed`. Coverage is multiplied by a gain and composited: `out = lerp(paint, ink, min(1, cov×gain))`.

Blurring + bilinear sampling is what makes lines read as drawn instead of as a pixelated
mask, and it makes the boil a *wobble* rather than a *jitter*.

### 3.7 Paper and dot screen

Paper: per-pixel multiplicative grain from a seeded xorshift, and an optional tint blend
that is strongest in the midtones.

Dot screen: round 8×8 dots at 45°, lattice step `max(1, round(min(W,H)/400))` screen pixels,
applied only where `0.30 × darkBelow < luma < darkBelow` — i.e. mid-shadow. Solid black
stays solid; the dots read as print, not as dithering.

### 3.8 Camera wobble

The finished frame is shifted by up to ±2 px by `shake`, clamped at the edges. Applied after
compositing so it moves ink, paint and paper together.

---

## 4. The director

`styleForFrame(f)` where `f` is the frame index within the rendered window.

| input | rule | effect |
|---|---|---|
| cuts | `shot = count(cuts ≤ f)` | |
| keys | `key = keys[(shot × 7 + seed) mod n]` | ink + paper colour change **exactly on the cut** |
| onsets | `age = (f − lastOnset)/fps`; `pulse = age < 0.16 ? 1 − age/0.16 : 0` | |
| pulse | `thick = max(2, base)` when `drama > 0.6` or `pulse > 0.55`; `edgeHi ×= 1 − 0.16 pulse`; `boil += 0.9 pulse` | the line punches on the hit and the tremble re-rolls |
| boil seed | `seed × 977 + shot × 131 + onsetsSoFar × 61` | every onset is a new drawing |
| drama | `edgeHi ×= 1.24 − 0.5 d`; `half ×= 0.72 + 0.55 d` | busy frames get heavier contour and a tighter screen |

Feature switches (`--no-beat`, `--no-cuts`, `--no-drama`, `--no-shake`) disable each row
independently. With all four off, the renderer is a plain per-frame styliser — which is
sometimes exactly what a shot needs.

---

## 5. Pipeline

```
in.mp4 ─┬─▶ analyse (audio onsets, 64×36 motion, letterbox)  ──▶ director
        └─▶ ffmpeg decode ──▶ raw rgba frames ──▶ shader ──▶ raw rgba ──▶ ffmpeg encode
                                    (crop+scale in the decoder)              │
in.mp4 ───────────────────────────── audio stream (aac) ────────────────────┴─▶ out.mp4
```

* one decode pass for pictures at a single resampled size (`-s WxH`), one tiny pass for
  analysis, one audio pass for onsets
* frames are `Buffer`s of `W×H×4`, written to the encoder with backpressure
* the encoder muxes the source's own audio and `-shortest`, so dialogue and music are intact

## 6. Determinism contract

`(input, preset, seed, start, dur, scale, fps, features)` → identical bytes. Anything random
is derived from `seed` plus frame-local integers. Paper grain uses a seeded xorshift reset
per frame; boil offsets use seeded value noise; the key rotation is index arithmetic.

## 7. Performance notes

* Integral-image Kuwahara: O(n) with a 4-window constant, independent of radius.
* Per frame: 5 SAT builds + 4 quadrant reductions + median (3 × 9-element sorts/pixel) +
  Sobel + 2×3-tap blur + composite + screen. No allocation in the loop.
* Measured on one core: ≈ 10 f/s at 852×372 with the median off, ≈ 4–6 f/s with it on;
  ≈ 2 f/s at 852×480 with all stages. Decode+encode are not the bottleneck.
* Where the time goes, in order: median, contour, ink composite, kuwahara, screen.

## 8. Known limits

* **Temporal consistency** is per-frame; there is no flow field, so a hard camera pan makes
  the paint bands crawl. The boil and the shake hide most of it; it is not fixed.
* **Dark, low-contrast, handheld footage** inks muddier than clean, high-contrast footage.
  `probe` (drama mean, cut count) is the early warning.
* **Letterbox detection** assumes near-black bars; a gradient vignette will not be cropped.
* **No faces**. Frames with a dominant flat background and a small subject (drone shots,
  wide exteriors) get the most flattering result; busy texture fills the frame with detail
  lines unless `edgeHi` is raised.
* The dot screen is a screen, not error diffusion — at small scales it can moiré against the
  source's own texture.
