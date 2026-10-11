# {{NAME}}: cloud training package (Spatial Lab, Lab 10C)

This folder trains a Gaussian splat of **{{NAME}}** on a rented NVIDIA GPU with
[Nerfstudio](https://docs.nerf.studio/) `splatfacto`, then brings the result
back to Spatial Lab. Nothing here runs on your Mac.

| Path | What it is |
| --- | --- |
| `images/` | the photos COLMAP placed, at the size it calibrated (1600 px), EXIF/XMP removed, pixels unchanged |
| `sparse/0/` | COLMAP's binary reconstruction, byte-for-byte: lens, camera poses, sparse points |
| `manifest.json` | provenance: project, pose job, every photo's original name, pose id, split (train/eval), checksums |
| `setup_env.sh` | installs Nerfstudio 1.1.5 from the pinned lock file and tests the GPU |
| `train.sh` | `quick` or `quality` training, PLY export, evaluation, one result folder |
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

## Estimates (not measurements)

| | RTX 4090 (24 GB) | RTX 3090 (24 GB) |
| --- | --- | --- |
| Setup (`setup_env.sh`, about 3 GB download) | 5–10 min | 5–10 min |
| Quick test, 7,000 iterations | 3–8 min | 5–12 min |
| Quality test, 30,000 iterations | 15–35 min | 25–50 min |
| Peak GPU memory | 4–10 GB (Nerfstudio documents about 6 GB) | same |
| Gaussians | quick about 0.3–1 M, quality about 0.5–2 M | same |
| PLY size | about 250 MB per million Gaussians (62 floats each) | same |

Runpod prices on the pricing page when this was written, per hour while the
Pod runs: RTX 4090 $0.34 (Community Cloud) / $0.74 (Secure Cloud); RTX 3090
$0.22 / $0.50. A first session (setup + quick + quality + downloads) is
roughly 1–1.5 hours: about $0.50–1.20. Check the price shown when you deploy.

## 1. Choose and start a GPU (Runpod)

1. runpod.io → **Pods** → **Deploy**.
2. **Secure Cloud** is recommended for private photos (certified data centres); Community Cloud is cheaper
   (machines run by third parties).
3. GPU: **RTX 4090** or **RTX 3090** (24 GB). One GPU.
4. Template: **Runpod PyTorch 2.1** (`runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04`).
5. Edit the template: Container Disk 20 GB, **Volume Disk 30 GB** (mounted at `/workspace`),
   expose HTTP ports **8888** (JupyterLab) and **7007** (Nerfstudio viewer, optional).
6. Deploy. Billing starts now. Wait until the Pod shows *Running*.
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

It ends with `gsplat OK` and `Ready`. It installs into `/workspace/nerfstudio-venv`, so a stopped and
restarted Pod keeps it. (Inside `ghcr.io/nerfstudio-project/nerfstudio:1.1.5`, skip this step.)

## 4. Quick test (verify the pipeline)

```bash
nohup bash train.sh quick > quick.out 2>&1 &
tail -f quick.out          # Ctrl+C stops watching, not training
```

**Monitoring**: the log shows the step, time per step and ETA. `nvidia-smi` (in a second terminal) shows
GPU memory and load. With port 7007 exposed, the live viewer is at `https://<POD_ID>-7007.proxy.runpod.net`
(optional; if it doesn't load, the log is enough).

At the end it prints `run.json` (time, iterations, peak GPU memory, Gaussian count, PLY size, PSNR/SSIM/LPIPS
on the held-out photos) and the result folder, e.g. `/workspace/outputs/{{SLUG}}-quick-20261012-101500/`.
Open a few `eval-renders/eval_img_*.png` in JupyterLab: each shows the real photo next to the render
from the same pose (`eval-renders/INDEX.txt` names the photos).

If it fails, see *Troubleshooting* below before trying the quality run.

## 5. Quality test (first useful reconstruction)

```bash
nohup bash train.sh quality > quality.out 2>&1 &
tail -f quality.out
```

Same procedure, 30,000 iterations (the reference length for Gaussian splatting).

## 6. Download the result

Each result folder contains `splat.ply` (the Gaussian scene), `run.json`, `eval.json`, `eval-renders/`,
`config.yml`, `dataparser_transforms.json` (how Nerfstudio re-centred and scaled the COLMAP frame; keep it),
`manifest.json`, `gpu.csv` and the logs. Pack it:

```bash
cd /workspace/outputs
tar czf {{SLUG}}-quality-result.tar.gz {{SLUG}}-quality-*/
```

Then download the `.tar.gz` with JupyterLab (right-click → Download), `runpodctl send` (receive on the Mac),
or `scp`. On the Mac, double-click it to unpack.

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
| `torch.cuda.is_available()` is False | driver too old for CUDA 11.8 | pick another machine (driver ≥ 520) |
| scene full of floaters/blur | coverage or photo quality | compare the eval renders; more overlapping photos of weak areas help most |

## Other GPU providers

Any Linux machine with an NVIDIA driver (CUDA ≥ 11.8) works:

- **With Docker**: `docker run --gpus all --shm-size=12gb -p 7007:7007 -v /path/to/workspace:/workspace -it ghcr.io/nerfstudio-project/nerfstudio:1.1.5`,
  then steps 2, 4–6 (`train.sh` finds `ns-train` on the PATH).
- **Without Docker**: Ubuntu 22.04 with Python 3.10 and gcc, then steps 2–6 unchanged.
