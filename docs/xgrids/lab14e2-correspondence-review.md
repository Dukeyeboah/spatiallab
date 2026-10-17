# Lab 14E.2 — Calibration correspondence review (local)

**Status (2026-10-17):** Review interface + 14 auto courtyard proposals ready for **manual inspection**. **No model fitting** until you approve additional correspondences and say so.

| Item | Location |
|------|----------|
| Review import package | `…/reconstruction/xgrids/calibration/inputs/lab14e2-courtyard-review.json` (also copied under `…/training/lab14e1-lever-principal/`) |
| Decoded images run | `lab14d-courtyard-2s` (serve via `SPATIAL_LAB_XGRIDS_DIR=…/reconstruction/xgrids/images`) |
| UI | `/camera-calibration` → **Image ↔ LiDAR correspondences** |

## Constraints

- Local only. No GPU, no RunPod, no cloud spend.
- Auto proposals stay **`excludedFromFit`** and **`reviewStatus: unreviewed`** until you Approve / Reject / Hold out.
- Fitting (Stage B LOO, constrained comparisons) is **deferred** until you export an approved set.

## What is in the package

- Existing Basel **hand** correspondences (reviewed export), plus
- **14 auto-proposed** courtyard matches (ray ∩ plane + image gradient) from Lab 14E.1:
  - Sequences **2557, 2608, 2661** (ch14 + ch18), **2718** (ch14 only)
  - `proposalSource: lab14e2-auto`, quality `fair`, scene `courtyard`
  - Schema-valid (`provisional`); importable into the browser store

Auto proposals are **circular for metrics** if used as-is (near-zero error by construction). Treat them only as candidates to inspect and re-pick if needed.

## How to review

1. Start the local backend with `SPATIAL_LAB_XGRIDS_DIR` pointing at the images parent (so `lab14d-courtyard-2s` appears).
2. Open `/camera-calibration` → mode **Image ↔ LiDAR correspondences**.
3. Confirm Source run is **`lab14d-courtyard-2s`** (preferred when present).
4. **Import JSON** → `lab14e2-courtyard-review.json`.
5. Filter **Auto proposed**. For each row:
   - **Show** — loads that sequence/channel, centres the photo on the 2D click, aims the LiDAR view at the 3D point.
   - Enable **Predicted pixels (×)** for the Stage B / baseline overlay residual.
   - Optionally enable the LiDAR→image colour overlay for neighbourhood context.
   - **Approve** (verified + clear exclusion), **Reject**, or **Hold out** (validation set). Edit feature text / quality / pixel / LiDAR if you correct the pick.
6. Add **≥10** new reliable rigid architectural matches (window / door / pillar–roof / roofline corners), spreading cameras, poses, image regions, heights and distances. Prefer the same physical corner seen from different scanner positions when feasible.
7. Keep **held-out events** separate (suggested: **2718**, **2959** — adjust as you prefer). Do not spend all good matches on the fit set.
8. **Export JSON** when satisfied. Tell the agent to resume **Stage B + constrained comparisons with LOO** on that export only.

## Status chips (lab UI)

| Chip | Meaning |
|------|---------|
| auto proposed | Lab 14E.2 (or `auto_*` id) candidate |
| unreviewed / verified / needs-fix / held-out / rejected | Your verdict |
| excluded from fits | Will not enter calibration fits (autos default here) |
| in fits · reliable / flagged | Passes geometric include rules; flags are warnings only |

## Manual target sequences (gaps vs autos)

Chips in the panel when on `lab14d-courtyard-2s`: **2587, 2647, 2768, 2827, 2872, 2903, 2959, 2977, 3037** — windows, doors, pillars, rooflines; multi-view where possible.

## After approval (not started)

1. Rerun Stage B baseline + constrained lever / principal (and only then consider joint) with **leave-one-event-out**.
2. Report errors by camera, image region and object distance; **flag** suspect matches, do not auto-delete.
3. Decide whether residuals justify a fuller fisheye distortion model or a small joint parameter set.

## Stop line

**First stop:** review UI + proposed points ready. Awaiting your approvals before any fitting.
