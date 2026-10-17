# XGRIDS investigation log

A dated record of what was tried on the XGRIDS recordings, what was found and what turned out wrong. The current understanding lives in [xbag-format.md](xbag-format.md). This log keeps the history, so conclusions can be traced back to evidence.

Recording: Basel House, `2026-07-15-101012-003.xbin` (13,929,066,496 bytes), LixelKity K1, software V3.1.1_20250826. The raw files are not in Git. Keep `*.xbin`, `*.las` and `project_data/` backed up outside the repository.

## Early experiments (before Lab 13P)

- **Output:** `<recording>/reconstruction/xbin-investigation/`, containing `initial-frame-index.csv`, `first-frame.h264/png`, and sample, pair and timeline folders.
- **Established:**
  - the file starts with `XBAG`;
  - the H.264 SPS `00 00 00 01 67 64 10 3c` is followed by PPS, SEI and IDR;
  - decodable 4000 × 3000 fisheye images;
  - protobuf-like metadata near each image, holding a varint sequence number and a ZigZag µs timestamp;
  - two synchronised streams, with timestamps overlapping `poses.csv`.
- **First 64 MiB:** 116 frames and 56 pairs. Later found to contain errors; see the corrections in [xbag-format.md section 8](xbag-format.md#8-corrections-to-the-early-indexing-experiments).
- **Still unknown at that point:** where records start and end, and whether the bytes from one SPS to the next form a clean image.

## Lab 13P: full indexer (`scripts/xgrids/index_xbin.py`)

- **Strict protobuf decode:** exactly one possible message start, field 5 beginning at the SPS, a single field-6 trailer.
- **Record format discovered:** the 48-byte XBAG record header (count, first and last timestamp, channel). Camera images are 5 per record on channels 14 and 18.
- **64 MiB validation:** 117 frames and 57 pairs. The result is byte-identical with 16 MiB and 4 KiB chunks. Every difference from the experiment is explained (corrections 1, 2 and 5).
- **Full file (22 s, 0.66 GB/s):**
  - 14,590 signatures, all decoded, 0 rejected;
  - 2,918 camera records declaring 14,590 messages;
  - 7,295 pairs, 0 unpaired, sequences 0–7294 on both channels;
  - pair time difference: median 17 µs, maximum 213 µs;
  - one capture every 0.3 s (about 3.0 Hz);
  - 106 frames before the first pose.

## Lab 13Q: selective extraction (`scripts/xgrids/extract_frames.py`)

- **Check inside the recording:** each image's H.264 bytes are a complete stream: SPS, PPS, SEI, SEI, one IDR; High profile, 4000 × 3000, `yuv420p`. `ffprobe` reads exactly one frame.
- **Pose file `poses.csv`:**
  - 24,198 samples, every 100 ms (99,990–100,018 µs);
  - scanner speed: median 0.32 m/s, maximum 1.05 m/s;
  - rotation per 100 ms step: median 1.18°, 99th percentile 5.7°, maximum 11.6°.
- **Events excluded:** 53 capture events (sequences 0–52, 10:10:16.49–10:10:33.88 UTC) lie before the first pose and are excluded. 7,242 events are eligible.
- **Validation (sequences 53, 3674, 7294):** 6/6 images `ok`. For each image:
  - **Linkage:** the image is linked to the right `frames.csv` row (sequence, timestamp, channel, offsets).
  - **JPEG decode:** `ffprobe` reports MJPEG 4000 × 3000; a full decode prints no warnings.
  - **Image fidelity:** PSNR against a fresh decode of the original H.264 bytes is 48.5–50.6 dB (JPEG `-q:v 2`).
  - **Image content:** not blank (thumbnail luminance spread ≥ 57/255). Thumbnails of the two cameras differ by 32–50/255 on average.
  - **Interpolated pose:** matches an independent formula (\(q_0 (q_0^{-1} q_1)^t\) via axis-angle) to 5·10⁻⁷ m and 4·10⁻¹⁰ per quaternion component.
- **Damaged-frame test** (temporary synthetic XBAG holding real H.264 bytes, never committed):
  - a frame cut in half gives "error while decoding MB … / corrupt decoded frame";
  - a frame with 20 KB of zeroed slice data gives only "corrupt decoded frame" at `warning` level, and FFmpeg exits 0;
  - both are flagged `decoded-with-errors`. This led to correction 6.
- **Interval run** (`--interval 10`, default `-q:v 2`): 242 events = 484 images, all `ok`, 92 s, 452 MB.
  - Event spacing 9.59–10.39 s, median 9.994 s.
  - JPEGs 0.52–1.38 MB.
  - PSNR against H.264 48.2–51.7 dB (median 50.1); every image is non-blank (thumbnail luminance spread ≥ 26/255).
  - Pose check as above: 5·10⁻⁷ m and 5·10⁻¹⁰.
  - A rerun gave byte-identical JPEGs (same SHA-256).
- **Fix:** exact SLERP replaced the normalised-blend shortcut (correction 7). The JPEGs were unchanged; quaternions moved by at most 3·10⁻⁷.
- **Not checked by eye in this lab:** the photographs may show people. Whether each view is a sensible fisheye image of the house is for a human to confirm.
- **Untouched files:** the `.xbin`, `map-002.las` and `poses.csv` kept their sizes and modification times. Each summary records `unchanged…` = true.

## Lab 13R: calibration workspace, phase 1 (`/camera-calibration`)

- **Sequence 3665** (the pair verified in the early experiments) is not in `interval-10s`, so it was extracted as its own run (`--sequences 3665`, 2/2 `ok`). The early `pose-test/view-A.png` matches the new ch18 JPEG at 44.3 dB PSNR and `view-B.png` matches ch14 at 45.3 dB; the swapped pairing gives about 14 dB. Same pair, same channel assignment.
- **Frame check:** the runs' `posesSha256` equals the SHA-256 of `public/datasets/basel-house/poses.csv` (ba621b73…), so the manifests' `scanner_*` values are in the Basel LAS frame.
- **Marker position:** the dataset's own poses, interpolated in the browser at each image time, agree with the run's positions to ≤ 0.002 mm. Against the 5M preview, all 242 interval events lie inside the LAS bounds, a median 0.40 m from the nearest point and 1.28 m above the floor beneath (3665: 1.37 m).
- **Not checked by eye:** screenshots of the workspace were taken with the images blurred or hidden. One early screenshot was captured before the blur applied; it was not saved anywhere in the repository.

## Lab 13S: manual visual extrinsics hypothesis test

- **Body frame check:** in `poses.csv`, the scanner's +X is the walking direction (78% of motion samples within 60° of it) and +Z is up (mean 0.98 along world up). So Y is left, as `ScannerBody` assumed.
- **Test set (`interval-10s`):** events were classified from the 5M preview by what lies above the scanner. Courtyard means no point within ±1 m horizontally (2466–2587, 2646–2857, 2977–3067). Indoor means a ceiling about 2.2 m up (e.g. 1335, 4718, 7178). The chosen set is the seeds 2497/2527/3037, 8 more courtyard events and 3 indoor events.
- **Image geometry:** circular fisheye, the image circle about 95% of the image height, centre within about 3% of the image centre (from the mean of 41 images per channel).
- **Numerical comparison:** coloured LiDAR rendered through an equidistant fisheye (assumed f) and compared with the 160 × 120 grey image.
  - Correlation: ch14 is best at yaw −90° and ch18 at +100° (±10°), level, roll 0°.
  - The opposite assignment, forward and backward all score far lower.
  - The sky-overlap score is useless indoors and nearly flat in open courtyards. Grey-level correlation was more robust.
  - Details in [calibration-workspace.md](calibration-workspace.md#result-on-basel-house-october-2026).
- **Operator position:** the operator appears at the left edge of ch14 and the right edge of ch18. That fits left- and right-looking cameras, whose edges both point backward.
- **Images viewed:** small thumbnails (480 × 360) of a few test events were viewed to compare scenes. Nothing was saved to the repository.

## Lab 13U: image ↔ LiDAR correspondence lab

- **Tool:** a correspondence mode in `/camera-calibration` ([correspondences.md](correspondences.md)). Image pixels in original coordinates, LiDAR picks converted back to LAS in float64, records exported as `spatial-lab/xgrids-correspondences` v1.
- **Validation records** (5M preview): 2497 ch14 roof eave end, 2497 ch14 gable apex, 3037 ch18 notice-board corner. Errors under the assumed model and ±90° offsets: 14.8, 104.3 and 180.3 px. A Python check reproduced every LAS point (an exact preview point + offset), scanner pose and predicted pixel.
- **Picking on real data:** at building corners the plane refinement correctly refuses (rms 12 mm against a 6.6 mm limit at 6 cm), so most useful picks are nearest points, labelled approximate. Planar noise of the 5M preview: median about 6 mm at a 5 cm radius.
- **Event 3877** is unsuitable: its ch14 view is a window about 0.5 m away, sparse in the LiDAR, where an unknown lever arm of 10 cm shifts the direction by about 11°.
- **Model hint:** for the ch18 notice board a LiDAR-RGB render through the model is offset from the photo by about (−145, −60) px, matching the app's residual. +100° for ch18 makes that point worse (307.5 px). One point; not a conclusion.
- **Images viewed:** crops and full frames for the three features were viewed to place the clicks; they stayed in `/tmp`, not in the repository.

## Lab 13V: calibration optimization (experimental)

- **Input:** `correspondences-builtin-basel-house-2026-10-15.json` (19 records, 8 events). Pose hash and all run manifests matched; the Python projection reproduces the app's recorded predictions.
- **Audit:** #11 (3037 ch18 window pane) excluded: its LiDAR point lies 16 m away on the scanner's left, 172° from ch18's axis, while the pixel is 12° from the centre; probably picked across the courtyard. 11 of 19 points are closer than 3 m. #16 (vehicle) flagged close-range and may-move.
- **Pattern before fitting:** under f = 750 each pixel's angle from the centre was 1.2–1.3 × the LiDAR point's angle from the axis. That pointed at the lens, not the rotation.
- **Result:** rotation alone (Stage A) doesn't help; rotation + f (Stage B) does, on held-out events and on whole photos not used for fitting. f ≈ 927 (ch14) and 955 (ch18) px/rad. Details: [calibration-experiments.md](calibration-experiments.md).
- **ch14 outliers** are the three closest points (0.68–1.22 m). Refitting without them changes f by 20 px/rad.
- **Pitfall:** a scratch script named `inspect.py` in the working folder shadowed Python's `inspect` module and broke the NumPy import. Don't name scratch files after standard modules.
- **Images viewed:** one ch18 frame in the browser to check the overlay; nothing saved.

## Lab 13W: correspondence quality and dataset preparation

- **Review tool:** the correspondence list now shows distance, height, image region, angle from the axis, the error under a reference Stage B set (the built-in baseline, Lab 13V's until 2026-10-15, or a loaded experiment's) and flags. Matches can be excluded or restored with a reason, marked verified or needs-fix, tagged with a scene, and corrected with their ids kept and the old values logged ([correspondences.md](correspondences.md#review-and-coverage-lab-13w)).
- **Coverage today** (reliable = in fits, no warning): ch14 has 3 (#4, #12, #14) in 2 events, ch18 has 4 (#10, #13, #17, #19) in 4 events, against a 15–25 target. Every reliable match is in the centre third of the image and above the scanner. There is nothing in the outer third and nothing below the scanner. Most other points are flagged only for being closer than 3 m.
- **To revisit:**
  - #1 (1633 ch14 shelf): its LiDAR point is 17° off-axis but its pixel about 6°. Re-pick the 3D point or exclude it.
  - #5 (3187 ch14 whiteboard, 0.68 m): too close; exclude unless re-picked on something farther.
  - #11 (3037 ch18 window pane): wrong side; re-pick the LiDAR point on the window the pixel shows, about 6–7 m away like #10.
  - #16 (2317 ch14 vehicle, 1.2 m): close and possibly moved; exclude.
- **Sensitivity** ([calibration-experiments.md](calibration-experiments.md#lab-13w-sensitivity-to-the-suspicious-matches-2026-10-15)): without #1, #5 and #16, ch14 Stage B moves by under 1 σ and its σ shrinks 3×. Training error halves, but held-out error on shared points and the photo check don't improve. The ≥ 3 m-only subset is too small to fit ch14 or validate ch18.
- **Pitfalls:**
  - In zsh, `--exclude $IDS` passes one argument, because unquoted variables are not word-split. The CLI silently ran the baseline; unknown ids are now refused.
  - The CLI crashed printing a stage with no held-out error; missing values now print as "—".
- **Dataset status:** the expanded real-world dataset is **not complete**. Additional matches will be collected and verified by hand; no automatic check replaces that review.
- **Reviewed export and new baseline (2026-10-15):**
  - **Corrections:** the user corrected #1, #5 and #16 (now #15), keeping their ids, and deleted #11. A 20 m ch18 roof match was added, and seven other matches were re-picked. All records pass the audit and their manifests.
  - **Baseline:** Stage B on this export (`x_c69aede71834`) is the latest experimental baseline. Held-out medians are 18 px (ch14) and 16 px (ch18), against 28 and 35 px for 13V, and both cameras now agree on f ≈ 961. The parameters moved by less than 1 σ.
  - **Independent checks:** the photo check is unchanged, and the three Lab 13U validation records improve slightly.
  - **Remaining:** the ch18 #3 window sill is an outlier at 48 px held out. Close-range and sparse-LiDAR picks remain, and there is no coverage in the outer image. The dataset is still not complete.

## Lab 14A: Gaussian splatting dataset preparation

Full write-up: [splat-dataset.md](splat-dataset.md). Data prepared only: no training, no GPU, no upload.

- **Trainer constraint:** Nerfstudio 1.1.5 `splatfacto` (Lab 10C) renders pinhole cameras only.
  - Its fisheye path undistorts with OpenCV `balance=0` into an image of the same size, which is unusable at our ~167°.
  - So each fisheye frame becomes one 1600 × 1200, 110° × 94° perspective view about the same optical centre, resampled with the Stage B equidistant model of `x_c69aede71834`.
- **Operator and device in the frames:** over 254 frames they are persistently dark (≥ 30 % of frames) from about 800 px outward on the backward side of each fisheye: image left for ch14, image right for ch18.
  - This is consistent with the calibrated directions, since ch14 looks left, so its image-left points backward.
  - Views are turned 12° forward, which takes that zone out of every view; no masks are needed.
- **Frames:**
  - minutes 7.5–18 (south-west rooms, south corridor, east wing, courtyard), one event per 5 s slot (the steadiest within ±1 s), plus the 9 correspondence events: 127 pairs, 254 views;
  - 10 s would leave 2.6 m and 49° between events, 5 s leaves 1.5 m and 29°, and 3 s is the denser fallback.
- **Dataset:**
  - COLMAP PINHOLE model in the LAS frame (no global transform), 1 M LiDAR initial points from the 5 M preview, a poses-only model for other initialisations;
  - a manifest tracing every view to its frame, channel, timestamp, H.264 offsets and source hash;
  - 266 MB.
- **Validation:** pass with warnings, no failures.
  - **Geometry:** camera centres are on the independently interpolated trajectory (≤ 0.001 mm); every rotation is proper; ch14 looks left and ch18 right; image-up · world-up ≥ 0.95.
  - **Correspondences:** median 0.74° (= the Stage B residual).
  - **Pixels:** view pixels match the fisheye through the COLMAP files (grey difference 0.7, against 85 for a 180° control).
  - **LiDAR agreement:** LiDAR-versus-photo NCC is 0.40, against ≈ 0 for rolled or swapped cameras (best in 243/254 views).
  - **Covisibility:** no isolated views.
  - **Warnings:** plain-surface views (not blur), bright sky, and 17 % of camera directions not continued between 5 s events.
- **Recommendation:** go for Lab 14B on this dataset once the GPU rental is approved.
  - **Main risk:** the zero lever arm. 5 cm is about 0.7° at 4 m.
  - **Second run:** with camera-pose refinement.

## Lab 14B: training preflight + smoke (2026-10-16)

Full write-up: [splat-training.md](splat-training.md).

- **Scripts:** `train_xgrids.sh` + `verify_lidar_init.py` (Lab 10C `train.sh` is wrong for this package: y-down world remap and eval-interval 8).
- **Init proof:** Nerfstudio 1.1.5 loads `points3D.bin` into splatfacto `seed_points` via the dataparser metadata; the Pod script refuses to train unless that path is verified. Local + Pod count: 1,000,000 points.
- **Package:** `reconstruction/training/lab14b/basel-xgrids-r2.zip` (SHA-256 `511593a2…`), uploaded and verified on Pod.
- **Smoke Pod:** Secure RTX 4090, EU-RO-1, $0.89/h, id `zf5dl3jh9clzyi`, 40 GB volume. train/export/eval all ok (PSNR 12.72, SSIM 0.65, LPIPS 0.69, peak 4058 MiB, 136 s). Result: `lab14b/basel-xgrids-smoke-20261016-085054/` (+ `.tar.gz`). Pod **stopped**; volume kept.
- **Quick Pod:** smoke host had no free GPU on restart → new Secure 4090 `ce9po8uagl0mrd` (US-IL-1, same $0.89/h). Fresh 7,000-step run (not continue): LiDAR init ok, train/export/eval ok (PSNR 15.42, SSIM 0.67, LPIPS 0.66, 1.19 M Gaussians, peak 5958 MiB, 388 s). Result: `lab14b/basel-xgrids-quick-20261016-121637/`. Pod **stopped**; volume kept. **No quality** until quick review.
- **Pitfall:** `pip check` failed on a ninja platform-tag false positive; `setup_env.sh` now ignores only that line. Stop-before-download truncated a tarball once — re-pack after verify.
- **Viewer:** import `splat.ply` in Lab 8 `/gaussian-viewer` (Nerfstudio layout accepted); not co-registered with LiDAR yet.

## Lab 14C: local diagnosis + focused selection (2026-10-16)

Full write-up: [lab14c-diagnosis.md](lab14c-diagnosis.md). **No GPU / upload / train.**

- **Confirmed contributors to soft quality:** long sparse 5 s route (~195 m, median turn 29°, many large turns); opposite cameras ~154°; experimental Stage B + zero lever arm.
- **Ruled out as primary:** missing LiDAR init (1M→1M); inverted fisheye map; upside-down cameras; Nerfstudio accidentally remapping Z-up (identity R + scale ~0.05).
- **Partial:** underfitting (7k mid-schedule) — modest PSNR gain; smear often pose/cal, not only iterations.
- **Viewer:** Lab 8 startCamera assumed COLMAP Y-down; Lab 14B PLY is LAS Z-up → awkward navigation. Fixed: `/gaussian-viewer` **World up: LAS Z-up**, Fly mode, optional training-camera start (`PATCH /splats/{id}/frame`). Cameras JSON: `lab14c/training-cameras-quick.json`.
- **Next dataset (selection only):** courtyard 14–16.5 min @ **2 s** → 64 events / 128 images, path ~50 m, median step ~0.75 m, median turn ~16° (`selection-courtyard-2s.json`). **Not built/trained.**
- **Recommended next train (when approved):** denser courtyard package, same cal — tests coverage vs calibration. Pods/volumes untouched until user terminates.

## Lab 14D: focused courtyard dataset built (2026-10-16)

Full write-up: [lab14d-courtyard-dataset.md](lab14d-courtyard-dataset.md). **No GPU / upload / train.**

- **Built from** Lab 14C `selection-courtyard-2s.json` (14–16.5 min @ 2 s), same Stage B `x_c69aede71834`, `forward12`, lever arm 0.
- **Extraction:** `lab14d-courtyard-2s` — 64/64 events, 128/128 `ok`.
- **Dataset:** `lab14d/basel-courtyard-2s-forward12/` (141 MB): 113 train / 15 eval; validation **pass with warnings** (exposure; mild pose continuity — 1 turn >90°, 6 direction gaps vs 43 on Lab 14A).
- **Coverage:** span 19.1×17.1×1.4 m, path 50 m; covisibility median 0.63, 0 isolated; **kept all 64 events** (loop is compact; no thin dead-end to cut).
- **LiDAR seed:** radius **12 m**, voxel 5 cm → 1.05 M voxels → cap **500,000** (not 1 M @ 25 m).
- **Package:** `lab14d/basel-courtyard-r1.zip` (81 MB, sha256 `c492bc17…`); 42 shared images with Lab 14B for visual comparison (`comparable-viewpoints-vs-lab14b.json`). Aggregate metrics not cross-comparable alone.
- **Smoke (approved 2026-10-16):** new Secure 4090 Pod `ahzq6a98eyklso` (EUR-NO-1, $0.89/h, 40 GB volume). Zip checksum OK; `EXPECTED_POINTS=500000`; LiDAR 500k→500k; train/export/eval ok (PSNR 10.63, SSIM 0.53, LPIPS 0.73, 499,988 Gaussians, peak 2624 MiB, 80 s). Downloaded `lab14d/basel-courtyard-smoke-20261016-211001/`; pod **stopped**. Shared eval image with Lab 14B quick: `seq02872_ch14_c.jpg` in `smoke-review/`.
- **Quick 7k (approved 2026-10-16; no quality):** smoke host had no free GPU → new Secure 4090 `3yew4v2f9ub76t` @ $0.89/h. Same package/cal; `EXPECTED_POINTS=500000 bash train_xgrids.sh quick`. LiDAR 500k→500k; 0 NaN Gaussians; train/export/eval ok (PSNR **19.25**, SSIM **0.62**, LPIPS **0.53**, **707,266** Gaussians, peak **3548 MiB**, **262 s**). Downloaded `lab14d/basel-courtyard-quick-20261016-221112/` (tar sha256 `a21c9108…`); pod **stopped**. Matched-view panels vs Lab 14B: `lab14d/quick-review/` (`seq02872_ch14_c` only shared eval filename). Visually clearer structure than 14B but **still severely blurry** + vegetation ghosting → **do not auto-run quality**; next investigate lever arm / Stage B / registration. Four EXITED pods keep 40 GB disks (~$8/mo each); no network volumes; nothing terminated without approval. Lab 14B pods untouched.

## Lab 14E: blur diagnosis after courtyard quick (2026-10-16)

Full write-up: [lab14e-blur-diagnosis.md](lab14e-blur-diagnosis.md). **Local only — no GPU.**

- **Confirmed:** Stage B held-out ~16–18 px; courtyard architecture held-out **17–23 px** ≈ **12 cm** lateral at 7.6 m — enough to force soft multi-view Gaussians. Pair Δt ≤19 µs / pose 10 Hz → sync unlikely. Fisheye remap + LiDAR init OK. Far residuals (~14 px at ≥8 m) **exceed** 5 cm lever budget (~4 px) → zero lever is a gap but **not the only** residual. Full LAS ~138 M pts in 12 m vs preview 2.7 M; seed 500 k from ~1.05 M preview voxels — thinning real, secondary while rays disagree. Splatfacto 7k spends only ~1k steps at full res (`num_downscales=2`) — secondary.
- **Not assumed from blur alone:** calibration wrong in a specific way — residuals measured; training config secondary.
- **Next (proposed, not started):** Lab 14E.1 local courtyard correspondences + lever-only then cx,cy-only fits; success &lt;8 px held-out; no 30k / no GPU until residuals improve.
- **Cost:** four EXITED 40 GB pods; local backups complete → volumes **safe to terminate when authorized** (~$32/mo). Nothing terminated.

## Lab 14E.1 + RunPod cleanup (2026-10-16)

- **Terminated** (user-authorized) pods `zf5dl3jh9clzyi`, `ce9po8uagl0mrd`, `ahzq6a98eyklso`, `3yew4v2f9ub76t` after re-verifying local backups. Account: **0 pods**, **0** network/global volumes. Recurring storage for those experiments **ended**.
- **Billing (pod API, to date):** 14B smoke $1.13 + quick $0.80 ≈ **$1.94**; 14D smoke $0.84 + quick $0.37 ≈ **$1.21**; four-pod total ≈ **$3.15** (GPU+disk).
- **14E.1 local:** Trial A (lever ±15 cm) LOO median **14.4 px** (levers ~1–2 cm); Trial B (cx,cy) LOO **15.5 px** (Δ ≲ 2 px). Stage B LOO baseline **16.0 px**. Target &lt;8 **not** reached. 14 auto courtyard proposals saved for UI review (excluded from scores — circular). Write-up: [lab14e1-lever-principal.md](lab14e1-lever-principal.md).

## Lab 14E.2: correspondence review (2026-10-17) — awaiting user approvals

Full write-up: [lab14e2-correspondence-review.md](lab14e2-correspondence-review.md). **Local only — no GPU / no RunPod.**

- Valid import package `lab14e2-courtyard-review.json` (hand matches + 14 autos with `excludedFromFit`, `reviewStatus: unreviewed`, `proposalSource: lab14e2-auto`).
- `/camera-calibration` correspondences mode: filters for auto / verified / held-out / rejected; Show switches to `lab14d-courtyard-2s`; Approve / Reject / Hold out; courtyard event chips for auto sequences and manual targets.
- New review statuses `held-out` and `rejected` (frontend + backend audit exclude both; autos also excluded until verified).
- **Stop:** no Stage B / constrained re-fit until the user approves ≥10 additional rigid matches and exports an approved set.

## Lab 14E.3: expanded manual correspondences + candidates (2026-10-17)

Full write-up: [lab14e3-calibration-validation.md](lab14e3-calibration-validation.md). **Local only — no GPU / no RunPod / no training.** Stage B `x_c69aede71834` **not** replaced.

- Preserved `correspondences-builtin-basel-house-2026-10-17.json` (43 matches; ch14=21, ch18=22; 21 events). Ignored file’s old `f=750` diagnostic model.
- Stage B residual on 40/43 valid: overall median **19.8 px**, P90 **40.9**; centre **14.3** vs outer **38.8**; radius–error corr **+0.66**. Three outer picks outside usable radius.
- Quality grades (heuristic): 12 verified / 27 approximate / 4 questionable — originals kept.
- Event-grouped LOO (usable): frozen Stage B **22.2** px; refit Stage B **19.3**; +lever **19.1** (unstable); +cx,cy **17.0** (bound-hitting); **+k1 ~13.9** (best, still above 8–10 px goal).
- **Decision:** no new Gaussian train; no baseline overwrite. Next: human review of outer/edge picks, then optional constrained k1 trial beside Stage B if approved.

Also: `/labs/lcc-web-sdk` Plain Three.js only (R3F host kept, UI hidden) — see [lcc-web-sdk-feasibility.md](../labs/lcc-web-sdk-feasibility.md).

## Lab 14E.4: Calibration Review Queue (2026-10-17)

Full write-up: [lab14e4-calibration-review-queue.md](lab14e4-calibration-review-queue.md). **Local only — no fitting / no GPU.**

- `/camera-calibration` correspondences mode: prioritized queue (7 flagged first, then optional approximate courtyard, leave-alone reliable + indoor).
- Jump centres image on ○ pick; × uses Stage B `x_c69aede71834`. Verdicts: Verified / Approximate / Needs correction / Reject (no automatic rewrite of originals).
- Coverage: upper/middle/lower × left/right + near/medium/far per camera; ≤8 gap suggestions only when meaningful.
- **Stop:** finish flagged review before any Stage B / candidate refit.
- **Export 20:11 UTC:** 4/7 flagged → `needs-fix` (shelf, board, pane, roof-apex id); no re-picks. Trusted residuals (36) still show radial pattern (centre med ~14 px, outer ~39, corr ~0.64). Strict 12 “reliable” have **no outer**.
- **Export 21:00 UTC:** shelf+board → `approximate`; pane → `needs-fix`; roof apex → `verified`; #40/#41 → `verified` but still `excludedFromFit` (Reject-then-Verified); #24 → `approximate` + excluded. Preserved under `lab14e4-review-queue/`.

## Lab 14E.5: restore edge verdicts + constrained k1 (2026-10-17)

Full write-up: [lab14e5-fisheye-k1.md](lab14e5-fisheye-k1.md). **Local only — no GPU / Stage B not replaced.**

- Phase 1: restored #40/#41 (`excludedFromFit` cleared, stay verified / outside-usable); #24 stays excluded; glass stays needs-fix. UI clears Reject exclusion when marking Verified/Approximate/Needs correction.
- Model A frozen Stage B LOO median **20.1 px**; Model B Stage B + k1-only (pose/f frozen) LOO **16.4 px**; outer 39→23; radial corr 0.65→0.34; k1 ≈ −0.029 / −0.020 stable across 17 folds; better on 12/17 events.
- #40/#41 never in train; under B they project but ~55–69 px — not a generalization win.
- **Decision:** k1 helps modestly; **not** enough for Gaussian retrain; do not overwrite `x_c69aede71834`.
- **After report (user export 21:19):** #40/#41 marked **rejected** again (preserved `…/lab14e5-fisheye-k1/correspondences-…-after-reject-40-41.json`). 14E.5 numbers above used the restored verified state and never trained on those two; rejecting them does not invalidate the 39-point LOO.

## Open questions

- Which physical camera is channel 14 and which is 18? Clue: `project.json` lists `left_main` and `right_main` at indices 0 and 2. Lab 13S found ch14 looks left, which suggests ch14 = `left_main`, but this is not confirmed.
- What do header field 3 (20000), message field 2 (3), field 6, the record write time and the 4 trailing bytes mean?
- What do channels 0, 1, 3 and 21 contain? Also unexplored: `project_data/log/data.ulg` and `lixel.zip`.
- Does each timestamp mark the exposure start, middle or end? What is the camera clock's offset from the pose clock?
- Does the layout hold for other recordings and firmware versions?
