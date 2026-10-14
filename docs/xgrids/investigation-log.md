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

## Open questions

- Which physical camera is channel 14 and which is 18? Clue: `project.json` lists `left_main` and `right_main` at indices 0 and 2.
- What do header field 3 (20000), message field 2 (3), field 6, the record write time and the 4 trailing bytes mean?
- What do channels 0, 1, 3 and 21 contain? Also unexplored: `project_data/log/data.ulg` and `lixel.zip`.
- Does each timestamp mark the exposure start, middle or end? What is the camera clock's offset from the pose clock?
- Does the layout hold for other recordings and firmware versions?
