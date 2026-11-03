# Spatial Lab Editable Twins — Future research direction

**Status (2026-10-21):** Planning and architecture only. **Not implemented.** Do not start `LAB TWIN-01` until explicitly approved.

This document preserves the long-term vision for **AI-assisted editable digital twins** derived from real-world scans (especially XGRIDS LCC2 and related reconstructions). It does **not** authorize API calls, GPU jobs, model downloads, or viewer changes.

---

## Three modular product lines

Keep these distinct but able to share **property IDs** and **coordinate-system metadata**:

| Module | Role today / planned | Must not |
|--------|----------------------|----------|
| **Spatial Lab Experiences** | Commercial-facing tours: LCC/Gaussian walkthrough, floor plans, checkpoints, GLB staging, wall **overlays** (EXP-04…05E) | Depend on Editable Twins existing |
| **Spatial Lab Reconstruction** | Independent Gaussian / camera-calibration research (Labs 8–14E, XGRIDS indexing, COLMAP, splatfacto) | Be blocked by Experiences UI work |
| **Spatial Lab Editable Twins** | Future: separate editable mesh twin of a captured space | Assume proprietary LCC2 can be rewritten or reverse-engineered |

Experiences already shows that **overlays on Gaussians** help decoration but cannot reliably recolour/remove captured architecture (EXP-05B–05E). Editable Twins is the proposed path for true wall/furniture redesign.

---

## Long-term vision

Convert a captured reconstruction into a **second asset**: an editable 3D scene (walls, floors, openings, fixtures, replaceable furniture) aligned to the original scan, so designers and developers can:

- Repaint walls / floors with real materials  
- Remove or replace captured furniture  
- Try layouts and named design variants  
- Walk **Captured Reality** vs **Editable Twin** vs **Design Preview**  

AI assists **scene understanding and procedural modeling**; it does **not** replace measured geometry or invent an apartment from screenshots alone.

---

## Inputs (optional, never assume all exist)

- LCC2 Gaussian reconstruction (display + reference; licensing-constrained)  
- Manufacturer / open PLY or SOG (where permitted)  
- Collision meshes, LiDAR geometry  
- Floor plans / CAD  
- Screenshots from **known** poses; calibrated images where available  
- Room dimensions / measurements  

---

## Target output

Where feasible: independent meshes for walls/floors/ceilings, openings, room bounds, cabinetry/fixtures, replaceable décor, editable materials; **GLB/GLTF** for web; editable source (e.g. Blender) retained. **Same world frame** as the property’s Gaussian / LCC tour.

### Progressive levels

| Level | Scope | Priority |
|-------|--------|----------|
| **1 — Architectural shell** | Walls, floors, ceilings, doors, windows, layout | Accuracy + editability over photorealism |
| **2 — Editable interior** | Cabinetry, fixtures, approximate furniture via procedural + reusable GLBs | After Level 1 is solid |
| **3 — High-fidelity twin** | Detailed furniture, textures, lighting | Specialist assets + human correction; **not** automatic from LLM prompts |

---

## Conceptual AI + geometry workflow (future)

1. Load reconstruction + geometric references  
2. Extract geometry, dimensions, camera poses  
3. Capture reference views  
4. Multimodal model proposes a **structured** scene description  
5. Procedural geometry (Blender Python / Three.js / similar)  
6. Export GLB  
7. Re-render from the same viewpoints  
8. Diff structural / visual differences  
9. Iterate  
10. Store twin **alongside** original Gaussian — never overwrite it  

AI = reasoning assistant; measurements and collision/LiDAR win on dimensions.

---

## Experiences viewing modes (future)

- **Captured Reality** — original Gaussian / LCC  
- **Editable Twin** — mesh shell / interior  
- **Design Preview** — twin + materials / furniture variants  
- **Comparison** — before/after  

Do **not** couple the current Experiences viewer to twin generation.

---

## Cost & feasibility (when initiated)

Investigate later with real runs (not speculative production quotes): API tokens, multimodal image cost, geometry compute, GPU needs, human correction hours, accuracy, time per room, room-type complexity. **Start with one room** — preferred: living room of the existing XGRIDS Room sample.

---

## Planned first lab (not started)

### `LAB TWIN-01 — AI-Assisted Architectural Shell Reconstruction`

**Goal:** Reconstruct **one** captured living room as editable walls, floor, ceiling, doors and major architectural features using available geometry + AI-assisted **procedural scripts**. Compare GLB vs original Gaussian.

**Evaluate:** dimensional accuracy, coordinate alignment, structural completeness, mesh editability, material customization, performance, API/processing cost, manual correction load.

**Out of scope for TWIN-01:** detailed furniture, photoreal materials, production editor, proprietary LCC2 Gaussian rewriting, unpaid speculative cloud spend without approval.

---

## Dependencies, uncertainties, risks

| Risk | Note |
|------|------|
| LCC2 licensing / tooling | No undocumented conversion or destructive edit of proprietary packages |
| Incomplete inputs | Many properties lack CAD, calibrated photos, or clean collision |
| Coordinate drift | Twin must share Experiences/Reconstruction frame metadata or registration fails |
| AI hallucination | Structure must be constrained by measured geometry, not freeform “apartment gen” |
| Cost volatility | Multimodal + iteration loops can dominate; measure on one room first |
| Human-in-the-loop | Level 2–3 almost certainly need review |
| Scope creep | Do not pause EXP design-variant work or Experiences stability for undocumented twin work |

---

## Relationship to EXP-05 wall work

EXP-05…05E prove **decorative overlays** on LCC are useful and that **full wall replacement inside LCC** is not. Editable Twins is the honest long-term answer for redesign — as a **parallel asset**, not a renderer hack.

---

## Changelog

| Date | Note |
|------|------|
| 2026-10-21 | Direction recorded; TWIN-01 named; no implementation |
