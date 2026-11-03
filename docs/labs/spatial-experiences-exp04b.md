# LAB EXP-04B — Furniture collision + asset foundation

**Status (2026-10-19):** Extends EXP-04 on `/labs/spatial-experiences`. No AI generation, no paid services.

## What was added

1. **OBB collision proxies** for each visible staged object (separate from the GLB mesh).
2. Walk resolver runs **LCC env collision first**, then **furniture slide** on XZ (same capsule radius / foot clearance).
3. Proxies **rebuild** when placements load, hide/show, delete, or after transform (including while dragging for debug).
4. **Dev debug**: “Debug collision proxies” draws cyan wireframe boxes.
5. **Asset pipeline** (`stagingAssetPipeline.ts`): all imports normalize to GLB/builtin refs so staging JSON stays format-agnostic.

## How to test

1. Place an armchair (or built-in chair).
2. Walk toward / around / away — you should block and slide on the proxy, not walk through the seat volume.
3. Enable **Debug collision proxies** — cyan box should match the solid region (slightly shrunk on XZ).
4. **Original** toggle or delete — collision disappears with the furniture.
5. Checkpoint fly-to still ignores furniture (lerp path, not `resolveCollision`).

## Findings / limitations

| Topic | Note |
|-------|------|
| Proxy shape | Oriented **bounding box** from mesh bounds, XZ shrunk ~12%. Empty space under arms / between legs is still blocked if it sits inside the OBB. |
| Not per-triangle | Cheap; good for chairs/tables. Bad for L-shaped sofas or open shelving — will over-block. |
| Sliding | Axis-separated like walls; corner cases can stick briefly. |
| Floor | Still LCC-only; furniture does not become walkable tops. |
| Hidden / Original | Proxies cleared when staging is hidden. |
| Teleport | Unchanged — no furniture ray block on fly-to. |
| Translate Z “stuck” | Usually **viewing angle**: looking forward, the blue Z arrow points into the screen — look sideways or drag a plane handle. Move/rotate gizmos are full Three.js defaults (world space). |
| Furniture vs walls | While **moving** with walk collision on, furniture is pushed out of LCC env. Not applied during rotate/scale. |
| Walk collision toggle | New placements start with **Walk collision** off so move/rotate stay free. Opt in per object when ready. Legacy saves (flag missing) keep collision on. |
| Scale ∝ / stretch | **scale ∝** (+/− buttons or centre handle) keeps proportions; **stretch** is local per-axis (XYZ arrows). |

## Asset format boundary

| Now | Later (not implemented) |
|-----|-------------------------|
| GLB / GLTF file → IDB | OBJ/MTL, FBX → convert to GLB then store |
| Builtin procedural chair | — |
| — | `importStagingAsset({ format: 'ai-glb', blob })` from an external image→3D service |

**Image→3D (future, no deploy in this lab):** external service returns optimized GLB (metres, Y-up) → `importStagingAsset({ format: 'ai-glb', blob })` → same place / collision / export path. Staging JSON only stores `assetId` + fileName hint.

## Files

| Path | Role |
|------|------|
| `lib/labs/experiences/stagingCollision.ts` | OBB build + capsule slide + debug mesh |
| `lib/labs/experiences/stagingAssetPipeline.ts` | Import/normalization boundary |
| `ExperienceTourHost.tsx` | Env + furniture resolve chain |
| `StagingEditor.tsx` | Proxy debug checkbox |

## Regression checklist

- [ ] Place / transform / persist chair
- [ ] Export / reload staging JSON (IDB GLB still required for uploads)
- [ ] Walk blocked by armchair; can walk around
- [ ] Debug wireframes Dev-only
- [ ] Staged/Original clears collision when hidden
- [ ] Checkpoint teleport still works
