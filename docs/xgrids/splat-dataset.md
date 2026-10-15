# Gaussian splatting dataset from XGRIDS frames (Lab 14A)

Lab 14A turns raw XGRIDS camera frames and scanner poses into a training dataset for a first Gaussian splatting experiment.

**Scope:**
- It prepares and validates data only. Nothing was trained, no GPU was rented and nothing was uploaded.
- Every camera parameter comes from the **experimental** calibration baseline `x_c69aede71834` ([calibration-experiments.md](calibration-experiments.md#latest-experimental-baseline-reviewed-export-experiment-x_c69aede71834-2026-10-15)). None of it is manufacturer data.

## In plain words: from camera frames to a training dataset

A Gaussian splatting trainer needs three things:
- **photos;**
- **for every photo, where the camera was and which way it pointed** (its pose), plus how the lens maps directions to pixels (its intrinsics);
- optionally, **starting points** in 3D.

It then grows millions of small coloured blobs ("Gaussians") until rendering them from each photo's pose reproduces that photo.

Our recording gives us each of these indirectly:

1. **Photos.** The `.xbin` holds 7,295 synchronised pairs of 4000 × 3000 frames from two fisheye cameras, ch14 and ch18. `extract_frames.py` (Lab 13Q) decodes only the pairs we ask for.
2. **Poses.**
   - **Scanner poses.** `poses.csv` gives the **scanner's** position and orientation 10 times per second. For each photo we interpolate the scanner pose at the photo's exact timestamp.
   - **Camera poses.** A camera is not the scanner, so we then apply the camera's rotation relative to the scanner, estimated in Lab 13V/13W. That gives the camera pose.
   - **Lever arm.** The camera's small offset from the scanner (the "lever arm") is unknown, so for now we put the camera exactly at the scanner position.
3. **Lens.** The fisheye lenses see about 167°. The trainer we use (Nerfstudio `splatfacto`) can only render ordinary "pinhole" cameras.
   - **Crop:** we cut a normal-looking 110° × 94° perspective picture out of each fisheye photo. Every output pixel looks up the fisheye pixel that saw the same direction, using the calibrated lens model.
   - **Same viewpoint:** the crop is taken from the same optical centre, so it adds no new viewpoint; it is the same photo, re-projected.
   - **Lean forward:** we turn each crop 12° towards the scanner's forward direction, because the operator and the device appear on the backward side of both fisheyes.
4. **Starting points.** The LiDAR scan already knows where surfaces are. We hand the trainer a thinned million LiDAR points as initial Gaussians, instead of making it discover the geometry from scratch.
5. **Checks.** Before paying for a GPU we check, independently, everything that could silently ruin training:
   - flipped or swapped cameras;
   - wrong pixel conventions;
   - images that don't match their poses;
   - duplicates and poor overlap.

## Pipeline and exact commands

All outputs are written next to the recording (`<recording>/reconstruction/…`), outside Git. Nothing is overwritten:
- the selection, dataset and checks refuse to write to an existing path;
- the `.xbin`, LAS, `poses.csv`, correspondence exports and calibration experiments are only read.

```bash
REC=~/Downloads/BM_Heritage_Basel_House_2026-07-15-101012
R=$REC/reconstruction
PY=backend/.venv/bin/python        # NumPy, SciPy, Pillow (backend/requirements.txt); no OpenCV needed

# 1. Choose events: 7.5–18 min, one per 5 s slot (steadiest event within ±1 s), correspondence events kept
$PY scripts/xgrids/select_splat_frames.py --from-min 7.5 --to-min 18 --interval 5 \
    --anchors $R/xgrids/calibration/inputs/correspondences-builtin-basel-house-2026-10-15-reviewed.json \
    --out $R/training/lab14a/selection-5s.json
# 2. Decode them with the existing extractor (both cameras, interpolated scanner poses)
SEQ=$(python3 -c "import json;print(json.load(open('$R/training/lab14a/selection-5s.json'))['sequences'])")
python3 scripts/xgrids/extract_frames.py $REC/2026-07-15-101012-003.xbin --sequences "$SEQ" --run-name lab14a-5s
# 3. Build the dataset (perspective views, COLMAP model, LiDAR initial points, manifest)
$PY scripts/xgrids/prepare_splat_dataset.py --run $R/xgrids/images/lab14a-5s \
    --selection $R/training/lab14a/selection-5s.json \
    --experiment $R/xgrids/calibration/experiments/13w/reviewed-2026-10-15/experiment-x_c69aede71834.json \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
    --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json \
    --out $R/training/lab14a/basel-5s-forward12
# 4. Preflight checks (writes <dataset>/checks/)
$PY scripts/xgrids/validate_splat_dataset.py $R/training/lab14a/basel-5s-forward12 \
    --correspondences $R/xgrids/calibration/inputs/correspondences-builtin-basel-house-2026-10-15-reviewed.json \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
    --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json
```

**Basel run times (MacBook):**
- selection: < 1 s;
- extraction: 52 s, 254 images, all `ok`;
- dataset: 2 min 36 s, 6 worker processes;
- validation: 4 min 20 s.

## Choosing the frames

**Window: minutes 7.5–18 after the first pose.** That is 10.5 minutes and 195 m of walking. It covers:
- the south-west interior rooms (offices, around minute 8–9);
- the south corridor;
- the east wing inside and out;
- the courtyard loop (minutes 14–16.5).

All 19 hand-picked correspondences fall in this window, so the dataset can be checked against them directly. The whole recording (40 min, 804 m) is not extracted.

**Sampling interval.** The scanner moved at a median 0.32 m/s and turns often, so time alone is a weak guide. Measured on this window with the calibrated cameras:

| Interval | Events (images) | Median step between events | Median turn | Steps > 2 m | Camera directions not continued by either camera of the next event (> 60°) |
| --- | --- | --- | --- | --- | --- |
| 10 s (Lab 13Q's run) | 64 (128) | 2.60 m | 49° | 44 | 19 % |
| **5 s (chosen)** | **127 (254)** | **1.47 m** | **29°** | 27 | **17 %** |
| 3 s | 207 (414) | 0.89 m | 17° | 8 | 11 % |
| 2 s | 270 (540) | 0.70 m | 16° | 1 | 10 % |

**Is denser sampling better?**
- **10 s is too sparse.** Consecutive views of a camera are 2.6 m and about 50° apart, which in 3–4 m rooms leaves little overlap.
- **5 s is enough for a first experiment.** No view is isolated (see covisibility below), and it halves the work of 3 s.
- **3 s gives clearly better continuity** (11 % against 17 % of directions lost between events). It is the first thing to try if the 5 s result shows holes or floaters indoors: rerun steps 1–4 with `--interval 3`.
- **Below 3 s the gain is small:** 2 s is 10 %.

**Rules inside the window:**
- In each 5 s slot, the event within ±1 s with the lowest scanner turn rate is taken. This means less motion blur and less sensitivity to an unknown camera time offset.
- A correspondence event inside a slot's window replaces that slot's pick.
- Slot events that moved < 0.3 m **and** turned < 10° since the last kept event are dropped as near-duplicates; there were none here.
- The selection JSON keeps, per event:
  - the sequence and pair id;
  - both exact timestamps and their difference;
  - the position and turn rate;
  - the step from the previous event;
  - the reason it was kept (`slot` or `anchor`).
- Source offsets (`sps_offset`, `message_offset`, `h264_bytes`) and hashes come from the extraction manifest and are copied into the dataset manifest.

## Camera poses

Conventions are implemented once in `scripts/xgrids/splat_geometry.py`. It reuses `backend/camera_calibration.py`, so the calibration and the dataset can't drift apart. Frames, in order:

| Frame | Axes | Relation |
| --- | --- | --- |
| LAS (world) | original LAS axes, metres, Z up | unchanged; no global transform |
| scanner body | X forward, Y left, Z up | `v_las = R(q)·v_body + p` (`poses.csv`, q = x, y, z, w) |
| fisheye camera F | X optical axis, Y image left, Z image up | `v_body = R_off·v_F`, `R_off = Rz(−yaw)·Ry(−pitch)·Rx(roll)` (Stage B values) |
| fisheye OpenCV | x right, y down, z optical axis | `R_F_CV = [[0,0,1],[−1,0,0],[0,−1,0]]` (columns = cv axes in F) |
| view (OpenCV) | x right, y down, z forward | `R_cv_view = Ry(viewYaw)·Rx(viewPitch)`; yaw + = image right |

**Camera-to-world** (OpenCV): `R = R(q)·R_off·R_F_CV·R_cv_view`, centre `C = p + R(q)·leverArm` (lever arm 0).

**COLMAP** stores world-to-camera: `R_w2c = Rᵀ`, `t = −Rᵀ·C`, quaternion (w, x, y, z).

**Scanner pose ≠ camera pose.** Each manifest entry keeps both:
- `scannerPose`: the interpolated scanner pose;
- `cameraToWorldOpenCV`: the derived camera pose for that view.

**Zero-lever-arm approximation:**
- Every view's centre is the scanner position at the photo time.
- The hardware photographs show the lens modules some centimetres from the pose reference point, so every view is misplaced by that much, in a fixed direction relative to the scanner.
- **Size of the effect:** 5 cm is about 3° of parallax at 1 m, 0.7° at 4 m and 0.1° at 20 m.
  - Most views in this dataset look at surfaces 2–6 m away (median LiDAR depth 3.7 m), so expect a fraction of a degree to about a degree of inconsistency. That is comparable to the calibration residuals (median 0.74°).
  - Only 1 view has a median depth below 1.5 m.
- **Training consequence:** expect softer detail and some floaters near the walls of small rooms, not a broken reconstruction. Camera-pose refinement in the trainer (`--pipeline.model.camera-optimizer.mode SO3xR3`) can absorb part of it, so try it as a second run.

## Fisheye handling

**What the trainer actually supports.** Read in the Nerfstudio 1.1.5 source, the version pinned by Lab 10C:
- `splatfacto` rasterises **pinhole cameras only**: gsplat `rasterization` with a 3 × 3 K and no camera-model argument.
- A COLMAP `OPENCV_FISHEYE` camera is undistorted when it is loaded (`full_images_datamanager._undistort_image`), using `cv2.fisheye.estimateNewCameraMatrixForUndistortRectify(…, balance=0)` into an image of the same size.
- For a ~167° lens this either crops most of the view or stretches the edges badly, and we would not control the geometry.

**Other options:**
- **Native fisheye rasterisation** exists in newer gsplat (`camera_model="fisheye"`, and 3DGUT for distorted cameras), but not in the pinned Nerfstudio.
- Labelling the fisheye photos as pinhole would be simply wrong.

**Chosen: our own perspective views.** This is the simplest technically sound option:
- **Resampling:** every view pixel's ray is `K⁻¹·(u, v, 1)`, turned into the fisheye frame, then projected with the equidistant model `r = f·θ` (f = 961.44 / 961.53 px/rad).
- **Filtering:** the fisheye is sampled bilinearly after a light blur (radius 0.8 px), because the view is about 1.7× coarser at its centre.
- **Format:** JPEG quality 95, 4:4:4.

**View geometry** (`forward12` layout):

| | Value |
| --- | --- |
| Size | 1600 × 1200 |
| Field of view | 110° × 94.4° |
| Focal length | 560.17 px |
| Principal point | (800, 600) in COLMAP's corner-origin pixels = (799.5, 599.5) OpenCV |
| Direction | turned 12° towards scanner-forward (image right for ch14, image left for ch18; derived from the calibration, not hard-coded) |
| Furthest fisheye pixel used | 1183 px from the centre (usable radius 1400 px) |
| Masks | none needed |

**Why lean forward:**
- Over all 254 frames, the operator and device are dark in ≥ 30 % of frames from about 800 px outward, on the backward side of each fisheye.
- A centred 110° view would touch that zone (2.6–3.9 % of its pixels). Turned 12° forward it doesn't (0 %).
- Transient appearances (the operator's shadow, passers-by) remain possible.

**Wider coverage, if needed later:**
- `--layout forward12+wing` adds a narrow forward view that reaches the fisheye edge.
- Its out-of-circle pixels are written as `masks/*.png` (pass `--masks-path masks` to Nerfstudio).
- It is not used for the first experiment.

**Effect of uncertain intrinsics:**
- **f:** a ±8 px/rad error (Stage B σ) moves a ray by θ·Δf/f: about 0.1° near the view centre (the view is turned 12° off the fisheye axis) and about 0.6° at the corners. That is up to about 15–20 view pixels at the far edge, and a few pixels over the central half.
- **Principal point:** an error acts mostly like a small extra rotation, which the fitted rotation partly absorbed.
- **Distortion:** distortion beyond equidistant is unmodelled. In the views straight edges look straight (checked on the reprojection overlays), but subtle curvature can't be excluded.
- **Combined:** the measured combined effect is the correspondence residual: median 0.74° in the views.

## The dataset

`<recording>/reconstruction/training/lab14a/basel-5s-forward12/` (266 MB):

| Path | Content |
| --- | --- |
| `images/seq01393_ch14_c.jpg` … | 254 views (127 events × ch14 + ch18), 119 MB |
| `sparse/0/cameras, images, points3D` (`.bin` and `.txt`, identical) | 1 PINHOLE camera, 254 poses, 1,000,000 LiDAR points (no tracks) |
| `sparse/poses-only/` | same cameras and poses, no points: random initialisation or COLMAP `point_triangulator` with fixed poses later |
| `lidar_init.ply` | the same LiDAR points (float xyz, uchar rgb) |
| `manifest.json` | per view: source frame and channel, sequence, pair id, timestamp, source JPEG hash, H.264 offsets, scanner pose, camera-to-world, COLMAP pose, split; plus conventions, assumptions, calibration (id, file hash, values), layout, point-cloud provenance |
| `SHA256SUMS` | every file |
| `checks/` | validation report and visual checks (below) |

**Initial points:**
- **Source:** the verified 5 M-point preview of `map-002.las` (`basel-preview-5m.bin`, LAS = stored + `coordinateCenter`).
- **Filtering:**
  1. kept within 25 m of a camera (5.02 M);
  2. averaged per 5 cm voxel (1.98 M);
  3. dropped voxels with fewer than 2 neighbours within 20 cm (1.95 M);
  4. randomly thinned to 1 M (seed 14).
- **LAS untouched:** the original LAS was not modified. A denser initialisation straight from the LAS is possible later.

**Split:** every 9th image id is held out (29 views, 15 ch14 / 14 ch18), exactly Nerfstudio's `--eval-mode interval --eval-interval 9`. An interval of 8 would have held out ch14 only, because ids alternate ch14/ch18.

## Validation results (preflight)

Verdict: **pass with warnings**, and no failures. The full report is `checks/validation.json`.

| Check | Result |
| --- | --- |
| checksums | 268 files, 0 mismatches |
| COLMAP structure | 1 PINHOLE camera, ids 1…254, `.bin` = `.txt`, files = model = manifest |
| image count and size | 254 = 127 × 2 × 1, all JPEG 1600 × 1200 |
| timestamps and pairs | 127/127 events with both cameras; pair Δt ≤ 24 µs; times increasing; inside the pose range; `poses.csv` and source JPEG hashes match |
| rotations | all proper rotations (det 1 ± 1e−15): right-handed |
| centres vs trajectory | ≤ 0.001 mm from the scanner position interpolated independently (SciPy Slerp) |
| camera directions | ch14 looks to the scanner's left, ch18 to its right (axis·body ±Y ≥ 0.973) |
| image up | image-up·world-up median 0.982, min 0.952: no upside-down or sideways views |
| rigid rig | ch14 ↔ ch18 relative rotation constant; 154.4° between the two views |
| hand-picked correspondences | 19 on dataset frames, 17 inside the views; error median 8.7 view px / 0.74°, equal to the Stage B fisheye residual (the conversion adds nothing). Largest: ch18 #3 window sill (1663) 30.6 px / 2.3°, the known outlier |
| view pixels vs original fisheye | grey difference 0.68 (max 1.04) at 400 random pixels of 13 views, rays taken from the COLMAP files; 84.8 with the view rotated 180° |
| LiDAR rendering vs photo | NCC 0.397 with the dataset poses; −0.013 rolled 180°; 0.028 with the other camera's direction; dataset pose best in 243/254 views |
| covisibility | median best-partner overlap 51 % of visible 20 cm voxels; 214/254 views have ≥ 3 partners sharing ≥ 30 %; no isolated view; 121,558 voxels seen by ≥ 3 views |
| scene depth | median 3.7 m (5th pct 1.9 m); 1 view < 1.5 m |
| sharpness (warn) | 33 views below a third of the median Laplacian variance. Rank correlation with the turn rate −0.10, and on inspection they are plain walls and doors, not motion blur |
| exposure (warn) | 8 views with > 25 % clipped (bright sky) or > 50 % near-black pixels |
| near-duplicates | 0 |
| pose continuity (warn) | step median 1.47 m (max 4.0 m), turn median 29°; 11 turns > 90° (the operator turning round); 43 of 252 camera directions not continued by the next event |
| coverage | camera centres span 36.9 × 28.2 × 2.3 m; 195 m path |

**Visual checks** in `checks/`:
- **`topdown-cameras.png`:** a LiDAR slice with every view's centre, axis and field edges (red ch14, blue ch18, orange = held out, green ring = correspondence event).
- **`reprojection/*.png`:** 8 views beside the LiDAR rendered through the same COLMAP camera, with the photo's edges overlaid in yellow and correspondence markers. Building edges, window arches and roof lines coincide.
- **`contact-sheet.jpg`:** every view. These images can show people; they stay outside Git and out of reports.

## Preflight report

1. **Pipeline:** Nerfstudio 1.1.5 `splatfacto`, through the COLMAP dataparser, as packaged in Lab 10C (`backend/cloud_training/`). It is pinned and documented, and reads COLMAP models with LiDAR points directly. The dataset is plain COLMAP PINHOLE, so other trainers (gsplat's `simple_trainer`, the original 3DGS, Brush, Postshot) can read it too.
2. **Size:** 127 synchronised pairs, giving 254 views (225 train, 29 held out).
3. **Storage:**
   - dataset 266 MB (images 119 MB; the LiDAR points are stored three times, `.bin` 49 MB, `.txt` 81 MB and `.ply` 14 MB);
   - source extraction 236 MB;
   - an upload package without `points3D.txt` would be about 185 MB.
4. **Camera model:** perspective PINHOLE views 1600 × 1200, 110° × 94°, f = 560.17 px, re-projected from the equidistant fisheye (f ≈ 961 px/rad) about the same optical centre; no masks.
5. **Assumptions:**
   - experimental Stage B rotations and f;
   - principal point at the image centre;
   - no distortion beyond equidistant;
   - lever arm 0;
   - no camera–pose time offset;
   - rolling shutter ignored;
   - auto-exposure differences between frames uncorrected (splatfacto has no per-image appearance model).
6. **Validation:** above. All geometric checks pass; the warnings are about content (plain walls, bright sky) and the 5 s spacing.
7. **Blocking problems:** none found.
8. **GPU and cost (estimates, not measurements):**
   - **Hardware:** one 24 GB NVIDIA GPU (RTX 4090 or 3090), the same as Lab 10C.
   - **Memory:** about 1.5 GB of cached images plus 1–4 M Gaussians, so about 8–16 GB peak.
   - **Time:** splatfacto 30,000 iterations takes about 20–45 min on a 4090; the quick 7,000-iteration run about 5–12 min.
   - **Cost:** a first session (setup, smoke, quick, quality, download) is about 1–1.5 h, about **$0.50–1.50** at the Runpod prices recorded in Lab 10C ($0.34–0.74/h for a 4090), plus about $0.01/h of disk. Check the live price before deploying.
9. **Steps for Lab 14B** (only after your approval):
   1. Copy `backend/cloud_training/train.sh` and `setup_env.sh` next to the dataset.
   2. Change its `ns-train` call to:
      `colmap --colmap-path sparse/0 --images-path images --downscale-factor 1 --assume-colmap-world-coordinate-convention False --orientation-method none --center-method poses --auto-scale-poses True --eval-mode interval --eval-interval 9 --load-3D-points True`.
      - **Why these flags:**
        - our world is already Z-up, so COLMAP's y-down world guess and the automatic re-orientation must be off;
        - centring and scaling stay on and are recorded in `dataparser_transforms.json`, so the result can be mapped back to LAS;
        - the eval interval of 9 matches the manifest.
   3. Package the dataset without `points3D.txt` and `checks/`, and keep `SHA256SUMS` for the remaining files.
   4. With your approval, rent one 24 GB GPU, upload, run `setup_env.sh`, then `train.sh smoke` → `quick` → `quality`.
   5. Compare held-out PSNR/SSIM/LPIPS and the eval renders. Optionally run a second quick run with `--pipeline.model.camera-optimizer.mode SO3xR3` (pose refinement) and one with `--pipeline.model.random-init True` (random initialisation), to see what the LiDAR points and the pose errors contribute.
   6. Download the PLY. Import it later with the inverse of `dataparser_transforms.json`, to place it in the LAS frame.

**Still unknown, and whether it blocks the first experiment:**

| Unknown | Effect | Blocks? |
| --- | --- | --- |
| Lever arm (lens offset from the pose point) | sub-degree to about 1° inconsistency at 2–5 m; worse very close | no: tolerable, pose refinement can absorb part |
| Principal point, distortion | up to about 0.5° at the view edges | no |
| Camera–pose time offset, rolling shutter | small at the low turn rates selected (median 4°/s) | no |
| Exposure differences between frames | colour flicker or floaters in a few views | no |
| Which physical module is ch14/ch18 | none for training (each channel has its own calibration) | no |
| Expanded correspondence set (15–25 per camera) | would tighten the calibration | no, but it limits the final sharpness |

**Recommendation: GO** for a first Lab 14B experiment on this dataset, after your explicit approval of the GPU rental and upload. Expect a navigable but somewhat soft reconstruction; the experiment tests whether the independent pipeline holds together, not the final quality.

## Tests

```bash
backend/.venv/bin/python -m unittest tests/xgrids/test_splat_dataset.py -v   # 13 tests, synthetic data
backend/.venv/bin/python -m unittest discover tests/xgrids                   # 48 tests (1 skipped)
```

They cover:
- the fisheye ↔ OpenCV axes;
- the view yaw and pitch signs;
- the forward side derived from the calibration;
- pinhole projection = fisheye projection mapped into the view (random poses, < 1e−6 px);
- the lever-arm direction;
- the COLMAP quaternion round trip, including 180° rotations;
- COLMAP's principal-point convention;
- layouts inside the usable circle;
- COLMAP text and binary round trips, and the PLY;
- resampling: a bright dot lands where the geometry says (< 1.5 px);
- point cropping and voxel thinning;
- selection: still periods thinned, anchors kept and replacing their slot.
