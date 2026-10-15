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

## Open questions

- Which physical camera is channel 14 and which is 18? Clue: `project.json` lists `left_main` and `right_main` at indices 0 and 2. Lab 13S found ch14 looks left, which suggests ch14 = `left_main`, but this is not confirmed.
- What do header field 3 (20000), message field 2 (3), field 6, the record write time and the 4 trailing bytes mean?
- What do channels 0, 1, 3 and 21 contain? Also unexplored: `project_data/log/data.ulg` and `lixel.zip`.
- Does each timestamp mark the exposure start, middle or end? What is the camera clock's offset from the pose clock?
- Does the layout hold for other recordings and firmware versions?
