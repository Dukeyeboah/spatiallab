# XGRIDS camera calibration experiments (Labs 13V–13W)

**Status: experimental.** These are first estimates from 19 hand-picked
correspondences in one recording (Basel House). They are not a verified or
production calibration, and nothing in the app uses them automatically.

The maths is in `backend/camera_calibration.py` (Python, NumPy, SciPy). It is
called by the command line (`scripts/xgrids/calibrate_cameras.py`) and by the
"Calibration optimization" mode on `/camera-calibration`. The inputs are
Lab 13U correspondence exports (`docs/xgrids/correspondences.md`).

## The ideas in plain words

- **Calibration** means finding the numbers that turn a 3D point into the
  pixel where the camera saw it. Once they are known, every LiDAR point can be
  placed in every photo (and every pixel becomes a ray into the scan).
- **Intrinsics** describe the camera on its own: how strongly the lens bends
  light (the focal parameter *f*), where the optical axis meets the sensor
  (the principal point *cx*, *cy*) and any extra distortion. They don't depend
  on where the camera is.
- **Extrinsics** describe where the camera sits on the scanner: its rotation
  (yaw, pitch, roll relative to the scanner body) and its position offset
  (the *lever arm*). Combined with the scanner's pose at the image time they
  give the camera's pose in the LiDAR frame.
- **Fisheye distortion.** These cameras see almost a half-sphere. A normal
  (pinhole) camera model can't do that. We use the *equidistant* fisheye
  model: a point θ radians away from the optical axis lands *f · θ* pixels from
  the image centre. Real lenses deviate a little from this; extra distortion
  terms would describe that, but we don't have enough points to estimate them.
- **Reprojection error** is the distance in pixels between where you clicked
  a feature in the photo and where the model projects its LiDAR point. Small
  errors mean the model and the data agree.
- **Why a low training error proves little.** A model with enough free
  parameters can fit a handful of points closely while being wrong elsewhere
  (over-fitting). Mistakes in the picks can also be "absorbed" by wrong
  parameters.
- **Why validation is needed.** We therefore fit with some data and test with
  data the fit never saw. Here: *leave one capture event out*. Each event's
  points are predicted by a fit made only from the other events (an event =
  one scanner position, so a point and its neighbours in the same photo are
  never split between fitting and testing). We also check the result on whole
  photos that no point came from (the image check below).

## Conventions (unchanged from Labs 13S/13U)

- Scanner pose: `v_las = R(q) · v_body`, q = (x, y, z, w); body X forward, Y left, Z up.
- Camera frame: X = optical axis, Y = image left, Z = image up.
- `R_world_camera = R_world_scanner · R_scanner_camera`, with
  `R_scanner_camera = Rz(−yaw) · Ry(−pitch) · Rx(roll)` (yaw + = right, pitch + = up, roll + = clockwise).
- Camera centre = scanner position (lever arm **unknown**, assumed 0).
- Equidistant model: θ = atan2(√(y² + z²), x), r = f·θ, `u = cx + r·(−y/s)`, `v = cy + r·(−z/s)`.
- Pixels: OpenCV (u right, v down, (0, 0) = centre of the top-left pixel).
- A projection is valid only if θ < 180° and r ≤ the usable radius (1400 px).
  Errors are computed only for valid projections.

`tests/xgrids/test_camera_calibration.py` checks that the Python projection
reproduces the app's predicted pixels for the real export.

## Workflow

1. **Input checks.** The export must have schema `spatial-lab/xgrids-correspondences` v1,
   a dataset id and a `poses.csv` SHA-256. Each record must pass the same checks
   as the app's import and belong to that dataset and pose file, and ids must be unique.
   Optional: the expected dataset id and the pose file's hash, and a
   cross-check of every record against its extraction run's manifest (image,
   timestamp, size and scanner pose). The input file is only read, never
   changed, and its SHA-256 identifies it in the results.
2. **Audit (before any fitting).** Per camera: points, events, distances,
   coverage of the image (quadrants, distance rings from the centre), pick
   methods, duplicates. Flags per point, each with a reason:
   - *exclude* (left out by default, can be forced back in):
     - **wrong-side**: the LiDAR point is more than 110° from the camera's provisional axis, but the pixel is near the image centre;
     - **too-close**: less than 0.2 m away;
     - **unknown-channel**.
   - *review* (kept in the fit, only flagged):
     - **close-range**: closer than 3 m, where an unknown 5 cm lever arm moves the pixel by f·0.05/d;
     - **may-move**: vehicles, plants, curtains and so on;
     - **image-edge**;
     - **quality** not "good";
     - **duplicate**;
     - with the point cloud only: **sparse-lidar** (≤ 2 points within 5 cm of a nearest-point pick) and **occluded** (≥ 10 points on the line of sight).

   Nothing is deleted automatically. A large error under the old model alone is not a flag.
3. **Stage A: rotation only.** Fit yaw, pitch and roll per camera:
   - start from ch14 (−90°, 0, 0) and ch18 (+90°, 0, 0);
   - lens fixed (f 750, cx 1999.5, cy 1449.5);
   - `scipy.optimize.least_squares` (trf), robust soft-L1 loss with a 20 px scale;
   - bounds: ±45° yaw and ±30° pitch/roll around the start, wide enough not to bias the fit and narrow enough to exclude mirror solutions.
4. **Stage B: rotation and one focal parameter** per camera. It starts from Stage A,
   with f bounded to 600–1100 px/rad. cx and cy stay fixed (unknown, assumed at the image centre),
   with no distortion terms and no lever arm. Unknowns are never all optimised at once.
5. **Validation.** Leave one event out for each stage and camera. A fold is skipped and
   reported when the remaining data can't identify the parameters. The
   recommended set per camera has the lowest held-out median error,
   never the lowest training error.
6. **Uncertainty and sensitivity.**
   - 1σ and correlations from the Jacobian (central differences), condition number.
   - Range of each parameter over the validation folds.
   - Shifts with a ±5 cm lever arm along each body axis.
   - Other losses (linear, Huber, soft-L1 10/40 px, Cauchy).
   - Four starting points (local minima).
   - Refit on the records without review flags.
   - Refit without the fit's own outliers.

   Outliers are errors above max(3 × median, 40 px). They are listed, kept in the fit, and
   down-weighted by the robust loss.

   A parameter counts as **estimated (experimental)** only if all of these hold:
   - angles: 1σ < 2°, fold range < 5°, lever-arm shift < 3°;
   - f: 1σ < 40 px/rad, fold range < 10 %, lever-arm shift < 60 px/rad;
   - no local minima, not at a bound, and at least 3 folds.

   Otherwise it is **poorly constrained**.
7. **Independent image check** (command line, optional `--image-check RUN`). It renders the
   coloured LiDAR through each parameter set and correlates it with the grey
   photo (NCC at 400 × 300, inside the usable circle, points 0.5–30 m). It uses up to 24 evenly spaced
   events that were *not* used for fitting. Whole-image evidence,
   independent of the hand-picked points.

## Commands

```bash
# needs scipy in the backend venv: backend/.venv/bin/pip install -r backend/requirements.txt
REC=<recording>/reconstruction/xgrids
backend/.venv/bin/python scripts/xgrids/calibrate_cameras.py "$REC/calibration/inputs/correspondences-….json" \
    --out "$REC/calibration/experiments" --dataset-id builtin-basel-house \
    --poses public/datasets/basel-house/poses.csv --runs-dir "$REC/images" \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
    --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json \
    --image-check interval-10s            # optional, about 3 minutes
# --audit-only, --exclude ID …, --include ID … (force an excluded record in)
# ids are separate arguments; an unknown id is refused (in zsh, "${IDS[@]}" from an array, not "$IDS")

# Lab 13W: compare experiments (first = baseline); --out outside the repo, never overwritten
python3 scripts/xgrids/compare_experiments.py BASELINE.json OTHER.json … [--out report.json]

backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py -v
SPATIAL_LAB_CORRESPONDENCES=<export.json> backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py
```

`--out` inside the repository is refused, and files are created with mode "x"
(never overwritten): `audit-<sha8>.json` and `experiment-<id>.json`. The id is
`x_` + 12 hex digits of SHA-256 over the source hash, the records used,
the solver configuration and the module version. The same inputs therefore give the same id,
and everything except `created` is identical.

**In the app**: `/camera-calibration` → *Calibration optimization*.
1. Load a correspondence export, or use this browser's records.
2. The audit runs automatically. Tick or untick points if needed. Points excluded in the correspondence review (Lab 13W) start unticked, flagged `user-excluded`.
3. Press *Run optimization (experimental)*.
4. Compare the tables, and switch the image markers and overlay between Provisional, Stage A and Stage B.
5. Export or import experiment JSON.

The app's runs don't include the LiDAR-support or image checks (no point cloud in the request). Import a
CLI experiment to see them. Backend: `POST /xgrids/calibration/audit` and
`POST /xgrids/calibration/experiments` are stateless: the body is the export's text (≤ 5 MB), nothing is
stored, and identity mismatches give 422.

**Tests** (`tests/xgrids/test_camera_calibration.py`, 22, synthetic data, skipped without SciPy; Lab 13W added review fields, user exclusion, unknown exclude ids and image regions):
- conventions: quaternion order against SciPy, the documented offset matrices, angle meanings, projection axes and inverse, agreement with the frontend, the lever-arm frame;
- input checks: identity and hash, per-record rejection, run cross-check;
- recovery: Stage A recovers the rotation; Stage B recovers f with noise and with deliberate 300 px outliers;
- validation: leave-one-event-out never trains on the held-out event, and insufficient folds are reported;
- determinism and export round trip;
- audit flags;
- the image check prefers the true parameters;
- optional: a real export reproduces the app's recorded predictions.

## Experiment format (`spatial-lab/xgrids-calibration-experiment` v1)

| Key | Contents |
| --- | --- |
| `schema`, `version`, `experimentId`, `created`, `status` | identity; `status` always says experimental |
| `source` | file name, its SHA-256, dataset (id, name, posesSha256), all record ids, records rejected on load, excluded ids with reasons, events |
| `conventions` | the frames and formulas above |
| `initial` | provisional model and orientations (status "assumed") |
| `solver` | library, configuration (loss, scale, bounds, outlier rule), stages and their free parameters, what is fixed (cx, cy, lever arm 0, time offset 0), identifiability limits, software versions |
| `audit` | the full audit report |
| `cameras.<ch>` | records, events, provisional evaluation, `stages.A/B` (parameters, σ, correlation, condition number, bounds hit, training errors, validation folds with held-out errors and parameter ranges, sensitivity, identifiability), held-out comparison and recommendation |
| `parameterSets` | provisional / stageA / stageB per channel in the app's shapes (`orientation`, `model` with `status` "assumed" or "experimental-estimate", `parameterStatus`) |
| `independentChecks.imageAgreement` | optional: NCC per photo and set, means and wins per camera |
| `warnings`, `limitations` | plain-language caveats |

## Basel House results (experiment `x_652068cf70da`, 2026-10-15)

Input: `correspondences-builtin-basel-house-2026-10-15.json` (19 records, 8
events, SHA-256 42b9db39…). It is kept read-only, as a copy outside Git, in
`<recording>/reconstruction/xgrids/calibration/inputs/`. Its pose-file hash
equals `public/datasets/basel-house/poses.csv`, and all 19 records match their run manifest.

**Audit findings**
- ch14: 9 points in 7 events, 0.7–8.7 m (median 1.9 m), 6 closer than 3 m.
- ch18: 10 points (9 usable) in 8 events, 1.9–11.6 m (median 2.8 m), 5 closer than 3 m.
- Image coverage: most points lie within 800 px of the centre. There is little information about the outer field of view.
- #11 (3037 ch18, "top right window pane", c_249d61c76f93) is **excluded: wrong-side**.
  - Its LiDAR point is 16.2 m away on the scanner's *left*, 172° from ch18's axis, while the pixel is 12° from the image centre.
  - It is also an isolated LiDAR point (sparse-lidar).
  - Most likely the pick landed on a window across the courtyard. Re-pick it before using it.
- #16 (2317 ch14, vehicle rear lights) is flagged close-range (1.2 m) and may-move.
  It is an outlier under Stage B (67 px; 116 px when held out). A parked vehicle is fine if it didn't move; at 1.2 m the lever arm alone can shift it by about 40 px.
- #1 (brown shelf, 1.0 m) and #5 (white board, 0.68 m) are close-range. They are the other two ch14 outliers.
  #1 stays at 245 px under every model, which suggests the 3D pick is on another part of the shelf.
- #6 (curtain) and #8 (palm) are flagged may-move. Both fit well under Stage B (38 px, 12 px).
- No duplicates, and the lines of sight are clear (at most 3 points on a line).

**Fits** (px; held out = leave one event out, 7 folds for ch14 and 8 for ch18, none skipped)

| Camera | Set | yaw, pitch, roll (°) | f (px/rad) | training median / RMS | held-out median / RMS |
| --- | --- | --- | --- | --- | --- |
| ch14 | provisional | −90, 0, 0 | 750 (assumed) | 79.8 / 136.9 | 79.8 / 136.9 |
| ch14 | Stage A | −86.1, 0.9, −3.9 | 750 (fixed) | 90.2 / 129.9 | 92.8 / 145.5 |
| ch14 | **Stage B** | −88.3 ± 1.6, 3.0 ± 1.7, −1.3 ± 2.5 | 927 ± 41 | 20.4 / 91.9 | **27.7 / 100.8** |
| ch18 | provisional | +90, 0, 0 | 750 (assumed) | 66.4 / 101.6 | 66.4 / 101.6 |
| ch18 | Stage A | 93.3, 1.8, 0.4 | 750 (fixed) | 88.6 / 94.9 | 97.9 / 103.2 |
| ch18 | **Stage B** | 89.4 ± 0.5, 4.0 ± 0.5, 0.6 ± 0.9 | 955 ± 15 | 23.1 / 25.7 | **34.6 / 37.2** |

- **Stage A does not help.** A rotation alone can't fix a wrong lens. The angle in the image is
  1.2–1.3 × the true angle under f = 750, so the fit trades errors around.
  Its angles are poorly constrained.
- **Stage B helps on held-out data**. Held-out median errors fall from 80 to 28 px (ch14) and from 66 to 35 px (ch18).
  The two cameras agree on f within 3 % (927 vs 955; 947 for ch14 without its outliers).
- **ch18 Stage B**: every parameter passes the identifiability limits ("estimated (experimental)").
  - Fold ranges: yaw 0.5°, pitch 1.0°, roll 2.8°, f 17 px/rad.
  - A 5 cm lever arm moves f by 13 px/rad.
  - The loss function changes it by 1 px/rad.
  - The four starting points end at the same solution.
- **ch14 Stage B**: yaw and pitch pass. Roll (σ 2.5°) and f (σ 41 px/rad, just over 40) are **poorly constrained**.
  The σ is inflated by the three close-range outliers. Without them: −88.9°, 2.7°, 0.2°, f 947.
- Points ≥ 3 m away fit to 9–36 px under Stage B (ch18 #10/#13/#17/#19: 11, 9, 23, 11 px).
  The largest errors are all closer than 3 m, as the unknown lever arm predicts.

**Independent checks**
- Lab 13U's three validation points come from another export and were not used here.
  Errors for provisional / Stage A / Stage B:
  - 2497 ch14 eave: 14.8 / 28.9 / 20.0 px (slightly worse under Stage B);
  - 2497 ch14 gable apex: 104.3 / 155.5 / 37.1 px;
  - 3037 ch18 notice board: 180.3 / 217.1 / 27.8 px.
- Image check on 24 photos per camera from events not used for fitting (run interval-10s).
  Mean NCC for provisional / Stage A / Stage B, and how often each set scored best:
  - ch14: 0.211 / 0.194 / **0.319**; Stage B best in 20 of 24 photos;
  - ch18: 0.173 / 0.175 / **0.296**; Stage B best in 22 of 24 photos.

**What is trustworthy, and what is not.**
- **Supported by the data:**
  - f is around 930–960 px/rad, not 750, for both cameras;
  - ch18 points about yaw +89°, pitch +4°;
  - ch14 points about yaw −88°, pitch +3°.

  The pitch could partly be a lever-arm or principal-point effect.
- **Provisional:**
  - ch14 roll and f;
  - all σ values (they assume independent pick errors);
  - anything about the image edges (few points beyond 800 px from the centre).
- **Unknown (not estimated):**
  - cx, cy;
  - lever arm;
  - distortion beyond the equidistant model;
  - time offset and rolling shutter.

  None of these is identifiable from 9 points per camera, most of them close by.

As a sanity check, f ≈ 940 px/rad with the image circle's radius of about 1425 px gives a field of view of about 174°, plausible for these fisheye modules.

## Lab 13W: sensitivity to the suspicious matches (2026-10-15)

The same 19-point export, solver unchanged (module `13W.1` only adds review fields), image check on run interval-10s. Outputs are in `<recording>/reconstruction/xgrids/calibration/experiments/13w/` (13V's files are untouched); `scripts/xgrids/compare_experiments.py` wrote `13w/comparison-13w.json`.

| Experiment | ch14 Stage B: yaw, pitch, roll (°); f | ch14 training / held-out median px | ch18 Stage B | ch18 training / held-out median px | Mean NCC, Stage B (ch14 / ch18) |
| --- | --- | --- | --- | --- | --- |
| 13V `x_652068cf70da` (#11 auto-excluded) | −88.27 ± 1.6, 3.04 ± 1.7, −1.30 ± 2.5; 927 ± 41 | 20.4 / 27.7 (7 folds) | 89.36 ± 0.5, 4.00 ± 0.5, 0.57 ± 0.9; 955 ± 15 | 23.1 / 34.6 (8 folds) | 0.319 / 0.296 |
| `base` `x_1d7e32542b3e` (13W code, same input) | identical | identical | identical | identical | identical |
| `without-1-5-11-16` `x_e098292b80fe` | −88.94 ± 0.4, 2.69 ± 0.4, 0.23 ± 0.7; 947 ± 12 | 12.2 / 25.9 (5 folds) | unchanged (none of the four is ch18-usable) | unchanged | 0.313 / 0.296 |
| `far-only-3m` `x_1e2813bc4975` (11 points < 3 m excluded) | **not run**: 3 points in 2 events | — | 89.62 ± 0.4, 3.90 ± 0.4, 1.63 ± 0.7; 939 ± 13, **not validated** (0 of 4 folds possible) | 10.4 / — | — / 0.294 |

**Do the unreliable points materially affect the solution? Not the values, mainly the uncertainty.**
- Removing #1, #5 and #16 moves ch14's Stage B parameters by 0.2–0.6 σ (yaw −0.7°, pitch −0.4°, roll +1.5°, f +20 px/rad). The σ of roll and f shrink by more than 3× (2.5° → 0.7°, 41 → 12 px/rad). All four ch14 parameters then pass the identifiability limits.
- Training error halves (20 → 12 px). **That is not evidence of a better calibration**: the hardest points were simply removed.
- Held-out error on the six points both experiments share is *slightly worse*: 25.9 px vs 22.6 px. The photo check is unchanged (0.313 vs 0.319; Stage B best in 20 of 24 photos either way).
- Under the experiment without them, #1, #5 and #16 are truly held out at 257, 93 and 109 px. #1 sits 17° from the axis while its pixel is about 6° from the centre (f ≈ 940). Its 3D pick is the likely problem, not the model.
- **The ≥ 3 m subset is too small to say anything.** ch14 has 3 points in 2 events, and ch18's 4 points cannot be validated (leaving one event out leaves too few to fit 4 parameters). ch18's unvalidated values stay within about 1 σ of 13V.

Conclusion: the Lab 13V Stage B result is not driven by the suspicious matches, but its ch14 roll and f uncertainties are. The next experiment needs the expanded dataset, not a different subset of the same 19 points.

## Latest experimental baseline: reviewed export (experiment `x_c69aede71834`, 2026-10-15)

**Input:** `inputs/correspondences-builtin-basel-house-2026-10-15-reviewed.json` (sha256 `e2f89204…`, read-only), the user's export after the Lab 13W review. It has 19 records:
- #1, #5 and the old #16 (now #15) were corrected, keeping their ids, with their history logged;
- the old #11 (the wrong-side window) was deleted, and a new ch18 match was added (`c_bfbbda003715`, 2587 roof, 20 m), so the old #12–#19 are now #11–#18;
- #2, #6, #7, #8, #9, #14 and #17 were also re-picked.

**Validation:**
- Every record passes the backend audit and its run manifest, with the pose hash verified.
- The app's stored predictions are reproduced exactly.
- Nearest-point LiDAR picks are exact preview-cloud points; the two ray-plane picks lie 9 and 13 mm from the nearest point.

**Run:** nothing excluded, solver `13W.1`, image check on run interval-10s.

**Outputs:** `experiments/13w/reviewed-2026-10-15/`, holding the audit, the experiment and `comparison-vs-13v.json`. `experiments/baseline-latest-2026-10-15.json` points to this experiment and records that 13V's `x_652068cf70da` is kept. Both are read-only.

| | ch14 Stage B: yaw, pitch, roll (°); f | ch14 training / held-out median px | ch18 Stage B | ch18 training / held-out median px | Mean NCC, Stage B (ch14 / ch18) |
| --- | --- | --- | --- | --- | --- |
| 13V `x_652068cf70da` | −88.27 ± 1.6, 3.04 ± 1.7, −1.30 ± 2.5; 927 ± 41 | 20.4 / 27.7 (7 folds) | 89.36 ± 0.5, 4.00 ± 0.5, 0.57 ± 0.9; 955 ± 15 | 23.1 / 34.6 (8 folds) | 0.319 / 0.296 |
| **baseline** `x_c69aede71834` | −88.95 ± 0.26, 2.89 ± 0.28, 0.37 ± 0.41; 961 ± 7.5 | 12.8 / 18.1 (7 folds, RMS 19.4) | 89.44 ± 0.30, 4.33 ± 0.31, 0.77 ± 0.55; 962 ± 9.7 | 12.8 / 16.0 (9 folds, RMS 22.7) | 0.318 / 0.298 |

**What the baseline shows:**
- **Parameters:** every Stage B parameter moved by less than 1 σ of 13V. ch14's f rose by 35 px/rad, and both cameras now agree on f ≈ 961 px/rad. Every parameter passes the identifiability limits ("estimated (experimental)"), and ch14's leave-one-event-out ranges are small (yaw 0.4°, pitch 0.5°, roll 0.6°, f 9 px/rad).
- **Held-out error:** the median fell from 28 to 18 px (ch14) and from 35 to 16 px (ch18).
- **Like-for-like caution:** many coordinates changed, so per-record held-out errors are not a like-for-like comparison with 13V.
- **Independent checks:**
  - The photo check is essentially unchanged: 0.318 / 0.298, with Stage B best in 20 of 24 (ch14) and 22 of 24 (ch18) photos.
  - On the three Lab 13U validation records, none of which is in the fit, the error drops from 20.0, 37.1 and 27.8 px (13V) to 11.4, 32.4 and 24.5 px.
- **Lever arm:** a ±5 cm lever arm shifts f by about 31 px/rad (ch14) or 11 px/rad (ch18), so f absorbs part of the unknown translation.

**Remaining issues (not addressed in this run):**
- **Outlier:** ch18 #3 (`c_ca516a0a5228`, 1663 window sill, 1.85 m) is 40 px in training and 48 px held out.
- **Next largest errors:** ch18 #16 (2317, 36 px held out) and ch14 #7 (0.67 m, 28 px).
- **Close and sparse picks:** six matches are closer than 3 m. #8 (24.8 m) and several far roof picks sit on sparse LiDAR.
- **Coverage:** no point lies beyond 1200 px from the image centre. Each camera has about 9–10 usable matches against the 15–25 target, so the expanded dataset is **not complete**.
- **Not estimated:** the lever arm, principal point, distortion and timing.

The workspace's built-in review reference (`BASELINE_STAGE_B` in `lib/correspondenceReview.ts`) now uses this Stage B. As before, nothing is applied to the main viewer or the Lab 13U presets.

## Limitations

- One recording and 9 usable points per camera, more than half of them closer than 3 m.
- Most picks are nearest-point picks on the preview cloud, approximate to its point spacing.
- Camera centre = scanner position. The lever arm is unknown, and so is any pose or time offset.
  - The hardware photographs show the two opposing lens modules physically away from the scanner reference point (next to a Livox MID-360). Zero is therefore only a temporary working assumption ([calibration-notes.md](calibration-notes.md#hardware-reference-photographs-october-2026)).
  - The photographs support the ≈ ±90° directions. They are not measurements: no translation, channel assignment or intrinsics are taken from them.
- The lens model has a single parameter. The principal point is assumed.
- The optimisation never updates the app's presets or the Lab 13U projection. Sets are applied in the image view of this mode only.

## Next steps

- Re-pick #11. Add 10–20 points per camera at 4–15 m, spread over the whole image circle, including 800–1300 px from the centre. The Lab 13W review list and coverage panel ([correspondences.md](correspondences.md#review-and-coverage-lab-13w)) track this; the expanded dataset is **not complete** until those matches are collected and verified by hand.
- Then rerun the same experiment on the new export and compare it with `compare_experiments.py 13V.json NEW.json`.
- Then try cx and cy (Stage C) and a lever arm, each with the same validation.
  - The camera-to-scanner translation must eventually be **measured** (manufacturer data or factory calibration, or a physical measurement related to the pose reference point) or **estimated** in a validated stage.
  - Compare an estimated lever arm with the hardware layout only as a plausibility check.
- Only after that compare against a richer fisheye model, such as Kannala–Brandt with k1.
