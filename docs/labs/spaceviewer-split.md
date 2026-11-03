# SpaceViewer — public product split

**Status (2026-10-26):** Decision recorded. Spatial Lab stays the **local** research / Experiences lab. The shareable, upload-based viewer is a **separate project**: **SpaceViewer** (`../SpaceViewer` or its own GitHub repo).

## Why

Deploying Spatial Lab Experiences on Vercel required hosting proprietary XGRIDS samples, multi-service FastAPI, and CDN wiring that does not fit the LiDAR research backend. SpaceViewer is cleaner:

| | **Spatial Lab** | **SpaceViewer** |
|--|-----------------|-----------------|
| Purpose | Research, calibration, Experiences R&D | Let anyone open **their** scan and walk it |
| Data | Local `lcc-samples/`, FastAPI `spatial-data/` | User upload (LCC / LCC2 / PLY) + optional Firebase/R2 |
| Deploy | Local (`npm run dev`) | Vercel + Firebase/CDN |
| Backend | Full FastAPI labs | Minimal / storage only |

## What stays in Spatial Lab

- All LiDAR / Gaussian / XGRIDS calibration labs  
- Experiences feature development (`/labs/spatial-experiences`) as the **source of truth** for tour behaviour  
- No requirement to public-deploy Spatial Lab or commit LCC samples  

Port mature Experiences features into SpaceViewer when ready; do not block Spatial Lab work on SpaceViewer deploys.

## SpaceViewer goals (v1)

1. Upload or open **LCC / LCC2 package** (typically ZIP) or **PLY**  
2. Walk / orbit, quality lever, checkpoints, staging, wall overlays — parity with Experiences as features land  
3. Deploy independently; user content on Firebase Storage or R2 (not in git)  

See SpaceViewer `README.md` and `docs/ARCHITECTURE.md`.

## Changelog

| Date | Note |
|------|------|
| 2026-10-26 | Split decided; Spatial Lab public Vercel path de-prioritised |
