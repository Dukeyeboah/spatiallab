# Lab 14D — Focused courtyard training (smoke + quick)

**Status (2026-10-16):** Dataset built/validated/packaged. **Smoke 300** and **quick 7,000** both complete. **No quality (30k).** All Lab 14D GPUs stopped. Lab 14B pods untouched.

### Decision gate (after quick)

Courtyard density **helps but does not fix** soft quality. At matched view `seq02872_ch14_c`, Lab 14D is **structurally clearer** than Lab 14B (pillars, balcony, sign board edges) but remains **severely blurry**; foliage still ghosts. Aggregate courtyard PSNR rose smoke→quick (10.6→19.2), yet appearance is not sharp enough to justify a longer train on the same calibration.

**Do not run quality automatically.** Lab **14E** local diagnosis ([lab14e-blur-diagnosis.md](lab14e-blur-diagnosis.md)): courtyard held-out residuals **~17–23 px** (~12 cm at 7.6 m). Next: **14E.1** local lever/cx,cy probe — not more steps.

---

## Quick result (7,000) — local

| Artefact | Path |
| --- | --- |
| Result folder | `…/lab14d/basel-courtyard-quick-20261016-221112/` |
| Tarball | `…/lab14d/lab14d-quick-20261016-221112.tar.gz` (sha256 `a21c9108…`) |
| Review panels | `…/lab14d/quick-review/` |

| Metric | Quick (7,000) | Smoke (300) |
| --- | --- | --- |
| train / export / eval | ok / ok / ok | ok / ok / ok |
| LiDAR init | **500,000 → 500,000** | same |
| Gaussians exported | **707,266** (0 NaN) | 499,988 |
| Peak VRAM | **3,548 MiB** | 2,624 MiB |
| Train time | **262 s** | 80 s |
| PSNR / SSIM / LPIPS (15-view courtyard eval) | **19.25 / 0.62 / 0.53** | 10.63 / 0.53 / 0.73 |

Pod: new Secure RTX 4090 `3yew4v2f9ub76t` @ **$0.89/h** (smoke host had no free GPU for restart). Command: `EXPECTED_POINTS=500000 bash train_xgrids.sh quick`. Calibration / dataset / optimizer unchanged from smoke.

### Smoke result (local)

| Artefact | Path |
| --- | --- |
| Result folder | `…/lab14d/basel-courtyard-smoke-20261016-211001/` |
| Tarball | `…/lab14d/basel-courtyard-smoke-20261016-211001.tar.gz` (sha256 `249b2863…`) |
| Review panels | `…/lab14d/smoke-review/` |

---

## Visual comparison vs Lab 14B quick

Only **one** filename is in **both** held-out eval sets: `seq02872_ch14_c.jpg` (Lab 14B `eval_img_0022`, Lab 14D `eval_img_0010`). Panels in `quick-review/`:

- `compare_seq02872_ch14_c.jpg` — Original \| Lab 14B quick \| Lab 14D quick (same crop)
- `compare_detail_seq02872_ch14_c.jpg` — center 50% crop
- `lab14d_only_*.jpg` — GT \| Lab 14D for other courtyard eval views (not in Lab 14B’s eval split)

**Observations (matched view):**

- Lab 14D recovers **straighter pillars**, clearer balcony/roof silhouettes, and a more recognizable “BASEL HOUSE” board than Lab 14B.
- Fine text, thin railings, door muntins, and leaf edges stay soft; **foreground vegetation still ghosts**.
- Color/exposure can differ slightly (appearance embedding / bilateral grid); framing is the same training-camera pose for that filename.
- Approx same-image PSNR vs GT for that view is similar (~17 dB both; naive grayscale SSIM ~0.77) — **do not rank by that alone**; visual structure favors 14D, sharpness still inadequate.

**Aggregate metrics (different eval sets — not a sole ranking):**

| Run | Eval views | PSNR | SSIM | LPIPS |
| --- | ---: | ---: | ---: | ---: |
| Lab 14B quick (full route) | 29 | 15.42 | 0.67 | 0.66 |
| Lab 14D quick (courtyard) | 15 | 19.25 | 0.62 | 0.53 |

---

## Dataset artefacts

| Artefact | Path (outside Git) |
| --- | --- |
| Selection (Lab 14C) | `…/training/lab14c/selection-courtyard-2s.json` |
| Extraction run | `…/xgrids/images/lab14d-courtyard-2s/` (128 JPEGs, all `ok`) |
| Dataset | `…/training/lab14d/basel-courtyard-2s-forward12/` (**141 MB**) |
| Checks | `…/basel-courtyard-2s-forward12/checks/` (contact sheet, top-down, overlays) |
| Training package | `…/training/lab14d/basel-courtyard-r1/` + `.zip` (**81 MB**) |
| Zip SHA-256 | `c492bc17e7fd5a40cf799d57d160b9cf49014f387248ed2bf351cbc7c3db1510` |
| Shared views vs 14B | `comparable-viewpoints-vs-lab14b.json` (42 images / 21 sequences) |

Calibration: Stage B **`x_c69aede71834`** · Layout: **`forward12`** · Lever arm: **0** (assumption unchanged).

---

## Dataset facts

| Item | Value |
| --- | --- |
| Window | minutes **14–16.5** (courtyard loop) |
| Sampling | **2 s** slots |
| Events / images | **64 / 128** (1600×1200 PINHOLE JPEG) |
| Train / eval | **113 / 15** (eval interval **9**, both cameras) |
| Path / span | **50 m** path; centres span **19.1 × 17.1 × 1.4 m** |
| Median step / turn | **0.74 m** / **16.3°** (max step 1.89 m) |
| LiDAR seed | **500,000** points (12 m radius, 5 cm voxel) |
| Package zip | **81 MB** |

Lab 14A/14B datasets were **not** overwritten.

---

## Coverage / validation (unchanged)

Validation **pass with warnings** (exposure; mild pose continuity). Covisibility median **0.63**, **0** isolated views; all 64 events kept. Full tables remain in the Lab 14D.0 notes historically; see also `checks/validation.json`.

---

## LiDAR initialization

Same Basel 5 M preview → within **12 m** of cameras → 5 cm voxel → cap **500,000**. Quick run confirmed `points3DBin` **500000** → `dataparserPoints` **500000**; export had **0** NaN Gaussians.

---

## Training configuration (used)

Unchanged from Lab 14B / `train_xgrids.sh`:

- Nerfstudio **1.1.5** `splatfacto`
- `--assume-colmap-world-coordinate-convention False`
- `--orientation-method none`
- `--center-method poses --auto-scale-poses True`
- `--eval-mode interval --eval-interval 9`
- `--load-3D-points True` + `verify_lidar_init.py` (**EXPECTED_POINTS=500000**)

```bash
EXPECTED_POINTS=500000 bash train_xgrids.sh smoke   # done
EXPECTED_POINTS=500000 bash train_xgrids.sh quick   # done
# quality: DO NOT run without new approval after cal/registration work
```

---

## RunPod inventory (after quick stop)

| Pod ID | Name | Status | Persistent disk |
| --- | --- | --- | --- |
| `3yew4v2f9ub76t` | lab14d-basel-courtyard-quick | **EXITED** | 40 GB |
| `ahzq6a98eyklso` | lab14d-basel-courtyard-smoke | EXITED | 40 GB |
| `ce9po8uagl0mrd` | lab14b-basel-xgrids-quick | EXITED | 40 GB |
| `zf5dl3jh9clzyi` | lab14b-basel-xgrids-smoke | EXITED | 40 GB |

No separate network/global volumes. Stopped-pod disk continues to bill (~$0.20/GB/mo → ~**$8/mo per 40 GB pod**, ~**$32/mo** for four) until you authorize terminate. **No volumes terminated.**

---

## Remaining risks / next work (recommended)

1. **Lever arm / Stage B** — zero translation assumption and ~0.85° residual likely dominate residual blur more than step count.
2. **Image registration / fisheye→PINHOLE** — check reprojection overlays again on courtyard façades after any cal change.
3. Longer training (30k) on this package is **not** recommended while visuals stay severely soft.
4. Aggregate metrics ≠ cross-experiment ranking (29 vs 15 eval views; different extents).

---

## Stop line

No further GPU work without approval. Quality not started.
