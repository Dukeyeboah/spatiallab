# LAB EXP-04 — Virtual staging foundation (single-object PoC)

**Status (2026-10-19):** Working prototype on `/labs/spatial-experiences`. Plain Three.js + XGRIDS LCC SDK 0.6.3. No R3F. No cloud.

## How to try it

1. Open Room tour → **Dev** (`</>`).
2. **Virtual staging** → **Built-in chair** (or Upload GLB).
3. **Place on floor** → click a floor surface in the 3D view (LCC raycast + downward snap).
4. Use gizmo **translate / rotate / scale**. Dragging suspends walk/orbit so controls do not fight the camera.
5. **Staged / Original** toggle (main panel) shows or hides furniture for visitor preview.
6. **Export staging JSON** for backup. Built-in chair needs no file restore; uploaded GLBs live in IndexedDB (notes in export).

## Answers (phase checklist)

| Question | Result |
|----------|--------|
| 1. Standard GLB with LCC viewer? | **Yes.** `GLTFLoader` objects parented into the same Three.js scene as LCC. Built-in procedural chair works without a file. |
| 2. Floor placement accurate? | **Mostly.** `lcc.raycast` + downward snap + live blue ring preview. Depends on collision/raycast mesh quality. GLBs in cm/mm are **auto-fitted** to ~1 m (e.g. Patricia armchair ~805 units → ~0.8 m). |
| 3. Transform controls? | **Yes.** Three.js `TransformControls`; nav disabled while dragging. |
| 4. Visual occlusion correct? | **Partial.** `LCCRender.setWriteDepth?.(true)` is enabled. Furniture in open space looks correct. Behind thin / incomplete splat walls depth can be wrong (Gaussian depth vs mesh depth). Collision does **not** fix visual occlusion. |
| 5. Placements persist? | **Yes.** `localStorage` `spatial-lab.experiences.staging.v1` + IDB for uploaded GLBs. Same world frame as checkpoints (post–`modelMatrix` Y-up). |
| 6. Performance | One chair: typically **negligible** vs splat cost (watch FPS in Dev stats before/after). Heavy GLBs will cost more. |
| 7. Limitations | No multi-select; no wall/ceiling snap; no physics; depth artifacts vs dense architecture; IDB GLBs not embedded in JSON export. |
| 8. Next experiment | See **EXP-04B** (furniture collision). Further: multi-object catalog, better depth, light matching. |

## Follow-up

- **EXP-04B** — OBB walk collision + modular asset import boundary: `docs/labs/spatial-experiences-exp04b.md`

## Coordinate / grounding

- Scene: Three.js **Y-up** after SDK `modelMatrix` (same as checkpoints).
- Built-in chair: feet at local y=0 (~0.45 m seat height).
- Uploaded GLBs: bounding-box min Y shifted to 0 after load.
- Do **not** auto-align to walls/ceilings (floor ray only).

## Files

| Path | Role |
|------|------|
| `components/labs/experiences/StagingEditor.tsx` | Dev UI |
| `components/labs/experiences/ExperienceTourHost.tsx` | GLB load + TransformControls + raycast place |
| `lib/labs/experiences/stagingTypes.ts` | Schema / export |
| `lib/labs/experiences/stagingStorage.ts` | localStorage + IDB |
| `lib/labs/experiences/stagingModels.ts` | Built-in chair + GLTFLoader |

## Depth notes

- SDK write-depth is on when available.
- Expect splats without solid depth to fail to occlude mesh furniture correctly.
- Treat occlusion validation as a known open item for a follow-up lab.
