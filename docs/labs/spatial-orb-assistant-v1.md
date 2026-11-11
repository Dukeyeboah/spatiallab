# Spatial Labs Orb Assistant V1

Built 2026-11-09 from the supplied Hovering Halo and Spatial Labs Hover Robot Blueprint references. One geometry build and one refinement for fuller fins, the visor brow and restrained presentation lighting; final camera framing includes the separate ground halo. The design keeps the visible white orb, curved opaque dark face, two cyan ring eyes, small cap/light, symmetric fin paddles and underside ring. There is no inner core, hidden arm assembly, skeleton, subdivision stack or image texture.

## Files and measured budget

- Editable source: `source-data/avatars/spatial-orb-assistant-v1.blend`.
- Runtime: `public/labs/prod02b/avatars/robots/spatial-orb-assistant-v1.glb`.
- Rebuild: `scripts/labs/build-orb-assistant.py` (Blender 3.6 Python).
- Runtime motion/projection: `lib/labs/prod02b/orbAssistant.ts`.
- Native Blender front, side and three-quarter PNGs are included in the task delivery, along with the source, GLB and validation report.

Actual exported budget: **3,764 triangles, 14 mesh objects/draws, four shared material types, 73,508 bytes (~72 KiB), zero bones, zero textures, zero animation clips**. The runtime projection is one additional plane/draw, outside the GLB. Khronos validation reports zero errors, warnings, infos and hints. Native Blender library read-back confirms the saved `.blend` contains the Orb scene and editable named components.

Main shell diameter is **0.24 m**, using a smooth-shaded 32×16 UV sphere. Blender front is -Y and vertical is Z; GLB front is +Z and vertical is Y. The rest body centre is 0.27 m above the navigation root, body bottom 0.15 m, and visible underside ring bottom about 0.136 m. Fin extents produce a compact approximately 0.32 m span. The curved visor is a fitted surface patch rather than a boolean cut or detached flat panel. Eyes and light strips follow the visible exterior.

## Hierarchy and materials

```
ORB_ROOT                         navigation origin, never animated locally
└── VisualRoot                   local rest height 0.27 m; hover / lean / bank
    ├── BodyShell, FaceVisor, Eye_L, Eye_R, TopCap, CapLight
    ├── HoverRing, HoverMount, Accent_L, Accent_R
    ├── FinPivot_L → Fin_L → FinLight_L
    └── FinPivot_R → Fin_R → FinLight_R
```

| Material type | Configuration |
|---|---|
| MAT_ShellWhite | Warm white #F2F0EA, metallic 0.06, roughness 0.30 |
| MAT_VisorDark | Opaque charcoal #101C23, metallic 0.05, roughness 0.19 |
| MAT_CyanGlow | #42EAF2, emission strength 3, roughness 0.28 |
| MAT_Accent | Tiny warm bronze exterior marks #AE8650, metallic 0.6, roughness 0.31 |

Blender may suffix material data-block names during regeneration; there are still only four robot material types. The editable source contains an `ORB_STUDIO` collection with presentation lights, camera, floor and a separate halo plane. These are not exported. The real-time GLB contains only `ORB_ASSISTANT` components. Studio renders use a light compositor glow; runtime eyes remain emissive without requiring real lights or a global bloom pass.

## Integration and testing

Open **http://127.0.0.1:3000/labs/prod-02b/avatar** for the actual GLB with Front, Side and Three-quarter camera buttons and Idle/Moving hover preview. Open **http://127.0.0.1:3000/labs/prod-02b** to navigate the scan; Orb Assistant V1 is the default candidate at its authored real-world scale. Existing walking and R01 candidates remain available at their previous half-size defaults. Full/⅔/½ controls are visual multipliers; Full size on the Orb is the natural 24 cm body.

WASD/arrows and on-screen buttons keep the original movement controller. Shift moves faster, Space uses existing jump physics, and Q/E turning is unchanged. No fin geometry is added to collision proxies and the capsule is unchanged. The Orb can be hidden or switched to Capsule without changing navigation. The small Orb uses the existing follow-camera settings; scroll to inspect it more closely.

Procedural motion animates `VisualRoot` and `FinPivot_L/R`: ±0.015 m / 2.5 s bob, subtle idle yaw, speed-dependent lean and approximately 2–8° fin wobble at 1.2 Hz with a phase offset. Banking follows the existing resolved body yaw rate. None of this writes to `ORB_ROOT` or the invisible controller position.

The floor projection is a single transparent, additive radial-gradient/ring ShaderMaterial plane with depth writing disabled. The host supplies `groundY = body.y - jumpHeight`, so the light follows resolved floor elevation rather than the body's bob or jump. Hiding the avatar hides the plane; switching/disposal releases its geometry/material. No texture, spotlight or shadow-map pass is required.

## Verification

```
node scripts/labs/test-orb-assistant.mjs
node scripts/labs/test-prod02b-robots.mjs
node scripts/labs/test-prod02b-avatar.mjs
npm run build -- --webpack
```

Use Node 22+. The Orb test loads the actual GLB into Three.js, checks 24 cm dimensions and mesh/material/triangle budgets, hierarchy, emissive eye material, absence of internal/studio/ground geometry, actual fin/bob transforms, stable navigation origin, floor changes and jumps, hiding and resource disposal. Existing robot/human controller regressions pass.

On this Mac, the installed Blender's headless process crashes before Python initialization; the same build ran successfully through Blender's Python console. Run the script in a clean or isolated Blender context with `exec(compile(open('/absolute/path/to/scripts/labs/build-orb-assistant.py').read(), 'build-orb-assistant.py', 'exec'))`. `ORB_OUTPUT_DIR` / `ORB_ASSET_DIR` environment variables override delivery/runtime destinations. The script generates its own isolated scene and exports selected robot objects only.

Final live-browser visual check could not complete because the browser/computer-use connection timed out. This does not affect the native Blender renders, glTF validation, actual Three.js GLB/motion/grounding tests or successful optimized production build. Use the preview route for the final GPU/viewer check on the target machine.
