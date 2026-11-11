# Spatial Labs Orb Assistant V1.1

2026-11-09: one focused polish pass on a copy of the existing V1 Blender scene. V1 source and GLB remain byte-identical fallbacks. The 24 cm shell, roots, pivots, procedural motion, floor projection, movement/camera/collision controllers and Q/E behavior are preserved.

## Changes

- Reshaped the existing six-ring visor surface to follow the sphere with a softer brow and denser outer contour. Added a narrow dark perimeter seam into the same mesh.
- Kept eye positions and cyan rings. Added visible charcoal lens centers and tiny non-emissive reflected glints, joined into the original eye objects. Cyan emission reduced from 3 to 2.2.
- Reshaped existing fins with fuller shoulders and compact flatter taper. Kept their light strips aligned; merged small dark external circular attachment pads into the fin meshes. Original pivot locations are unchanged.
- Moved the original mount and emitter 8 mm upward, seating the mounting disc into the lower shell with the emitter against its lip.
- Added a slim dark seam under the existing cap. Retained the crown light and two bronze marks. White roughness is now 0.33; charcoal roughness 0.22. Four shared materials, no image textures.

## Measured export

| Metric | V1 | V1.1 |
|---|---:|---:|
| Triangles | 3,764 | 4,808 |
| GLB bytes | 73,508 | 97,164 |
| Authored mesh objects | 14 | 14 |
| Material primitives / draws | 14 | 21 |
| Shared material types | 4 | 4 |
| Bones / textures / baked clips | 0 | 0 |

The extra material primitives are the small visible lens, glint, cap-seam and fin-joint regions. Three.js represents multi-material objects as Groups with child Meshes; the named semantic roots and fin pivots remain unchanged. No new animation loop or shader system is introduced. The separate runtime ground glow adds one plane/draw. Live scene meter showed 23 total draws including the scan and projection.

## Files and fallback

- `source-data/avatars/spatial-orb-assistant-v1.1.blend`
- `public/labs/prod02b/avatars/robots/spatial-orb-assistant-v1.1.glb` and matching `.meta.json`
- `scripts/labs/polish-orb-assistant-v1.1.py`: copies the original V1 native file before editing, loads its scene and reuses its complete studio. Execute in Blender 3.6 Python console. This Mac's Blender CLI crashes before Python initialization, so native console execution was used.

The default Orb URL in `lib/labs/prod02b/avatarAssets.ts` now selects V1.1. To restore V1, change that single URL suffix from `v1.1.glb` to `v1.glb` and rebuild. Both V1 files are retained unchanged. No changes to `orbAssistant.ts`, `visualAvatar.ts`, the host movement/camera controller or ground-projection implementation were needed.

## Verification and visual comparison

Matching front, side and three-quarter views use the inherited V1 lights, Filmic settings, 40-sample Cycles rendering, 1000×1000 resolution, orthographic scale 0.55 and identical camera positions. Reviewed against V1 and the supplied design: integrated contour, symmetric eyes/fins, attached emitter and restrained materials. The original low-poly shell silhouette is retained.

Actual-asset Three.js tests verify 24 cm dimensions, named hierarchy/rest transforms against V1, emissive rings and dark centers, real pivot/bob motion, stationary navigation root, floor transitions/jumps, hiding and disposal. Khronos glTF validation reports zero errors, warnings, infos and hints. Native library read-back confirms an editable saved scene. Legacy robot/controller regressions and optimized Next production build pass.

A real Chrome LCC2 downstairs scene check and `orb-lcc2.png` screenshot verify natural scale in the room, visible face/rings/fins and grounded projection. Q turning and mouse orbit/zoom were exercised. The existing camera framing is preserved, so the small Orb sits low in the frame. Meter observed 30 FPS, roughly 75–87 MB sampled JS heap during this brief check; Chrome displayed Energy Saver enabled. This is a short visual check, not a long-duration stability or cross-machine performance certification. Fine seams are sub-pixel at this performance-mode resolution; inspect the studio views for full surface detail.

## Test locally

Open `http://127.0.0.1:3000/labs/prod-02b` for the walkthrough, with Orb Assistant V1.1 at Full size (authored 24 cm body), or `/labs/prod-02b/avatar` for front/side/three-quarter and idle/moving hover previews. Existing WASD/arrows, Shift, Space and Q/E controls remain unchanged.

Run with Node 22+: `node scripts/labs/test-orb-assistant.mjs`, `node scripts/labs/test-prod02b-robots.mjs`, and `node node_modules/next/dist/bin/next build --webpack`.

## Navigation/visibility adjustment (2026-11-09)

The Orb now defaults to 1.5× (+50%), with Original, +20%, +50%, ⅔ and ½ comparison buttons. +20% is a 28.8 cm body; +50% is 36 cm. The authored GLB/.blend stay unchanged. A separate 5 cm runtime hover lift preserves the model's local bob; the floor halo subtracts the complete visual root offset before converting into scaled local coordinates, so it stays 6 mm above resolved ground across offsets, scales and jumps. The shader's soft disc opacity is 0.13 (was 0.10), ring opacity 0.40 (was 0.28), and ring width 0.045 (was 0.035); still one textureless plane and no real light.

The user's 1.75 s `pulsing.mov` and screenshots are consistent with obstruction-induced camera pumping and miniature framing loss. Code inspection found a second probe of the shortened boom could subtract camera radius/margin again, immediate expansion on hit/miss noise, and the normal minimum zoom overriding closer wall clearance. Game navigation now uses one preferred-length boom probe, immediate inward clearance, 220 ms sustained larger clearance before outward recovery, and lets closer collisions override normal minimum zoom. Other tours keep their legacy camera path.

An Orb-only visual framing guard keeps its bounding sphere in the vertical frame when the boom compresses. It preserves user yaw/Q/E behavior, constraining pitch only when necessary to keep the Orb visible. Bounded target lag and removal of the second positional spring prevent reverse travel overtaking a shortened boom. Capsule size, locomotion, wall/floor collision and fin motion remain unchanged; close-camera Orb opacity stays at least 0.65.

Regression coverage: alternating obstruction hit/miss without pumping, delayed release into open space, immediate closer-wall contraction (including below zoom minimum), one resolver call per game frame, reverse sprint with three scale choices at pitch limits, and floor projection grounding under combined scale/hover/offset/jump. Existing humanoid, robot, Q/E and jump checks pass. The exact recorded wall still benefits from user retesting because the recording contains no camera/collision telemetry.

Native Chrome check after this change: +20% selected on load; +50% preset changed the live model; forward/reverse travel and E turning exercised in downstairs LCC2. Meter approximately 58–60 FPS, 23 scene draws and 23 geometries / seven textures during this short interaction check. The dev scale slider now reaches 1.6×, and jump ceiling clearance includes the added visual hover/vertical offsets. This is not an extended stability soak.

User acceptance (2026-11-09): bedroom doorway is working correctly. The user selected +50% as the Orb’s permanent default (36 cm body); initial load and switching back to the Orb both use 1.5×. Other robots retain their existing defaults.
