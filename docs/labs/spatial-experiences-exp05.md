# LAB EXP-05 — Interactive wall and surface customization

**Status (2026-10-20):** Working prototype on `/labs/spatial-experiences` (Room LCC2). Plain Three.js overlays only — **LCC Gaussians are never edited**. No R3F, no AI, no paid cloud.

## How to try it

1. Open **Room** tour → **Dev** (`</>`).
2. Scroll to **Wall / surfaces (EXP-05)**.
3. **1. Pick wall** → click a relatively flat vertical wall. Inspect hit position, normal, source (`collision` via `intersectsRayExt`, else splat `raycast`), and planar suitability.
4. **2. Create ~2.2×2.4 m overlay** (or **Corner region** → click 2–4 points → **Create from corners**).
5. Adjust width / height / offset / twist / centre; set color or upload wallpaper; optionally add framed artwork.
6. Visitor toggles: **Surfaces** vs **Original walls** (furniture toggles remain separate).
7. **Export surfaces JSON** — meta in `localStorage`; images in IndexedDB.

## Phase results

### 1. Surface selection

| Item | Result |
|------|--------|
| APIs used | Prefer `lcc.intersectsRayExt` (point + **normal**). Fallback: `lcc.raycast` with normal ≈ −(hit − camera). |
| Collision geometry | `hasCollision` / `getCollisionGeometry` exist; pick uses ray against collision mesh when available — **no semantic wall labels**. |
| Planarity heuristic | `|ny| < ~0.45` → “planar wall OK”; floors/ceilings flagged. |
| Accuracy | Good on Room walls with collision mesh. Grazing angles and incomplete mesh → miss or bad normal. One-click does **not** define full wall extent. |

### 2. Overlay geometry

| Item | Result |
|------|--------|
| Representation | Oriented rectangle: centre, normal, tangent, width, height, offset, twist — same Y-up world as furniture/checkpoints. |
| Boundary | Default size from hit, or bbox of 2–4 projected corner picks. Numeric fine-tuning in Dev. |
| Source data | Unchanged — overlays are ordinary `THREE.Mesh` / groups. |

### 3. Flat color

| Item | Result |
|------|--------|
| Controls | Color picker, presets, opacity, restore flat color. |
| Placement | Correct once offset (~2 cm) + `polygonOffset` settle; verify from several viewpoints. |
| Persistence | Yes (`spatial-lab.experiences.surfaces.v1`). |

### 4. Wallpaper texture

| Item | Result |
|------|--------|
| Formats | PNG / JPEG / WebP / GIF → IDB. |
| Mapping | Repeat U/V, offset, UV rotation; tint color; opacity. |
| Stretch | Avoid extreme aspect mismatch by tiling; single-image stretch follows plane aspect. |

### 5. Framed artwork

| Item | Result |
|------|--------|
| Model | Independent plane + optional box frame (color, depth, border) in wall local UV (u, v). |
| Stability | Survives navigation and reload (same storage as wallpaper assets). |

### 6. Gaussian depth / occlusion (critical)

| Observation | Note |
|-------------|------|
| `LCCRender.setWriteDepth?.(true)` | Already enabled (EXP-04). Helps mesh vs splat ordering when the SDK writes depth. |
| Overlay settings | `depthTest` / `depthWrite` on; `polygonOffset`; small **normal offset** into the room. |
| Expected artifacts | **Bleeding** of original wall Gaussians at edges; **flicker** when offset too small; **z-fight** without offset; windows/doors/furniture **not masked** — overlay is a flat card, not a CSG cut. Adjacent walls / corners show seams if the rectangle doesn’t match the architecture. |
| Collision as depth mask | Collision assists **picking**, not pixel masking. No claim of clean wall replacement from all viewpoints. |
| Verdict | **Useful for decoration preview**, not photoreal paint replacement. Treat occlusion as an open research item for a follow-up lab (clip planes, stencil, semantic masks, or offline bake). |

### 7. Performance

One overlay + a couple of textures: typically **negligible** vs splat cost (compare Dev FPS before/after). Large tiled textures or many overlays will add fill rate.

### 8. Limitations & next experiment

- No automatic wall segmentation or multi-wall graph.
- No design-variant switcher yet (`designVariantId` reserved on schema).
- No hole-cutting for windows/doors.
- IDB images not embedded in JSON export (notes only).
- **Follow-up:** **EXP-05B** occlusion / clip / semantic feasibility — `docs/labs/spatial-experiences-exp05b.md` (**recommend B**: decorative overlays, not full wall replacement).

## Persistence schema (summary)

`SurfaceOverlay`: id, propertyId, label, centre/normal/tangent, size, offset, twist, material (color | texture+mapping), visible, optional `designVariantId`, `artwork[]`, `pickMeta`.

## Files

| Path | Role |
|------|------|
| `lib/labs/experiences/surfaceTypes.ts` | Schema / presets |
| `lib/labs/experiences/surfaceStorage.ts` | localStorage + IDB images |
| `lib/labs/experiences/surfaceGeometry.ts` | Basis, corners, create-from-hit |
| `lib/labs/experiences/surfaceMeshes.ts` | Three.js mesh build / dispose |
| `components/labs/experiences/SurfaceEditor.tsx` | Dev UI |
| `ExperienceTourHost.tsx` | Pick + sync overlays |
| `app/labs/spatial-experiences/page.tsx` | Wiring + visitor toggle |

## Regression checklist

- [ ] Pick wall → inspect normal / planar flag
- [ ] Create overlay; color visible from multiple distances
- [ ] Wallpaper tile / artwork frame
- [ ] Original walls hides overlays; Staged furniture still independent
- [ ] Reload page → surfaces restore
- [ ] Walk / checkpoints / staging still work
