# LAB EXP-05B — Wall integration, occlusion, and selective Gaussian masking

**Status (2026-10-20):** Feasibility investigation on `/labs/spatial-experiences` (Room LCC2) + SDK 0.6.3 APIs. Builds on EXP-05. **No design variants, no AI, no paid cloud, no destructive LCC edits.**

## Problem (from EXP-05 screenshots)

Large coloured overlays read as floating cards. They paint over living-room Gaussian furniture (sofa). Changing **offset** slides the card; it does not become wall paint.

## Phase 1 — Diagnosis

| Check | Finding |
|-------|---------|
| World frame | Overlay uses same Y-up frame as furniture/checkpoints (`centre + normal×offset`, basis = tangent / bitangent / normal). |
| Offset units | **Metres.** `planeOrigin = centre + normal × offset`. |
| Offset sign | Normal is flipped at create-time to face **into the room**. **+offset** moves the plane toward furniture; **−offset** pushes into/behind the wall. Values like **−0.04** / **−0.69** are metres — −0.69 m is a large displacement, not a fine paint offset. |
| Material | Was often translucent (`opacity ~0.9`) + `DoubleSide` + `polygonOffset`. Translucency worsens compositing vs soft splats. |
| depthTest / depthWrite | Enabled by default; `setWriteDepth(true)` already called on `LCCRender`. |
| Why the sofa disappears | The overlay is a **solid mesh card** covering a large screen region. Soft furniture Gaussians frequently **do not write reliable depth**. The mesh wins the depth buffer and overdraws the sofa. Offset cannot “carve” the reconstruction. |

Dev now shows live **gap plane→wall (m)** and documents the offset convention under **Occlusion lab (EXP-05B)**.

## Phase 2 — Controlled wall test (procedure)

Use one living-room wall overlay; collapse other Dev sections.

1. **Opaque wall test** (opacity 1, preset Opaque, offset ≈ +1–2 cm).
2. Three viewpoints: face-on, oblique, sofa-in-foreground.
3. Toggle **Surfaces** / **Original walls** at the same pose.

Expect: face-on may look “painted”; sofa-in-foreground still fails unless Gaussians occlude the mesh (usually they do not).

## Phase 3 — Mesh / splat depth integration

| Approach | Result |
|----------|--------|
| `setWriteDepth(true)` | Necessary but **insufficient** for convincing furniture occlusion of large meshes. |
| Opaque + FrontSide + small +offset | Reduces z-fight vs wall; does **not** restore sofa. |
| noDepthWrite / alwaysFront | Worse: card always on top. |
| Collision depth-only proxy | Architecture mesh can write depth; **sofa is not in collision** — proxy does not restore sofa visibility through the overlay. |
| Collision vs visual | Collision aligns roughly with walls; it is **not** a pixel-accurate Gaussian mask. |

**Conclusion:** Ordinary Three.js meshes and LCC soft Gaussians do **not** share depth well enough for full-wall replacement in this SDK setup.

## Phase 4 — Clip box / plane (selective suppression)

APIs (0.6.3): `setClipBox`, `setClipPlane`, `setSelectBox` on the **whole** `LccObject`.

| Question | Answer |
|----------|--------|
| Thin oriented box on wall region? | **Yes** (EXP-05B toggle builds box from selected overlay). |
| Affects unrelated furniture / frames? | **Yes**, if those Gaussians fall inside the box volume. |
| Per-Gaussian / per-wall group? | **No** — object-level clip only. |
| Combine with replacement mesh? | Possible as a lab trick; edges still soft; not semantic paint. |
| Stable while walking? | Clip is model-space; stable, but over-clips when the box is wrong. |

Reversible: uncheck clears `setClipBox(undefined)`. **Not** equivalent to semantic wall selection.

## Phase 5 — Semantic data

APIs: `setSemantic`, `setSemanticColor`, `resetSemanticColor`.

Probe inspects `getMeta()` for `semantic` / `label` keys. **Room sample shows no usable wall-specific labels** for targeting one wall without recolouring unrelated surfaces. Class colouring ≠ editable per-Gaussian paint.

**Stop** this path for Room LCC2 until a package with verified wall labels exists.

## Phase 6 — Practical alternatives (viable)

| Alternative | Depth / occlusion | Notes |
|-------------|-------------------|--------|
| Small decorative panels (~0.9×1.1 m) | Better | Less screen coverage → less sofa overdraw |
| Framed artwork (EXP-05) | Good when small | Distinct from wall paint |
| Wallpaper on clear walls (no FG furniture) | Conditional | Works only where nothing stands in front |
| Scene-specific mesh replacements | Possible | Authoring cost; still mesh-vs-splat rules |
| Editable open Gaussian formats (future) | Best long-term | Outside current LCC2 proprietary pipeline |

## Phase 7 — Quality comparison (same three views)

| Approach | Attached look | Wall bleed | Sofa correct | Edges/windows | Flicker | Angle-sensitive | Perf |
|----------|---------------|------------|--------------|---------------|---------|-----------------|------|
| Large translucent overlay | Poor | High | **Fail** | Covered | Medium | High | Low |
| Large opaque + 1–2 cm offset | Fair face-on | Medium | **Fail** | Covered | Lower | High | Low |
| Opaque + clip box | Fairer | Lower on wall | Risk clip | Soft | Medium | Medium | Low |
| Collision depth proxy | Fair walls | Medium | **Fail** (no sofa depth) | — | Low | Medium | +fill |
| Small panel / artwork | Good | Low | Pass if clear | Preserved | Low | Low | Low |

Do not call large-plane “wall paint” a success from a favourable facing shot alone.

## Phase 8 — Recommendation

### **B — Acceptable limited decorative overlays; not full wall replacement**

**Evidence:** sofa occlusion failure is structural (soft Gaussian depth vs solid mesh); clip is whole-model and non-semantic; Room sample lacks wall semantic labels; offset is a metre slide, not material integration.

Also note **C** for *genuine* wall replacement later: need segmented / editable Gaussians or offline bake, not more Three.js planes alone.

**Do not** start design-variant UX on the assumption of full-wall recolouring.

**Follow-up:** EXP-05C confirms the LCC limit and proves open-format selective recolour on a PLY copy — `docs/labs/spatial-experiences-exp05c.md`.

## Dev tools added

- Collapsible Dev sections (Checkpoints, Staging, Surfaces, Floor-plan).
- Occlusion lab: gap readout, offset snaps, render presets, clip box, semantic probe, collision depth proxy, small decorative panel create.

## Files

| Path | Role |
|------|------|
| `lib/labs/experiences/surfaceOcclusion.ts` | Gap measure, clip box, render presets |
| `components/labs/experiences/ExpDevSection.tsx` | Collapsible Dev UI |
| `SurfaceEditor.tsx` / `ExperienceTourHost.tsx` | Lab toggles |
| `docs/labs/spatial-experiences-exp05b.md` | This report |

## Preserve

EXP-05 place/color/texture/artwork/persistence remain. LCC source untouched. Furniture staging and navigation unchanged when lab toggles are off.
