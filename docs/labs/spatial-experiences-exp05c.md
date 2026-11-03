# LAB EXP-05C — Selective wall editing feasibility

**Status (2026-10-20):** Feasibility only. Experiences viewer unchanged. LCC2 not reverse-engineered. Open-format Gaussian edit runs on a **copy** of an existing trained PLY.

---

## Future product notes (answered, not implemented here)

### Custom frames

**Yes, planned as a follow-up.** EXP-05 already stores `frameColor`, `frameDepth`, and `frameBorder` per artwork. Next UX could add frame **styles** (simple, matted, shadow-box) and thicker moulding as real geometry. Thickness already works via `frameDepth`; styles are a UI + mesh catalog change, not an SDK blocker.

### Video / iframe on walls

| Approach | Feasible? | Notes |
|----------|-----------|--------|
| **Video texture** (`HTMLVideoElement` → Three.js texture on a plane) | **Yes** | Same mount as artwork; enforce size/duration/bitrate limits (e.g. ≤15–30 s, ≤1080p, ≤~20 MB in IDB). Autoplay policies need mute or user gesture. |
| **True iframe in WebGL** | **No (not as a splat texture)** | Browsers cannot paint an iframe into a WebGL texture. |
| **HTML overlay billboard** | **Partial** | DOM iframe positioned over the canvas with a projected plane — works for UI video players, fragile with walk camera / occlusion. |

Recommendation: support **muted looping video textures** with quotas later; treat iframe as a separate HTML overlay experiment, not “wallpaper.”

---

## Part A — Final controlled LCC comparison (Room + living-room wall)

Uses EXP-05 / 05B tooling (opaque preset, measured gap, clip, collision depth proxy). **No further LCC renderer changes.**

| Test | Front | Oblique | Sofa / FG view | During move |
|------|-------|---------|----------------|-------------|
| 1. Opaque plane + collision gap ~1–5 cm | Good attach | Fair | Sofa often OK with opaque+depth | Stable if offset small |
| 2. Small +normal offsets (1–2 cm) | Best z-fight tradeoff | Fair | Better than large offsets | Good |
| 3. Collision depth-only proxy | Helps architecture | Helps | **Does not** invent sofa depth | OK |
| 4. Narrow wall clip box | Reduces bleed | May clip décor | Can eat sofa/frames if box thick | Stable but over-broad |
| 5. Clear wall (no FG furniture) | Convincing decorative | Good | N/A | Best case for overlays |

**Artifacts that remain:** Gaussian bleeding at edges; soft furniture still fails when depth is missing; clip ≠ wall selection; windows/doors not cut out.

**Verdict (A):** Improvements from opaque + small offset are **real** from multiple views, not one lucky angle — but still **decorative overlays**, not true wall-finish replacement. **Stop modifying the LCC renderer** for wall paint; SDK path is exhausted for this goal.

---

## Part B — Individual Gaussian attributes (open PLY)

**Asset:** local trained Gaussian PLY  
`spatial-data/splats/spl_7ca424a1fee6/source/scene.ply` (Nerfstudio 1.1.5 export, ~1.19 M Gaussians, Z-up). **Read-only.** Lab writes only under `spatial-data/labs/exp05c/` (gitignored with `spatial-data/`).

| Attribute | Present | Editable in this lab? |
|-----------|---------|------------------------|
| Position `x y z` | Yes | Not modified |
| Scale `scale_0..2` (log σ) | Yes | Not modified |
| Rotation `rot_0..3` | Yes | Not modified |
| Opacity (logit) | Yes | Not modified |
| Base colour `f_dc_0..2` | Yes | **Yes** — set from target RGB |
| Higher SH `f_rest_*` (degree 3) | Yes | **Attenuated** on selection (not relit) |
| Semantic / object labels | **No** | — |

Colour model (Lab 9 / reference):  
`RGB ≈ 0.5 + C0 · f_dc`, `C0 ≈ 0.28209479`. View-dependent colour adds `f_rest · SH(dir)`. Non-destructive workflow: keep `original_slice.ply`; edits only on copies.

**Selection method (combined, not colour-only):**

1. Distance to estimated vertical wall plane  
2. Manual wall polygon in plane UV  
3. Optional colour similarity gate (after 1–2)  
4. Exclusion polygon(s)  
5. Max Gaussian extent filter (drop huge blobs)

Script: `scripts/labs/gaussian_wall_edit_feasibility.py`

---

## Part C — Selective recoloring test (results)

Command (example):

```bash
python3 scripts/labs/gaussian_wall_edit_feasibility.py \
  --src spatial-data/splats/spl_7ca424a1fee6/source/scene.ply \
  --out-dir spatial-data/labs/exp05c \
  --half-extent 1.2 1.2 1.5 \
  --plane-thickness 0.05 \
  --target-rgb 0.45 0.62 0.52 \
  --attenuate-sh 0.9
```

Observed (this run):

| Metric | Value |
|--------|-------|
| Slice Gaussians | ~1.11 M (dense scene; crop still large) |
| Selected by wall poly | ~118 k |
| After exclusion | ~48 k |
| Outputs | `original_slice.ply`, `selection_preview.ply` (magenta), `recolored.ply`, `selection_mask.npz`, `selection_preview.json` |

**SH:** Attenuating `f_rest` on selected Gaussians reduces view-dependent colour flicker after base recolour; it is **not** physically correct relighting. Boundaries still show **bleeding** where unselected Gaussians overlap the region.

**Restore:** always available by loading `original_slice.ply` (source PLY never written).

View in `/gaussian-viewer` by importing the lab output PLYs locally (do not replace the catalog source).

---

## Part D — Exclusion masks

| Question | Result |
|----------|--------|
| Exclude a rectangular “artwork” UV region from wall selection? | **Yes** — ~70 k Gaussians dropped from selection in the test run |
| Spatially consistent from another angle? | Selection is on **3D Gaussian centres** in plane UV, not a single camera’s pixels. Agreement under a shifted UV origin remained high in the automated check — meaning membership is geometric, not view-pixel masking |
| Pixel mask vs 3D exclude | **Different.** A 2D image mask would break when walking; this lab excludes Gaussians whose centres fall in a 3D-aligned polygon |

Residual: Gaussians whose centres lie outside the exclude but whose footprints overlap the artwork still tint the edge (extent / opacity overlap).

---

## Part E — Decision answers

1. **LCC2 convincing wall finish without blocking FG?** **No** (not guaranteed). Opaque overlays help; soft Gaussian furniture depth remains insufficient; clip/semantic paths are not wall-selective.
2. **Direct recolor of selected Gaussians in open-format?** **Yes** on trained PLY copies via documented `f_dc` (± `f_rest` attenuation).
3. **3D region + exclusion polygons?** **Yes**, feasible and view-stable at centre level; footprint bleed remains.
4. **Remaining artifacts?** Edge bleed, SH view-dependence if not attenuated, imperfect auto-plane, no labels, large files.
5. **Always restore original?** **Yes** — never overwrite source; keep `original_slice.ply`.
6. **Needed for production?** Semantic/instance labels or mesh-aligned IDs; better wall segmentation; interactive picking UI; optional SH bake; QC from many viewpoints.

### Recommendation

**B — Build an independent per-Gaussian editing lab** (next), on open PLY/SOG pipelines already used by Labs 8–9.

- Keep **EXP-05 overlays** in Experiences for artwork / small decorative panels (**limited A**, not full wall paint).  
- **Do not** invest further in LCC renderer hacks for wall replacement.  
- **C** is unnecessary as a full pause: open-format editing is already evidenced; pause only applies to *LCC-native* wall paint.

---

## Files

| Path | Role |
|------|------|
| `scripts/labs/gaussian_wall_edit_feasibility.py` | Plane/poly/exclude select + recolour on PLY copy |
| `spatial-data/labs/exp05c/*` | Local outputs (gitignored via `spatial-data/`) |
| `docs/labs/spatial-experiences-exp05c.md` | This report |

## Preserve

Experiences navigation, staging, floor plans, checkpoints, EXP-05 overlays — untouched. LCC samples untouched. Source `scene.ply` untouched.

**Follow-up:** EXP-05D thin-box / exclusion holes / bake vs duplicate — `docs/labs/spatial-experiences-exp05d.md`.
