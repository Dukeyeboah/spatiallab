# LAB EXP-05D — Thin volume, exclusion holes, and appearance-preserving edits

**Status (2026-10-20):** Feasibility add-on to EXP-05B/C. Original LCC scene untouched. No production editor. No paid GPU.

---

## Test A — Thin volume vs plane (same front face)

### Setup

| Mode         | Geometry                         | Front face                                                      |
| ------------ | -------------------------------- | --------------------------------------------------------------- |
| **Plane**    | `ShapeGeometry` (optional holes) | Local **z = 0**                                                 |
| **Thin box** | `ExtrudeGeometry` depth 1–3 cm   | Same **z = 0**; volume occupies **z ∈ [−t, 0]** (into the wall) |

Dev UI (Wall / surfaces → selected overlay): **Plane | Thin box** + **1 / 2 / 3 cm**. Keep **offset** identical when comparing so placement is controlled.

### Does thickness reduce Gaussian bleeding?

| Observation               | Interpretation                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Face-on, same offset      | Thin box and plane look **nearly identical** on the front face — bleeding is dominated by **splat soft depth / ordering**, not missing millimetres of mesh volume. |
| Grazing / oblique         | Thin box can hide a bit more of the wall “behind” the front face via side walls writing depth, but gains are **small** and angle-dependent.                        |
| Large offsets (±cm scale) | Still the main visual driver; thickness does **not** substitute for correct placement.                                                                             |

**Conclusion:** Extra thickness is **not** a substitute for depth integration. Any “improvement” that appears when switching plane→box without locking the front face is usually **placement change**, not true occlusion. With front faces matched, expect **marginal** benefit at best.

### Polygonal panel + rectangular exclusion (protruding décor)

| Control         | Behaviour                                         |
| --------------- | ------------------------------------------------- |
| **Add hole**    | Axis-aligned hole in local UV (u/v, width/height) |
| **Clear holes** | Remove all exclusions                             |

The hole leaves the **original LCC wall** visible through the overlay — including the **front and sides** of a protruding decorative strip — because no mesh is drawn there. Artwork can still sit in/near the hole as a separate EXP-05 frame.

**Limits:** Hole is a 2D cut in the overlay, not a 3D Boolean with the Gaussian feature. Sides of the décor stay visible only because Gaussians remain; the overlay does not model the feature.

Compare from **front / oblique / sofa-in-foreground** with Opaque preset. Exclusion helps **preserve** the feature without claiming wall paint under it.

---

## Test B — Preserve existing wall appearance

### B1 — Bake / capture wall → editable texture (LCC)

| Approach                                              | Feasible now?               | Notes                                                                                                                           |
| ----------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Orthographic render of wall region from Experiences   | **Partial**                 | Possible as a screenshot/bake experiment, but FG sofa/art **bake into** the texture unless masked.                              |
| Exclude FG via depth / instance IDs                   | **Weak on LCC**             | Soft Gaussians + no wall/object IDs → unreliable automatic exclusion. Manual paint-out of a bake is possible offline, not live. |
| Recolor baked albedo while keeping luminance          | **Yes in principle**        | e.g. multiply chroma, preserve value — but bake quality caps the result.                                                        |
| Claim “natural pattern preserved from live Gaussians” | **No** without a clean bake | Overlay tint alone does not recover micro-variation from under-splat colour.                                                    |

**How FG would be excluded (feasibility only):**

1. Manual 2D mask on a facing bake (labour).
2. Depth gate if solid depth existed (unreliable here).
3. Don’t bake FG: only sample pixels that hit the wall plane within a thickness — still fails when sofa overlaps in image space.

**Recommendation for LCC:** treat **bake-and-recolor** as a **offline content pipeline** candidate, not as something the current SDK viewer can do cleanly live.

### B2 — Duplicate selected wall Gaussians (open PLY)

Script flag: `--mode duplicate` in `scripts/labs/gaussian_wall_edit_feasibility.py`.

| Mode                  | Behaviour                                                                   | Detail preservation                                                               |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `in-place` (EXP-05C)  | Overwrite `f_dc` (± damp `f_rest`) on selected                              | Original colour of those Gaussians is **lost** (restore via `original_slice.ply`) |
| `duplicate` (EXP-05D) | Keep **all** originals; append recoloured clones nudged ~4 mm along +normal | Underlying shading/detail **remains**; paint is a second layer                    |

Ran on the same Nerfstudio PLY copy → `spatial-data/labs/exp05d/recolored_duplicate.ply` (~48 k clones on ~1.1 M baseline). Source PLY **not** modified.

**Trade-offs:** Higher splat count; possible shimmer / double-surface; still not LCC2; boundaries bleed where clones and originals overlap in projection.

**Assessment:** Duplication **can** preserve more original surface detail than in-place recolour, at cost of density and integration artifacts. Promising for an **independent Gaussian edit lab**, not for LCC Experiences.

---

## Recommendation

1. **LCC Experiences:** Keep **opaque plane + small offset + exclusion holes** for decorative panels / artwork. Thin box is optional A/B eye candy — **do not** expect it to solve bleeding.
2. **Do not** build live bake-and-recolor on LCC without better masks/depth.
3. **Next research (open format):** Prefer **duplicate-layer** or carefully masked in-place edit in a dedicated Gaussian lab (continues EXP-05C **B**).
4. **No production wall editor** yet.

---

## Files

| Path                                             | Role                                          |
| ------------------------------------------------ | --------------------------------------------- |
| `lib/labs/experiences/surfaceTypes.ts`           | `shellMode`, `shellThickness`, `excludeRects` |
| `lib/labs/experiences/surfaceMeshes.ts`          | Plane / thin box + holes                      |
| `components/labs/experiences/SurfaceEditor.tsx`  | Dev controls                                  |
| `scripts/labs/gaussian_wall_edit_feasibility.py` | `--mode duplicate`                            |
| `docs/labs/spatial-experiences-exp05d.md`        | This report                                   |

## How to compare in the app

1. Room → Dev → Wall / surfaces → select overlay → **Opaque**.
2. Match offset (e.g. +1–2 cm). Toggle **Plane** vs **Thin box** 1/2/3 cm — front face locked.
3. **Add hole**, size/position over the living-room decorative strip; walk front / oblique / sofa view.
4. Toggle **Original walls** for before/after.

**Follow-up:** EXP-05E layered finishes — `docs/labs/spatial-experiences-exp05e.md`.
