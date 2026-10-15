# First Gaussian splatting training (Lab 14B)

**Status (2026-10-15):** GPU preflight complete. Package built. **No Pod rented, no upload, no training** until you approve.

Dataset: Lab 14A `basel-5s-forward12` · Calibration: experimental `x_c69aede71834` · Trainer: Nerfstudio **1.1.5** `splatfacto` (Lab 10C lock).

## Phase 1 — Preflight findings

### Lab 10C scripts

| File | Role for 14B |
| --- | --- |
| `backend/cloud_training/setup_env.sh` | Reused as-is (Nerfstudio 1.1.5, gsplat 1.4.0, torch 2.1.2+cu118) |
| `backend/cloud_training/requirements-nerfstudio.lock.txt` | Reused as-is |
| `backend/cloud_training/train.sh` | **Not used** for XGRIDS: its COLMAP flags assume SfM y-down world and `--eval-interval 8` (would hold out only ch14) |
| `backend/cloud_training/train_xgrids.sh` | **New:** Lab 14A COLMAP flags, LiDAR init gate, resume |
| `backend/cloud_training/verify_lidar_init.py` | **New:** proves `points3D.bin` → dataparser metadata → splatfacto `seed_points` |

### Nerfstudio 1.1.5 options (verified against v1.1.5 source)

| Concern | Finding | Flag we use |
| --- | --- | --- |
| Upright LAS world | Default `assume_colmap_world_coordinate_convention=True` remaps axes as if COLMAP were y-down; that would break our Z-up LAS frame. OpenCV→OpenGL camera flip still always runs (correct). | `--assume-colmap-world-coordinate-convention False` |
| Orientation | Default `orientation_method=up` further rotates by average camera up. Ours already have image-up ≈ world +Z (~0.99); we still pin axes. | `--orientation-method none` |
| Centring / scale | Needed for numerical stability; written to `dataparser_transforms.json` for later LAS remapping. | `--center-method poses --auto-scale-poses True` |
| LiDAR init | `load_3D_points=True` (default) loads `points3D.bin`. `VanillaPipeline` passes `metadata['points3D_xyz'|rgb]` as `seed_points` to `SplatfactoModel`. If metadata is missing, or `--pipeline.model.random-init True`, it uses 50k random points instead. | `--load-3D-points True` and **refuse to train** unless `verify_lidar_init.py` passes |
| Points without tracks | Our 1M points have empty tracks. Default `max_2D_matches_per_3D_point=0` never reads tracks. | (default) |
| Held-out split | Interval split: index `% N == 0`. With ids alternating ch14/ch18, **N must be odd**. Manifest uses 9 → 29 eval views (15 ch14 + 14 ch18). | `--eval-mode interval --eval-interval 9` |
| Checkpoints | Saved every 2000 steps and at the end (`steps_per_save=2000`). Smoke (300) still writes a final checkpoint. | (default) |
| Resume | `--load-dir <run>/nerfstudio_models` loads latest (or `--load-step`). Optimizer state included. New run folder; does not overwrite the source run. | `train_xgrids.sh continue …` |

### LiDAR initialization (explicit)

Verified locally: `points3D.bin` contains **1,000,000** points and is readable by Nerfstudio’s `read_points3D_binary`.

Chain in v1.1.5 source (not assumed from a successful train command):

1. `ColmapDataParser._load_3D_points` → `metadata['points3D_xyz']`, `points3D_rgb]` (same transform/scale as cameras).
2. `VanillaPipeline.__init__` → `seed_pts = (pts, pts_rgb)` when those keys exist.
3. `SplatfactoModel.populate_modules` → `means = Parameter(seed_points[0])` unless `random_init`.

On the Pod, `train_xgrids.sh` runs `verify_lidar_init.py` **before** `ns-train` and writes `init-check.json` (point count after the dataparser). Training is refused if that check fails. `run.json` copies the init report.

### Upload package (built, not uploaded)

```
reconstruction/training/lab14b/basel-xgrids-r2/     176 MB folder
reconstruction/training/lab14b/basel-xgrids-r2.zip  142 MB
  sha256 511593a252b505e644cb85f064118b3510dfa9b013e1243aeb1132c608510f2e
```

(Older `basel-xgrids.zip` lacks the smoke-stop / checkpoint-in-result changes — use **r2**.)

Contents: `images/` (254), `sparse/0/*.bin` (incl. 1M points), `manifest.json`, Lab 10C env + `train_xgrids.sh` + `verify_lidar_init.py`, `SHA256SUMS`, `README.md`. Omitted: `points3D.txt` (73 MB duplicate), `checks/`, `poses-only`, `lidar_init.ply`.

### Storage on the Pod (estimates)

| Item | Size |
| --- | --- |
| Package zip + unpacked | ~0.3 GB |
| Python venv | ~7 GB |
| Image cache in RAM/GPU | ~1.5 GB (254 × 1600 × 1200 × 3) |
| Checkpoint (1–3 M Gaussians) | ~0.7–2 GB each (latest only kept per run) |
| PLY + eval renders | ~0.3–1 GB per run |
| **Volume recommendation** | **40 GB** (30 GB Lab 10C is tight with 1M seed + smoke + quick + quality) |

### Compatibility notes

- **1M seed → sklearn kNN at init** may take a few minutes of CPU before step 0; not a failure.
- Peak VRAM with densification from 1M may reach **~10–16 GB**; stay on a **24 GB** card.
- Do **not** run Lab 10C `train.sh` on this package (wrong world convention and eval interval).
- Heritage photos: prefer **Secure Cloud** + encrypt volume.

## Phase 2 — Workflow (ready)

| Stage | Iterations | When | Overwrite? |
| --- | --- | --- | --- |
| smoke | 300 | Always first; **script stops here** | New folder |
| quick | 7,000 | Only after you review smoke (separate command) | New folder |
| quality | 30,000 | **Only if quick is coherent** | New folder, or `continue` from quick |
| finish | — | Retry export/eval only | Same result folder |

`train_xgrids.sh smoke` never starts quick. If train, export or evaluation fails, it exits non-zero and prints **Do NOT start the next stage**.

### Smoke download bundle

Each successful (or failed) run writes `/workspace/outputs/<name>-smoke-<time>/` including:

| Artefact | Purpose |
| --- | --- |
| `checkpoint/latest.ckpt` | smoke weights (copy; also kept under the Nerfstudio run dir) |
| `splat.ply` | exported Gaussians |
| `eval-renders/` + `eval.json` | held-out side-by-side renders and PSNR/SSIM/LPIPS |
| `run.json` | metrics summary, Gaussian count, GPU peak, `problems[]` |
| `init-check.json` | LiDAR seed verification |
| `train.log` `export.log` `eval.log` `gpu.csv` | logs |
| `config.yml` `dataparser_transforms.json` `manifest.json` | provenance / LAS mapping |
| `DOWNLOAD.txt` | packing instructions |

```bash
cd /workspace/outputs && tar czf basel-xgrids-smoke-<time>.tar.gz basel-xgrids-smoke-<time>
# download that .tar.gz, then review before any quick run
```

Commands (on the Pod, after upload): see [Exact proposed commands](#exact-proposed-commands) below.

## Phase 3 — Approval boundary (stop here)

### Recommended GPU

- **1 × RTX 4090 24 GB**, Secure Cloud, encrypt volume.
- Fallback: RTX 3090 24 GB Secure Cloud.

### Current RunPod prices (pricing page, verified 2026-10-15)

| GPU | Community | Secure |
| --- | --- | --- |
| RTX 4090 24 GB | **$0.34 / h** | **$0.89 / h** |
| RTX 3090 24 GB | $0.22 / h | $0.50 / h |

(Secure 4090 was $0.74/h in Lab 10C notes; it is **$0.89/h** on the page dated 2026-10-08.) Disk: ~$0.10/GB/month while the Pod exists. **Confirm the price shown at deploy time.**

### Estimated session (not a measurement)

| Step | Time (4090) |
| --- | --- |
| Deploy + upload 142 MB | 5–15 min |
| `setup_env.sh` | 5–10 min |
| `verify_lidar_init` + smoke 300 | 5–15 min (incl. 1M kNN init) |
| quick 7,000 | 8–20 min |
| quality 30,000 (only if justified) | 25–50 min |
| Download | 5–15 min |
| **Smoke + quick only** | **~1.0–1.5 h** |
| **+ quality** | **~1.5–2.5 h** |

**Cost estimate (Secure 4090 @ $0.89/h):** about **$0.90–1.40** for smoke+quick; about **$1.40–2.20** if quality is included; plus a few cents of disk. Community 4090 @ $0.34/h would be roughly one-third the GPU line, with weaker privacy guarantees.

### Exact proposed commands

**On the Mac (already done for packaging):**

```bash
# Rebuild package if the dataset changes (never overwrites):
backend/.venv/bin/python scripts/xgrids/package_splat_training.py \
  --dataset $R/training/lab14a/basel-5s-forward12 \
  --out $R/training/lab14b/basel-xgrids-NEWRUN --slug basel-xgrids --zip
```

**After you approve a Pod** (do not run until then):

1. Deploy RunPod: template `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04`, 1× RTX 4090, container 20 GB, volume **40 GB** at `/workspace`, encrypt volume, ports 8888 + 7007.
2. Upload `basel-xgrids.zip` → `/workspace`, unpack:

```bash
cd /workspace
python3 -m zipfile -e basel-xgrids-r2.zip .
cd basel-xgrids
sha256sum -c SHA256SUMS --quiet && echo package intact
bash setup_env.sh
bash train_xgrids.sh smoke
# → exits after smoke. Pack/download the result folder (see DOWNLOAD.txt).
# Do NOT run quick until you have reviewed that download.
```

3. Download the smoke tarball (`checkpoint/`, `splat.ply`, `eval-renders/`, `eval.json`, `run.json`, logs). **Stop** if export/eval failed (`run.json` `problems`, or non-zero exit), or if the scene is flipped, empty, or incoherent.
4. Only after smoke review: `nohup bash train_xgrids.sh quick > quick.out 2>&1 &`
5. Quality only if quick is coherent: `nohup bash train_xgrids.sh quality > quality.out 2>&1 &`  
   or resume: `bash train_xgrids.sh continue /workspace/outputs/basel-xgrids/splatfacto/quick-<time> 30000`
6. Pack and download results, then **Stop** and **Terminate** the Pod.

### Required fixes vs Lab 10C (already in `train_xgrids.sh`)

1. World convention False + orientation none.  
2. Eval interval 9.  
3. Pre-train LiDAR init verification.  
4. Separate result folders; optional `continue` for resume.

## What is still unknown (does not block smoke/quick)

- Lever arm (zero assumption) → possible softness / floaters indoors.  
- Whether 1M seed densifies past VRAM comfort (watch `nvidia-smi`).  
- Final visual quality (the experiment’s question).

---

**Waiting for your explicit approval** before renting a GPU, uploading the package, or starting training.
