# Lab 14E — Why courtyard Gaussians stay soft (local diagnosis)

**Status (2026-10-16):** Local-only investigation after Lab 14D quick. **No GPU rental, upload, or training.** All four experiment pods remain **EXITED**. Local result backups verified complete.

| Artefact | Path (outside Git) |
| --- | --- |
| Residual tables | `…/training/lab14e-blur-diagnosis/correspondence-residuals.json` |
| LiDAR vs LAS counts | `…/training/lab14e-blur-diagnosis/lidar-seed-vs-las.json` |
| Summary bullets | `…/training/lab14e-blur-diagnosis/diagnosis-summary.json` |
| Stage B experiment | `…/xgrids/calibration/experiments/13w/reviewed-2026-10-15/experiment-x_c69aede71834.json` |
| Courtyard validation | `…/lab14d/basel-courtyard-2s-forward12/checks/validation.json` |

---

## Plain-language verdict

Lab 14D already showed that **denser courtyard coverage improves structure but not sharpness**. That rules out “sparse route alone” as the sole cause.

Measurable calibration residuals on **courtyard architectural features** are still about **17–23 px held-out** (~1.0–1.4°) under Stage B with **zero lever arm**. At typical courtyard depth (**~7.6 m**), **15 px ≈ 12 cm** of lateral misregistration on the façade. Photometric Gaussian training then **averages disagreeing rays** → soft pillars, windows, doors and roof edges, even when LiDAR init and densification work.

The **zero lever arm is a confirmed modelling gap**, but **far-range residuals (~14 px at 8–12 m) still exceed what a 5 cm lever can explain (~4–5 px)**. So lever arm is necessary to investigate, not sufficient as the only free parameter. Principal point / mild fisheye deviation remain open. **Microsecond camera–pose sync looks fine.** Missing LAS detail in the seed is real but secondary while cameras disagree by a decimetre on façades.

**Do not run 30k steps on the current calibration.** The smallest next step is a **local** correspondence / lever-arm / principal-point probe on courtyard architecture (one variable at a time), then a dataset rebuild only if residuals drop.

---

## Confirmed (evidence)

### 1. Stage B residuals remain large on courtyard architecture

| Source | Result |
| --- | --- |
| Stage B training (all 19) | median **~12.8 px**, RMS ~14–17 px |
| Leave-one-event held-out | ch14 median **18.1 px**, ch18 **16.0 px** |
| Courtyard matches (seq 2977 / 2587) held-out | **16.9–22.6 px** (pillar, boards, roof edge) |
| Lab 14D validation (5 matches in views) | median **9.6 view-px** ≈ **0.85°** (consistent with fisheye ~14 px) |

Angular scale: **15 px / f≈961 ≈ 0.89°**. Lateral on a surface at depth *d*: *d·tan(θ)* → **~12 cm at 7.6 m**, **~19 cm at 12 m**.

That is large enough to prevent sharp multi-view consensus on window frames and thin pillars.

### 2. Zero lever arm is an assumption, not a measurement

- Manifest: `leverArmStatus: assumed (unknown)`, body offset `[0,0,0]`.
- Sensitivity (Stage B refit with ±5 cm along body axes): ch14 **f shifts up to ~31 px/rad**; angles up to ~1.4°.
- Geometric budget alone: at 7.6 m, **5 cm → ~6 px**; at 3 m → ~16 px; at 1.5 m → ~32 px.
- Courtyard scene-depth check: **0** views with median depth &lt; 1.5 m (median depth **7.6 m**) — lever arm hurts less than indoors, but still matters.

### 3. Far residuals are **not** explained by a 5 cm lever alone

| Distance bin | n | Stage B err median | Geom. 5 cm lever |
| --- | ---: | ---: | ---: |
| &lt; 3 m | 6 | 11.5 px (max 40.5 outlier) | ~33 px |
| 3–8 m | 5 | 8.8 px | ~10 px |
| ≥ 8 m | 8 | **14.3 px** | **~4 px** |

At courtyard distances, a large fraction of the residual remains after a plausible lever budget. **Hypothesis, not yet fitted:** principal point, residual rotation, and/or equidistant-model error.

### 4. Image ↔ pose timing is tight (unlikely primary blur cause)

| Check | Value |
| --- | --- |
| ch14↔ch18 pair Δt | median **17 µs**, max **19 µs** |
| `poses.csv` rate | **~10 Hz** |
| Median scanner speed | **~0.32 m/s** |
| 20 ms unknown time offset | ~0.65 cm travel → **~0.8 px** at 7.6 m |
| 50 ms offset | ~1.6 cm → **~2 px** at 7.6 m |

Pair sync is excellent. An undetected multi-tens-of-ms clock bias is not supported by current data and would still be small vs ~15 px cal error.

### 5. Fisheye → PINHOLE pipeline and LiDAR init behaved as designed

| Check | Result |
| --- | --- |
| View ↔ fisheye grey test | mean diff **0.80** (180° control **85**) |
| LiDAR render NCC | dataset pose best in **127/128** views |
| Lab 14D quick init | **500,000 → 500,000**, `random_init: false` |
| Export | **0** NaN Gaussians |
| Image-up · +Z | median **0.970** |

Softness is **not** “seed missing” or “flipped cameras”.

### 6. Coverage improvement (14B → 14D) already tested denser views

Same Stage B cal, denser courtyard sampling → clearer massing, still severe blur. So **next experiments should change calibration / registration (or pose refinement), not only coverage or step count.**

### 7. RunPod / backups (cost audit)

| Pod | Name | Status | Persistent disk |
| --- | --- | --- | --- |
| `zf5dl3jh9clzyi` | lab14b-smoke | EXITED | 40 GB |
| `ce9po8uagl0mrd` | lab14b-quick | EXITED | 40 GB |
| `ahzq6a98eyklso` | lab14d-smoke | EXITED | 40 GB |
| `3yew4v2f9ub76t` | lab14d-quick | EXITED | 40 GB |

No network/global volumes. Stopped disks ≈ **$0.20/GB/mo × 40 × 4 ≈ $32/mo**.

**Local backups:** all four result folders have `splat.ply`, `checkpoint/step-*.ckpt`, `eval.json`, `eval-renders/` (+ INDEX), `run.json`, `init-check.json`, `dataparser_transforms.json`, `train.log`, `config.yml`, plus matching `.tar.gz` archives. **Terminated 2026-10-16** after re-verification (user authorization). See [lab14e1-lever-principal.md](lab14e1-lever-principal.md).

---

## Hypotheses (not proven)

| Hypothesis | Why plausible | How to falsify cheaply |
| --- | --- | --- |
| **Lever arm + principal point** jointly needed | Far residuals &gt; 5 cm budget; cx,cy fixed at centre | Local Stage C / lever fit on courtyard edges; held-out median should drop |
| **Equidistant model incomplete** | Edge θ up to ~60° on some picks; no k₁/k₂ | Residuals vs image radius after lever/cx,cy fixed; if still rises with r, add one distortion term |
| **Fixed poses + cal error → photometric smear** | camera_opt **off** in Lab 14D config | Later: one smoke with camera opt **on** only (after cal probe), or pose perturbation study |
| **Full-res schedule short at 7k** | `num_downscales=2`, `resolution_schedule=3000` → only ~**1000** steps at 1600×1200 | Secondary; test only after cal residuals fall (otherwise more steps polish ghosting) |
| **Preview/seed under-samples façades** | Full LAS ~**138 M** pts in 12 m vs preview **2.7 M** (~51×); ≥**3 M** 5 cm voxels vs **1.05 M** from preview; seed **500 k** | Coverage maps local-only; GPU seed A/B only after cal improves |

---

## Ruled out / unlikely as primary

- Training failure / NaNs  
- LiDAR seed not loaded  
- Upside-down or mirrored fisheye remap  
- Microsecond-scale pair desync  
- “Only need denser courtyard views” (already tried in 14D)  
- “Only need 30k steps on the same cal” (decision gate from 14D still stands)

---

## Distortion / principal-point notes

Small-n residual vs image radius (Stage B training set):

| Radius from centre | n | err median |
| --- | ---: | ---: |
| &lt; 400 px | 10 | 14.3 |
| 400–800 | 6 | 11.5 |
| 800–1200 | 3 | 16.8 |

No clean “edges much worse” signature yet (**n too small**). Do **not** add distortion terms before lever arm / cx,cy probes on a larger courtyard set.

---

## Splatfacto settings (Lab 14D quick) — secondary review

From `config.yml` (defaults, not retuned):

- `random_init: false`, LiDAR seed used  
- `camera_optimizer.mode: off` (poses locked)  
- Densify all through 7k (`stop_split_at: 15000`)  
- `num_downscales: 2`, `resolution_schedule: 3000` → limited native-res optimisation  
- `cull_alpha_thresh: 0.1`, `densify_grad_thresh: 0.0008`, `sh_degree: 3`  

These may affect polish, but **do not explain 12 cm façade disagreement**. Prefer fixing projection before retuning densification.

---

## Smallest next experiment (recommended)

**Name:** Lab 14E.1 — courtyard registration probe (**local only**, no GPU).

**Goal:** Distinguish “calibration/registration limits sharpness” from “need different training hyper-parameters”, **one change at a time**.

### Procedure

1. **Add 10–15 rigid courtyard correspondences** (window corners, pillar–beam joints, door frames, roof eaves) at **5–12 m**, both cameras, ≥ 4 sequences. Prefer ray–plane or carefully checked nearest-point picks on the **full LAS** if the UI allows; otherwise preview with honesty about spacing.
2. **Baseline:** re-evaluate Stage B (`x_c69aede71834`) held-out / training error on this courtyard-only set (expect ~15–20 px if current diagnosis holds).
3. **Trial A (lever only):** fit a **3-parameter lever arm** (body frame) with Stage B rotation+f held or lightly refined; report held-out median on held-out courtyard events.  
   **Success:** courtyard held-out median **&lt; 8 px** (roughly &lt; 6 cm at 7.6 m) without blowing up far indoor checks.
4. **If Trial A stalls:** **Trial B (principal point only)** — free `cx,cy` per camera, lever still 0. Same success bar.  
   Do **not** free lever + cx,cy + distortion in one go.
5. **Multi-view consistency check (no train):** pick one LiDAR edge point; project into two nearby courtyard views under baseline vs Trial A/B; report pixel disagreement. Cal win ⇒ disagreement shrinks.
6. **Stop.** If residuals fall, ask approval to rebuild the Lab 14D package with the new cal and run **smoke 300 only**. If residuals do not fall, next is expanded correspondence quality / lens model — still not 30k.

### Explicitly deferred

- Quality 30k / any new GPU train  
- Changing densify/scale/opacity knobs  
- Reseeding from full LAS for training (optional later A/B)  
- Terminating RunPod volumes (await your OK)

---

## Stop line

No RunPod start, no upload, no `ns-train`. Diagnosis complete; next action is Lab 14E.1 local correspondence work when you approve that plan (or a variant).
