# XGRIDS tools

Standalone Python tools for raw XGRIDS LixelKity K1 recordings (`.xbin`, container `XBAG`). They are independent of the Next.js app.
- **Requirements:** Python 3.9+ standard library; FFmpeg on `PATH` for extraction (`brew install ffmpeg`).
- **Format and its limits:** [docs/xgrids/xbag-format.md](../../docs/xgrids/xbag-format.md). The interpretation comes from **one recording**, so validate every new recording as described there.

| Script | Does | Writes (default, next to the recording, outside Git) |
|---|---|---|
| `index_xbin.py` | finds and decodes the metadata of every camera image (no image decoding) | `reconstruction/xgrids/metadata/frames.csv`, `index-summary.json` |
| `extract_frames.py` | decodes chosen synchronised pairs to JPEG, using `frames.csv`, with interpolated scanner poses | `reconstruction/xgrids/images/<run>/*.jpg`, `manifest.csv`, `extraction-summary.json` |
| `calibrate_cameras.py` | Lab 13V: audits a Lab 13U correspondence export and runs an **experimental** calibration (rotation, then + one focal parameter) with leave-one-event-out validation; needs NumPy + SciPy (`backend/.venv`) | `--out` (required, outside the repo): `audit-<sha8>.json`, `experiment-<id>.json`, never overwritten |

The recording, LAS and `poses.csv` are only ever opened read-only.

## Typical run

```bash
REC=~/Downloads/BM_Heritage_Basel_House_2026-07-15-101012/2026-07-15-101012-003.xbin

python3 scripts/xgrids/index_xbin.py "$REC"                        # ~22 s for 13.9 GB
python3 scripts/xgrids/extract_frames.py "$REC" --dry-run          # what would be extracted, and what is excluded
python3 scripts/xgrids/extract_frames.py "$REC" --validation       # 3 pairs: first, middle, last eligible event
python3 scripts/xgrids/extract_frames.py "$REC"                    # one pair every 10 s (Basel: 242 pairs, ~90 s, ~450 MB)
```

## `extract_frames.py` options

| Option | Default | |
|---|---|---|
| `--interval S` | 10 | one capture event per S seconds: the first event at or after each grid time |
| `--validation` | | first, middle and last eligible events only |
| `--sequences a,b,c` | | these sequence numbers only |
| `--quality Q` | 2 | FFmpeg JPEG `-q:v`, 2 (best) … 31 |
| `--include-outside-poses` | off | also extract events outside the `poses.csv` time range; pose columns stay empty |
| `--max-pose-gap-ms` | 200 | exclude events whose two neighbouring pose samples are further apart than this |
| `--frames`, `--poses`, `--out`, `--run-name` | next to the recording | an `--out` inside the repository is refused, unless it is under the ignored `reconstruction/` |
| `--dry-run` | | print the selection only |

**Rules:**
- **Both cameras, always.** Every selected event exports both `ch14` and `ch18`. Pairs that lack a frame from either camera are listed as "not complete pairs" and skipped.
- **Re-check before decoding.** Before decoding, each frame's metadata is decoded again from the recording and must match `frames.csv`. The H.264 bytes read are exactly `h264_bytes` from `sps_offset`.
- **Image statuses:**
  - `ok`;
  - `decoded-with-errors`: FFmpeg printed a warning, e.g. a damaged frame it concealed. The JPEG is kept for inspection;
  - `failed`;
  - `read-error`;
  - `index-mismatch`;
  - `dimension-mismatch`.
- **Exit code:** 2 if any event is incomplete.
- **Filenames:** `seq<sequence>_<channel>_t<timestamp µs>.jpg`.

## `manifest.csv`

One row per image:
- **Link to the recording:** image file, event index, pair ID, sequence, camera channel, exact `timestamp_us`, UTC, `sps_offset`, `message_offset`, `h264_bytes`, NAL unit types.
- **Decode result:** decoder status and message, JPEG size, SHA-256, width and height.
- **Scanner pose:**
  - `pose_status`;
  - `pose_before_us` / `pose_after_us`, the bracketing samples, and `pose_alpha`;
  - `scanner_x/y/z`, linear;
  - `scanner_qx/qy/qz/qw`, by SLERP, scalar last;
  - `camera_extrinsics` = `unknown`.

**The scanner pose is not a camera pose.** It is the `poses.csv` pose at the image time. The camera-to-scanner extrinsics are unknown; see [docs/xgrids/calibration-notes.md](../../docs/xgrids/calibration-notes.md).

## Viewing runs

The app's `/camera-calibration` page (Lab 13R) reads these runs through the local backend: start it with `SPATIAL_LAB_XGRIDS_DIR=<recording>/reconstruction/xgrids/images`. See [docs/xgrids/calibration-workspace.md](../../docs/xgrids/calibration-workspace.md).

## Calibration experiments

```bash
REC=<recording>/reconstruction/xgrids
backend/.venv/bin/python scripts/xgrids/calibrate_cameras.py "$REC/calibration/inputs/correspondences-….json" \
    --out "$REC/calibration/experiments" --dataset-id builtin-basel-house \
    --poses public/datasets/basel-house/poses.csv --runs-dir "$REC/images" \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin \
    --cloud-metadata public/datasets/basel-house/basel-preview-5m-metadata.json \
    [--image-check interval-10s] [--exclude ID …] [--include ID …] [--audit-only]
```

Method, output format and the Basel results: [docs/xgrids/calibration-experiments.md](../../docs/xgrids/calibration-experiments.md).

## Tests

```bash
python3 -m unittest discover tests/xgrids -v                                   # XBAG tools (calibration tests skip without SciPy)
backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py -v  # Lab 13V, synthetic data
```

The tests use synthetic XBAG-like files built by `tests/xgrids/synthetic_xbag.py`, with no real scans or photographs. They cover:
- sequence 0 being omitted;
- exact timestamps;
- the pairing window;
- rejection of a decoy signature;
- stream labels that require a matching record header;
- independence from chunk size;
- SLERP and xyzw order;
- interval sampling;
- pose-range exclusion;
- graceful handling of undecodable frames;
- refusal to write inside the repository.
