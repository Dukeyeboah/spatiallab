# Deploy Spatial Lab Experiences on Vercel

**Status (2026-10-26):** **Superseded for product sharing.** Use the separate **SpaceViewer** project for public upload-and-view deploys (`docs/labs/spaceviewer-split.md`). This note remains only if you still experiment with deploying Spatial Lab itself.

**Earlier status:** Config + procedure. Experiences is a Next.js client page; LCC packages are **not** in git.

## What the share link does

`vercel.json` redirects `/` → `/labs/spatial-experiences` on Vercel only. Visitors land in Experiences; other routes stay available (e.g. `/` after removing the redirect, or `/labs/lcc-web-sdk`, camera calibration, Gaussian labs). Local `npm run dev` keeps `/` as the LiDAR home unless you open Experiences yourself.

## Critical constraint: LCC samples

Packages under `public/labs/lcc-samples/` are **gitignored** (~50–500+ MB each, ~1.6 GB total). A normal `git push` + Vercel build **will not** include them.

XGRIDS sample data is **proprietary**. Confirm license / `appKey` before any public URL.

### Required for a working tour on the web

1. Host at least the scenes you want (Room, Penthouse, Revit Home) on object storage with public HTTPS (Cloudflare R2, S3 + CDN, Vercel Blob, etc.).
2. Preserve the path layout, e.g. `…/labs/lcc-samples/Room_Tour_L2_PRO_P/meta.lcc2` and sibling tiles.
3. Set Vercel env:

```text
NEXT_PUBLIC_LCC_ASSET_BASE=https://your-cdn.example.com
```

The catalog keeps relative `dataPath`s; the app prefixes this base at runtime (`resolveExperienceDataPath`).

4. Enable CORS on the bucket for your Vercel domain (GET for `.lcc2` / tiles). Range requests help for large packages if the SDK uses them.

**Do not** commit LCC packages into git to “make Vercel work.”

## Deploy steps (frontend)

1. Push this repo to GitHub (or connect the folder in the Vercel dashboard).
2. Import the project in [Vercel](https://vercel.com) — Framework: Next.js; build `next build`; output default.
3. Add `NEXT_PUBLIC_LCC_ASSET_BASE` (and upload assets first).
4. Deploy. Share `https://<project>.vercel.app/` (redirects into Experiences).
5. Optional: custom domain in Vercel project settings.

CLI alternative (after `npx vercel login`):

```bash
npx vercel          # preview
npx vercel --prod   # production
```

## What works on Vercel without the Python backend

| Feature | On Vercel static Next.js |
|---------|---------------------------|
| Experiences walk / quality lever / checkpoints (localStorage) | Yes (with CDN LCC assets) |
| Staging / surface overlays (browser storage) | Yes |
| Vendored LCC Web SDK | Yes (`public/vendor/…`) |
| Built-in Basel House preview **bins** | Only if you host `.bin` files (also gitignored) |
| LAS import, conversion, catalog, splat store | **No** — needs FastAPI |
| COLMAP / training jobs / XGRIDS calibration image serve | **No** — needs FastAPI + local/GPU data |

## How the LiDAR / lab backend works on the web

The FastAPI app in `backend/` is a **long-lived local service**: disk under `spatial-data/`, worker processes, multi‑hundred‑MB uploads, COLMAP, calibration files. It is **not** a Vercel Serverless Function.

### Practical options

**A — Keep research labs local (recommended default)**  
Share Experiences on Vercel. Run LiDAR / calibration / training on your Mac with:

```bash
cd backend && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
npm run dev
```

**B — Host the API separately**  
Deploy `backend/` to a VM or container host with a persistent volume (Fly.io, Railway, Render, ECS, a small VPS):

1. Run uvicorn (or gunicorn+uvicorn workers) behind HTTPS.
2. Mount a large volume for `SPATIAL_LAB_DATA_DIR` (and optional `SPATIAL_LAB_XGRIDS_DIR`).
3. Set CORS: `SPATIAL_LAB_ALLOWED_ORIGINS=https://your-app.vercel.app`.
4. On Vercel: `NEXT_PUBLIC_SPATIAL_API_URL=https://api.your-domain.com`.
5. Expect cost for storage + CPU; do not point the API at ephemeral serverless disk.

**C — Hybrid**  
Public Experiences only on Vercel; password-protect or omit links to `/camera-calibration`, `/gaussian-training`, etc., until an API exists.

### What you need to set up (checklist)

| Item | Experiences share | Full Spatial Lab on the web |
|------|-------------------|-----------------------------|
| Vercel project + GitHub | ✓ | ✓ |
| CDN for LCC samples + `NEXT_PUBLIC_LCC_ASSET_BASE` | ✓ | ✓ |
| XGRIDS license / app key for public use | ✓ | ✓ |
| Hosted FastAPI + volume + CORS | — | ✓ |
| `NEXT_PUBLIC_SPATIAL_API_URL` | — | ✓ |
| Hosted `.bin` / splat / training data (or upload UI against API) | optional | ✓ |
| GPU host for COLMAP / Nerfstudio (often still a rented pod, not Vercel) | — | as today |

## Local vs production entry

| Environment | `/` |
|-------------|-----|
| `npm run dev` | LiDAR Spatial Lab home |
| Vercel | Redirect → Experiences |

Other labs: open their paths or use in-app links (Experiences still has “← Spatial Lab”).

## Changelog

| Date | Note |
|------|------|
| 2026-10-26 | Vercel redirect + asset base env; backend hosting notes |
