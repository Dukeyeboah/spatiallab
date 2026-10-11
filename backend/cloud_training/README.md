# {{NAME}}: cloud training package (Spatial Lab, Lab 10C)

This folder trains a Gaussian splat of **{{NAME}}** on a rented NVIDIA GPU with
[Nerfstudio](https://docs.nerf.studio/) `splatfacto`, then brings the result
back to Spatial Lab. Nothing here runs on your Mac.

| Path | What it is |
| --- | --- |
| `images/` | the photos COLMAP placed, at the size it calibrated (1600 px), EXIF/XMP removed, pixels unchanged |
| `sparse/0/` | COLMAP's binary reconstruction, byte-for-byte: lens, camera poses, sparse points |
| `manifest.json` | provenance: project, pose job, every photo's original name, pose id, split (train/eval), checksums |
| `setup_env.sh` | installs Nerfstudio 1.1.5 from the pinned lock file, runs `pip check`, tests the GPU |
| `train.sh` | `smoke`, `quick` or `quality` training, PLY export, evaluation, one result folder per run |
| `requirements-nerfstudio.lock.txt` | every Python package at an exact version (as of Nerfstudio 1.1.5's release) |
| `SHA256SUMS` | checks the upload arrived intact |

Photos COLMAP could not place are not included (they have no pose). Every 8th
photo (by COLMAP image id) is **held out**: it is not trained on, and the
finished scene is rendered from its pose and compared with it. The list is in
`manifest.json` (`"split": "eval"`).

A good camera reconstruction does not guarantee a good splat: reflective,
plain or poorly covered areas can still come out blurry or noisy. That is
what the quick test is for.

## Versions (checked against the official sources)

| Component | Version | Why |
| --- | --- | --- |
| Nerfstudio | 1.1.5 (latest release) | `splatfacto`, reads COLMAP models directly |
| gsplat | 1.4.0 (prebuilt wheel `+pt21cu118`) | the version Nerfstudio 1.1.5 requires |
| PyTorch | 2.1.2 + CUDA 11.8 | Nerfstudio's recommended install |
| Python | 3.10 | the wheels are built for it |
| Base image | `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04` (Runpod "PyTorch 2.1") | CUDA 11.8 + compiler, SSH, JupyterLab |
| Alternative | `ghcr.io/nerfstudio-project/nerfstudio:1.1.5` | official image, everything preinstalled (any Docker host) |

## Presets

| Command | Iterations | Purpose |
| --- | --- | --- |
| `bash train.sh smoke` | 300 | proves the whole chain (training, PLY export, evaluation, `run.json`) in minutes; the scene itself is meaningless |
| `bash train.sh quick` | 7,000 | first look at quality (the standard early checkpoint of Gaussian splatting) |
| `bash train.sh quality` | 30,000 | the reference length: the first useful scene |

Everything else is identical. Each run gets its own folders, named after the preset and the UTC start time,
so no run ever overwrites another:

```
/workspace/outputs/{{SLUG}}/splatfacto/quick-20261012-101500/   Nerfstudio's run: config.yml, dataparser_transforms.json,
                                                                nerfstudio_models/step-000006999.ckpt, TensorBoard events
/workspace/outputs/{{SLUG}}-quick-20261012-101500/              the result to download (section 6)
```

Only one `train.sh` runs at a time (a second one refuses to start).

## Estimates (not measurements)

| | RTX 4090 (24 GB) | RTX 3090 (24 GB) |
| --- | --- | --- |
| Setup (`setup_env.sh`, about 3.3 GB download) | 5–10 min | 5–10 min |
| Smoke test, 300 iterations (mostly loading and evaluation) | 2–5 min | 2–5 min |
| Quick test, 7,000 iterations | 3–8 min | 5–12 min |
| Quality test, 30,000 iterations | 15–35 min | 25–50 min |
| Peak GPU memory | 4–10 GB (Nerfstudio documents about 6 GB) | same |
| Gaussians | quick about 0.3–1 M, quality about 0.5–2 M | same |
| PLY size | about 250 MB per million Gaussians (62 floats each) | same |

Runpod prices on the pricing page when this was written, per hour while the
Pod runs: RTX 4090 $0.34 (Community Cloud) / $0.74 (Secure Cloud); RTX 3090
$0.22 / $0.50. A first session (setup + quick + quality + downloads) is
roughly 1–1.5 hours: about $0.50–1.20. Check the price shown when you deploy. Disks cost
$0.10 per GB per month while the Pod exists (about $0.01 per hour for 50 GB) and $0.20 per GB per month
for a stopped Pod's volume.

### Storage (estimates for this package)

| What | Where | Size |
| --- | --- | --- |
| Python environment (torch 4.2 GB, open3d 1.1 GB, the rest) | volume `/workspace/nerfstudio-venv` | about 7 GB |
| Package zip + unpacked folder | volume | 0.2 GB |
| Checkpoint (Gaussians + optimiser state; only the latest is kept, briefly two while saving) | volume, Nerfstudio run folder | about 0.7 GB per million Gaussians |
| TensorBoard events (one comparison image every 100 steps) | volume, Nerfstudio run folder | quick 0.15 GB, quality 0.6 GB |
| `splat.ply` (62 values per Gaussian) | volume, result folder | about 0.25 GB per million Gaussians |
| Evaluation renders (22 side-by-side PNGs) | volume, result folder | about 0.05 GB |
| `.tar.gz` for download | volume | about the PLY size |
| Wheels while installing, LPIPS weights, logs | container disk `/tmp` (temporary) | under 4 GB at the peak |

Worst case for setup + smoke + quick (≤ 1 M Gaussians) + quality (≤ 3 M Gaussians) is about 16 GB on the
volume, so **30 GB** leaves room for one more quality run; the **20 GB** container disk only holds temporary
files. Each further quality run adds up to about 4 GB: delete old run folders (`rm -r`) if `df -h /workspace`
gets tight.

## 1. Choose and start a GPU (Runpod)

1. runpod.io → **Pods** → **Deploy**.
2. **Secure Cloud** is recommended for private photos (certified data centres); Community Cloud is cheaper
   (machines run by third parties).
3. GPU: **RTX 4090** or **RTX 3090** (24 GB). One GPU.
4. Template: **Runpod PyTorch 2.1**. Its container image must read exactly
   `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04` (if the template isn't listed, pick any
   template, **Edit Template**, and paste this image name). It has Python 3.10 with venv, the CUDA 11.8
   compiler (with gcc), SSH and JupyterLab.
5. Edit the template: **Container Disk 20 GB**, **Volume Disk 30 GB** (mounted at `/workspace`),
   HTTP ports **8888** (JupyterLab) and **7007** (Nerfstudio viewer, optional). Tick **Encrypt volume** (the
   photos are private). Don't attach a network volume (not needed, and it outlives the Pod).
6. Deploy. Billing starts now. Wait until the Pod shows *Running*. Don't use *Edit Pod* on a running Pod:
   it restarts it and wipes everything outside `/workspace`.
7. **Connect** → **JupyterLab** (port 8888) → open a **Terminal**. (SSH works too.)

## 2. Upload this package

Choose one:

- **JupyterLab** (simplest): drag `{{SLUG}}-training-package.zip` into the file browser (folder `/workspace`).
- **runpodctl** (installed on every Pod; on the Mac: `brew install runpod/runpodctl/runpodctl`):
  on the Mac `runpodctl send {{SLUG}}-training-package.zip`, then on the Pod, in `/workspace`,
  `runpodctl receive <the code it printed>`.
- **scp**: `scp -P <port> {{SLUG}}-training-package.zip root@<pod ip>:/workspace/` (Connect → SSH over exposed TCP).

Then, in the Pod terminal:

```bash
cd /workspace
python3 -m zipfile -e {{SLUG}}-training-package.zip .
cd {{SLUG}}
sha256sum -c SHA256SUMS --quiet && echo "package intact"
```

Spatial Lab also shows the SHA-256 of the whole zip: `sha256sum {{SLUG}}-training-package.zip` must match it.

## 3. Install the training environment (once per Pod)

```bash
bash setup_env.sh
```

It checks the free space, installs every package at the locked version, runs `pip check` (stops if any
requirement is unmet), renders a small test scene with gsplat on the GPU and ends with `gsplat OK` and
`Ready`. It installs into `/workspace/nerfstudio-venv`, so a stopped and restarted Pod keeps it.
(Inside `ghcr.io/nerfstudio-project/nerfstudio:1.1.5`, skip this step.)

## 4. Smoke test, then quick test

```bash
bash train.sh smoke        # 2-5 minutes; must end with "training ok, PLY export ok, evaluation ok"
```

It trains for 300 steps, exports a PLY, evaluates the held-out photos and writes `run.json`, so every
step has worked once before the longer runs. Check that `run.json` says `"evalSplitMatchesManifest": true`
(Nerfstudio held out the same 22 photos as `manifest.json`). If it fails, nothing longer will work: see
*Troubleshooting*. Then:

```bash
nohup bash train.sh quick > quick.out 2>&1 &
tail -f quick.out          # Ctrl+C stops watching, not training
```

**Monitoring**: the log shows the step, time per step and ETA. `nvidia-smi` (in a second terminal) shows
GPU memory and load. With port 7007 exposed, the live viewer is at `https://<POD_ID>-7007.proxy.runpod.net`
(optional; if it doesn't load, the log is enough).

At the end it prints `run.json` (time, iterations, peak GPU memory, Gaussian count, PLY size, PSNR/SSIM/LPIPS
on the held-out photos) and the result folder, e.g. `/workspace/outputs/{{SLUG}}-quick-20261012-101500/`.
Open a few `eval-renders/eval_img_*.png` in JupyterLab: each shows the real photo (left, undistorted)
next to the render from the same pose (right). `eval-renders/INDEX.txt` names the photo behind each file,
in the order Nerfstudio rendered them.

**If something fails.** Each step is recorded separately in `run.json` (`"status"`: train, export, eval)
and `"problems"`; the summary at the end says which failed. A failed export or evaluation never deletes
the trained checkpoint: fix the cause (see the `.log` files and *Troubleshooting*), then retry only the
missing steps with

```bash
bash train.sh finish /workspace/outputs/{{SLUG}}-quick-<time>
```

If training itself stops early (for example out of memory), the last checkpoint (saved every 2,000 steps)
is still exported and evaluated and `run.json` says `"train": "incomplete"`.

## 5. Quality test (first useful reconstruction)

```bash
nohup bash train.sh quality > quality.out 2>&1 &
tail -f quality.out
```

Same procedure, 30,000 iterations (the reference length for Gaussian splatting).

## 6. Download the result

Each result folder contains `splat.ply` (the Gaussian scene), `run.json`, `eval.json`, `eval-renders/`,
`config.yml`, `dataparser_transforms.json` (how Nerfstudio re-centred and scaled the COLMAP frame; keep it),
`manifest.json`, `gpu.csv`, `run.env` and the logs. The end of each run prints the exact command to pack
it, for example:

```bash
cd /workspace/outputs && tar czf {{SLUG}}-quality-20261012-104000.tar.gz {{SLUG}}-quality-20261012-104000
```

Then download the `.tar.gz` with JupyterLab (right-click → Download), `runpodctl send` (receive on the Mac),
or `scp`. On the Mac, double-click it to unpack. Download the quick result too if you want to compare.

Optional: the checkpoint (`/workspace/outputs/{{SLUG}}/splatfacto/<run>/`, about 0.7 GB per million
Gaussians) lets you export or evaluate again later without retraining. Pack that folder the same way if you
want it; it is not needed for Spatial Lab.

## 7. Stop and delete the Pod (important)

1. Make sure the result is on your Mac.
2. Runpod → **Pods** → your Pod → **Stop**: the GPU stops billing, but the 30 GB volume is still billed
   while it exists (about $0.20 per GB per month when stopped).
3. **Terminate** (trash icon): deletes the Pod, its volume, the uploaded photos and all results on it. This
   can't be undone, and it ends all charges for it.
4. Check **Billing** a few minutes later: no running Pods, no volumes.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `CUDA out of memory` | too many Gaussians for the card | rerun with `--pipeline.model.cull-alpha-thresh 0.2` added in `train.sh`, or use a bigger card |
| `no kernel image is available` | GPU architecture not in the gsplat wheel | use the official image `ghcr.io/nerfstudio-project/nerfstudio:1.1.5` |
| asks *"Would you like to downscale the images"* | images larger than 1600 px | the package's images are ≤ 1600 px; check that `--downscale-factor 1` is in `train.sh` |
| `pip` fails building `pyliblzfse` | no C compiler | use the `-devel` image, or `apt-get install -y build-essential` |
| `pip check` reports a conflict | an extra package was installed into the venv | `rm -rf /workspace/nerfstudio-venv` and run `setup_env.sh` again |
| evaluation fails downloading LPIPS weights | no internet from the Pod at that moment | retry with `bash train.sh finish <result folder>` |
| `No space left on device` | volume full | `df -h /workspace`; delete old run folders, or increase the volume (Edit Pod, after downloading results) |
| `Another train.sh is still running` | a run is still going | `nvidia-smi` / `tail -f *.out`; wait for it |
| `torch.cuda.is_available()` is False | driver too old for CUDA 11.8 | pick another machine (driver ≥ 520) |
| scene full of floaters/blur | coverage or photo quality | compare the eval renders; more overlapping photos of weak areas help most |

## Other GPU providers

Any Linux machine with an NVIDIA driver (CUDA ≥ 11.8) works:

- **With Docker**: `docker run --gpus all --shm-size=12gb -p 7007:7007 -v /path/to/workspace:/workspace -it ghcr.io/nerfstudio-project/nerfstudio:1.1.5`,
  then steps 2, 4–6 (`train.sh` finds `ns-train` on the PATH; set `OUT=/workspace/outputs` if needed).
- **Without Docker**: Ubuntu 22.04 with Python 3.10 and gcc, then steps 2–6 unchanged.
