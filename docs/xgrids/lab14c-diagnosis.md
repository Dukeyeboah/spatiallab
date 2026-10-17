# Lab 14C — Why the Basel splat looks soft (local diagnosis)

**Status (2026-10-16):** Local analysis and focused-dataset **selection** only. **No GPU rental, no upload, no training.** Both RunPod pods stay stopped with volumes untouched until you terminate them separately.

| Artefact | Path (outside Git) |
| --- | --- |
| Smoke PLY / eval | `…/lab14b/basel-xgrids-smoke-20261016-085054/` |
| Quick PLY / eval | `…/lab14b/basel-xgrids-quick-20261016-121637/` |
| Training cameras (Ns frame) | `…/lab14c/training-cameras-quick.json` (copy also beside the quick result) |
| Focused courtyard selection | `…/lab14c/selection-courtyard-2s.json` (+ 5 s comparison) |

---

## Plain-language verdict

The quick run (7,000 steps) **did train successfully** (LiDAR seed used, export/eval OK, PSNR rose from ~12.7 → ~15.4). The blurry / smeared look is **not** mainly “the GPU failed”. It is mostly a **coverage and pose-continuity** problem on a long outdoor route, plus known **calibration assumptions**, with **underfitting** as a secondary factor. The awkward SuperSplat start was a **viewer coordinate mismatch** (LAS Z-up vs Lab 8’s COLMAP Y-down framing), not a flipped training world.

---

## Confirmed problems (evidence in hand)

### 1. Sparse sampling along a long path

Lab 14A used **5 s** slots over ~10.5 minutes → **127 events / 254 images**, path **~195 m**, median step **1.47 m**, median turn **29°**.

Between consecutive events: **11 turns > 90°**, and **43** times the next event’s cameras do not continue either viewing direction within 60° (`pose continuity` warning in `checks/validation.json`).

**Why that hurts Gaussians:** the optimiser needs overlapping views of the same surface. Large jumps and big turns leave walls and courtyard faces seen from few angles → smear and ghosting, even when metrics improve a little.

### 2. Opposite cameras ≈ 154° apart (little same-event stereo)

ch14 and ch18 look left/right of the scanner. At one timestamp they barely see the same surface. Multi-view geometry comes mostly from **motion along the route**, which we thinned with 5 s sampling.

### 3. Experimental calibration + zero lever arm (assumed)

Stage B `x_c69aede71834` is an experimental estimate. Lever arm is **assumed zero**. Hand matches reproject with **~0.74° median** error (matches Stage B residuals). That is “usable for a first experiment”, not survey-grade. Centimetre-scale centre error matters most on close surfaces (one view had median depth < 1.5 m).

### 4. Viewer orientation (Spatial Lab), not training axes

Nerfstudio kept **LAS Z-up** (`assume_colmap_world_coordinate_convention False`, `orientation-method none`). `dataparser_transforms.json`: **identity rotation**, translation ≈ `[10.22, 11.45, 0.56]`, **scale ≈ 0.05017**.

Lab 8’s start camera assumed SuperSplat’s **Rz(180°)** + file map `(x,y,z)→(−x,−y,z)` (COLMAP Y-down scenes). Applied to a Z-up PLY, “Reset” and the first view feel sideways / hard to navigate.

**Fix in Lab 14C (local):** Gaussian Viewer → **World up: LAS Z-up** (rotates the content entity Rx(−90°) and remaps framing). Optional **Fly** mode and **paste a training camera** from `training-cameras-quick.json` (`positionNs` / `targetNs`).

### 5. LiDAR seed was used; Gaussians then wandered

Init check: **1 M → 1 M**. Comparing the seed (mapped with the same dataparser transform) to the quick PLY means: AABB still overlaps, but Gaussian centres spread far beyond the seed (floaters / densification). So “no LiDAR init” is **ruled out**; “seed alone makes a sharp courtyard” is also **ruled out**.

---

## Ruled out / working as designed

| Topic | Finding |
| --- | --- |
| Fisheye → pinhole | Pixel check: mean grey diff ~0.68; 180° roll test ~85 (would fail if mapping inverted) |
| Upside-down cameras | image-up · world +Z median **0.982** |
| Isolated views | covisibility: **0** views with no partner ≥ 20 % |
| Training crash / NaNs | smoke + quick train/export/eval all ok |
| Wrong Nerfstudio world remap | identity R + scale recorded; upright cameras |

---

## Possible explanations (not proven as the main cause)

| Idea | Why it might matter | Why it is secondary for now |
| --- | --- | --- |
| **Underfitting** (7k vs 30k) | PSNR only +2.7 from smoke→quick; schedule not finished | Smear patterns often track pose gaps; more steps on a bad dataset usually polish ghosting |
| Lever arm centimetres | Close façades sensitive | Residual ~0.74° already from rotation/f; fix after denser views |
| Exposure / low-texture walls | 8 exposure flags; sharpness warning (plain walls) | Does not explain courtyard smear alone |
| Need pose refinement | Could absorb lever-arm / cal error | One variable at a time after a denser base train |

---

## Coverage: full-route 5 s vs focused courtyard 2 s

| | Lab 14A (trained) | Lab 14C proposed |
| --- | --- | --- |
| Window | ~7.5–18 min | **14–16.5 min** (courtyard) |
| Interval | 5 s | **2 s** |
| Events / images | 127 / 254 | **64 / 128** |
| Path | ~195 m | **~50 m** |
| Median step | 1.47 m | **~0.75 m** |
| Median turn | 29° | **~16°** |
| Steps > 2 m | 28 | **0** |

Same experimental calibration and zero lever arm. Selection JSON only — **dataset not built, not packaged, not trained.**

---

## RGB LiDAR vs Gaussians (same Nerfstudio frame)

Using `X_ns = scale * (X_las + t)` from the quick `dataparser_transforms.json`:

- LiDAR seed (sample) sits in a compact AABB in Ns space.
- Quick Gaussians occupy a **much larger** AABB with centre shift ~1.6 units in X — densification and floaters, not a missing transform.
- Side-by-side “photo vs splat” in one Spatial Lab viewport still needs a later remapping lab; for now use eval-renders and training-camera starts in `/gaussian-viewer` with **LAS Z-up**.

---

## Single most useful next training experiment

**Train a denser focused courtyard package** (build from `selection-courtyard-2s.json` with the same Stage B cal and LiDAR init): smoke 300 → review → quick 7,000 only if smoke is coherent.

**What it discovers:** if smear drops when median step/turn improve (holding calibration fixed), the long sparse route was the main limiter. If smear stays, next dig is lever arm / Stage B / pose refinement — not “more of the full route” or “quality 30k on the same 5 s set”.

Estimate (same Secure 4090 class, when you approve): similar order to Lab 14B quick (~half hour–hour GPU once the package exists), **after** local `prepare_splat_dataset` + package. **Do not start until you say so.**

---

## What we did *not* do (Lab 14C stop line)

- No RunPod start/stop beyond the prior audit; pods `zf5dl3jh9clzyi` and `ce9po8uagl0mrd` left **EXITED**, volumes kept.
- No new GPU rental, upload, or `ns-train`.
- No quality 30k.
- Focused selection prepared; images/COLMAP **not** regenerated yet.
