# XGRIDS tools

Standalone Python tools for raw XGRIDS LixelKity K1 recordings (`.xbin`, container `XBAG`). They are independent of the Next.js app.
- **Requirements:** Python 3.9+ standard library; FFmpeg on `PATH` for extraction (`brew install ffmpeg`).
- **Format and its limits:** [docs/xgrids/xbag-format.md](../../docs/xgrids/xbag-format.md). The interpretation comes from **one recording**, so validate every new recording as described there.

| Script | Does | Writes (default, next to the recording, outside Git) |
|---|---|---|
| `index_xbin.py` | finds and decodes the metadata of every camera image (no image decoding) | `reconstruction/xgrids/metadata/frames.csv`, `index-summary.json` |
| `extract_frames.py` | decodes chosen synchronised pairs to JPEG, using `frames.csv`, with interpolated scanner poses | `reconstruction/xgrids/images/<run>/*.jpg`, `manifest.csv`, `extraction-summary.json` |
| `calibrate_cameras.py` | Lab 13V: audits a Lab 13U correspondence export and runs an **experimental** calibration (rotation, then + one focal parameter) with leave-one-event-out validation; needs NumPy + SciPy (`backend/.venv`) | `--out` (required, outside the repo): `audit-<sha8>.json`, `experiment-<id>.json`, never overwritten |
| `select_splat_frames.py` | Lab 14A: picks capture events for a splatting dataset in a time window (one per slot, steadiest event, correspondence events kept, near-duplicates dropped) and compares intervals | `--out` selection JSON (outside the repo, never overwritten) |
| `export_training_cameras_for_viewer.py` | Lab 14C: COLMAP images + `dataparser_transforms.json` → training-camera poses for `/gaussian-viewer` (Ns frame) | `--out` JSON (outside the repo) |
| `prepare_splat_dataset.py` | Lab 14A: fisheye frames of an extraction run → perspective views + COLMAP PINHOLE model (poses from scanner pose + experimental calibration, LAS frame) + LiDAR initial points + manifest | `--out` dataset folder (must not exist) |
| `validate_splat_dataset.py` | Lab 14A: independent preflight checks of a dataset (structure, images, pairs, rotations, trajectory, correspondences, pixels, LiDAR agreement, covisibility, quality) + visual checks | `<dataset>/checks/` |
| `splat_geometry.py`, `splat_colmap.py` | Lab 14A libraries: frame conventions and view geometry (reuses `backend/camera_calibration.py`); COLMAP text/binary reader and writer | — |

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

# Lab 13W: compare experiments (first = baseline); prints and optionally writes JSON outside the repo
python3 scripts/xgrids/compare_experiments.py BASELINE.json OTHER.json … [--out report.json]
```

Ids after `--exclude` / `--include` are separate arguments; unknown ids are refused. In zsh, pass an array (`"${IDS[@]}"`), because `$IDS` is not split. Method, output format and the Basel results: [docs/xgrids/calibration-experiments.md](../../docs/xgrids/calibration-experiments.md).

**Lab 14E.2 (review before re-fitting):** import `…/calibration/inputs/lab14e2-courtyard-review.json` in `/camera-calibration` correspondences mode (run `lab14d-courtyard-2s`). Autos stay excluded until you Approve. Do not run `calibrate_cameras.py` on that package until an approved export exists — see [docs/xgrids/lab14e2-correspondence-review.md](../../docs/xgrids/lab14e2-correspondence-review.md).

## Gaussian splatting dataset (Lab 14A)

```bash
PY=backend/.venv/bin/python; R=<recording>/reconstruction
$PY scripts/xgrids/select_splat_frames.py --from-min 7.5 --to-min 18 --interval 5 \
    --anchors CORRESPONDENCES.json --out $R/training/lab14a/selection-5s.json
python3 scripts/xgrids/extract_frames.py REC.xbin --sequences "<sequences from the selection>" --run-name lab14a-5s
$PY scripts/xgrids/prepare_splat_dataset.py --run $R/xgrids/images/lab14a-5s --selection … --experiment EXPERIMENT.json \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin --cloud-metadata …-5m-metadata.json --out $R/training/lab14a/NAME
$PY scripts/xgrids/validate_splat_dataset.py $R/training/lab14a/NAME --correspondences … --cloud-bin … --cloud-metadata …
```

Options: `--layout forward12|centre|forward12+wing` (views per fisheye; the wing layout writes `masks/`), `--lever-arm x,y,z` (body frame, default 0 = assumption), `--cloud-radius`, `--voxel`, `--max-points`, `--eval-interval` (default 9 so both cameras are held out). Method, conventions, Basel results and the Lab 14B steps: [docs/xgrids/splat-dataset.md](../../docs/xgrids/splat-dataset.md).

## Lab 14C diagnosis (local; no train)

Soft quality on the Basel 5 s full-route quick run, focused courtyard 2 s selection, and viewer Z-up notes: [docs/xgrids/lab14c-diagnosis.md](../../docs/xgrids/lab14c-diagnosis.md).

```bash
$PY scripts/xgrids/export_training_cameras_for_viewer.py \
  --colmap-images $R/training/lab14b/basel-xgrids/sparse/0/images.bin \
  --dataparser $R/training/lab14b/basel-xgrids-quick-…/dataparser_transforms.json \
  --out $R/training/lab14c/training-cameras-quick.json
```

## Lab 14D courtyard dataset (local; no train)

```bash
SEQ=$(python3 -c "import json;print(json.load(open('$R/training/lab14c/selection-courtyard-2s.json'))['sequences'])")
python3 scripts/xgrids/extract_frames.py REC.xbin --sequences "$SEQ" --run-name lab14d-courtyard-2s
$PY scripts/xgrids/prepare_splat_dataset.py --run $R/xgrids/images/lab14d-courtyard-2s \
    --selection $R/training/lab14c/selection-courtyard-2s.json --experiment EXPERIMENT.json \
    --cloud-bin public/datasets/basel-house/basel-preview-5m.bin --cloud-metadata …-5m-metadata.json \
    --cloud-radius 12 --max-points 500000 --out $R/training/lab14d/basel-courtyard-2s-forward12
$PY scripts/xgrids/validate_splat_dataset.py $R/training/lab14d/basel-courtyard-2s-forward12 \
    --correspondences … --cloud-bin … --cloud-metadata …
backend/.venv/bin/python scripts/xgrids/package_splat_training.py \
    --dataset $R/training/lab14d/basel-courtyard-2s-forward12 \
    --out $R/training/lab14d/basel-courtyard-r1 --slug basel-courtyard --expect-points 500000 --zip
```

Details: [docs/xgrids/lab14d-courtyard-dataset.md](../../docs/xgrids/lab14d-courtyard-dataset.md).

## Training package (Lab 14B / 14D, upload only after approval)

```bash
backend/.venv/bin/python scripts/xgrids/package_splat_training.py \
    --dataset $R/training/lab14a/basel-5s-forward12 \
    --out $R/training/lab14b/basel-xgrids --slug basel-xgrids --zip
# Courtyard (Lab 14D): --expect-points 500000 — see lab14d-courtyard-dataset.md
```

Ships images + `sparse/0/*.bin` (LiDAR seeds) + Lab 10C `setup_env.sh` + `train_xgrids.sh` + `verify_lidar_init.py`. Do **not** use Lab 10C `train.sh` on this package (wrong world convention and eval interval). Preflight, prices and Pod commands: [docs/xgrids/splat-training.md](../../docs/xgrids/splat-training.md).

## Tests

```bash
python3 -m unittest discover tests/xgrids -v                                   # XBAG tools (calibration tests skip without SciPy)
backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py -v  # Lab 13V, synthetic data
backend/.venv/bin/python -m unittest tests/xgrids/test_splat_dataset.py -v      # Lab 14A, synthetic data
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
