# LAB EXP-05E — Layered wall materials and realism

**Status (2026-10-20):** Overlay finishes only (Room LCC2). One fragment shader; exclusion holes / artwork / Original-walls toggle unchanged. No LCC / Gaussian edits. No AI.

## What shipped

| Piece | Detail |
|-------|--------|
| Schema | `WallFinishSettingsV1` on `SurfaceOverlay.finish` (seeded, versioned; `aiSuggestion` reserved) |
| Shader | Unlit layered material: base colour + grain + low-freq wash + plaster cue + optional map |
| Blend modes | `normal` / `multiply` / `overlay` / `softLight` — **material layers only**, not vs Gaussians |
| Lighting approx | Brightness, contrast, warm/cool, vertical gradient, tiny fake directional cue, roughness desat |
| Presets | Smooth Matte Paint, Limewash, Fine Plaster, Wallpaper (+ Reset to preset defaults) |
| Holes | Still geometric cuts — finishes never draw in excluded regions |

## Preserve

Plane / thin-box A/B, drag toggle, artwork, persistence, export JSON, opaque occlusion lab — kept.

## Blend modes (what they do / don’t)

| Mode | Affects | Does not |
|------|---------|----------|
| Multiply / Overlay / Soft Light / Normal | Procedural grain, wash, plaster, uploaded map onto base HEX | Recover captured LCC shading; composite over sofa Gaussians |
| Opacity & Opaque preset | Overlay mesh alpha / depth behaviour | Transparent “see-through paint” that fixes bleed |

Avoided stacking multiple transparent wall planes (that worsened bleed in earlier labs).

## Unlit vs lit

A conventional `MeshStandardMaterial` looked **less** matched to LCC (no accessible scene lights → wrong highlights). **Unlit + controlled baked variation** is more convincing beside soft Gaussians. Not physically accurate relighting.

## Visual comparison (procedure + findings)

Same views required: **front / oblique / sofa-in-foreground**, Opaque render preset, exclusion hole over décor.

| Look | Realism | Motion stability | Edges / bleed | Sofa | Perf |
|------|---------|------------------|---------------|------|------|
| Flat baseline | Low–medium | Good | Known | OK if opaque | Negligible |
| Matte + light grain | Better | Good | Same as flat | Same | Negligible |
| Limewash variation | Best “soft paint” | Good | Same | Same | Negligible |
| Fine plaster | Good up close | Good | Grain can read digital if strength high | Same | Negligible |
| Wallpaper map | Depends on asset | Good | Seams if map tiled poorly | Same | +texture |

**Most convincing default:** **Limewash** or **Smooth Matte** with restrained grain (~0.05–0.12) and low vertical gradient. Keep **Multiply** or **Soft Light**. Wallpaper only when a real map is uploaded.

## Persistence / AI-ready

`finish` stores HEX, presetId, strengths, blendMode, seed. Future AI can fill `aiSuggestion` without blob URLs; maps stay `material.assetId` in IDB.

## Recommendation (commercial surface editor)

**Keep:** base HEX, 4 presets, grain / wash / texture strength, brightness / warm-cool, blend mode, exclusion holes, opaque overlays.

**Drop or hide:** aggressive contrast, high roughness as a “lit” control, thin-box as a realism lever (keep as A/B only).

**Do not** sell this as per-Gaussian wall paint — stay honest: decorative finishes on aligned overlays.

## Files

| Path | Role |
|------|------|
| `lib/labs/experiences/wallMaterialTypes.ts` | Schema + presets |
| `lib/labs/experiences/wallMaterialShader.ts` | Layered GLSL material |
| `lib/labs/experiences/surfaceMeshes.ts` | Builds shader finish |
| `components/labs/experiences/SurfaceEditor.tsx` | Finish UI |
| `docs/labs/spatial-experiences-exp05e.md` | This report |
