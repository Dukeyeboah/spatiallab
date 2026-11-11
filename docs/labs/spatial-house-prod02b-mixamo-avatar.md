# LAB PROD-02B — two robot candidates

**Current status: 2026-11-09.** The lab now compares the user's `robot.blend` and `R01_Animate_S.fbx`. Neither is selected as the final production avatar.

- Walkthrough: http://127.0.0.1:3000/labs/prod-02b — choose **Walking robot** or **R01 hover robot** under Robot candidate.
- Side-by-side studio: http://127.0.0.1:3000/labs/prod-02b/avatar — Idle and Walk / hover; drag to orbit, scroll to inspect.
- WASD / arrows move, Q/E turn, drag looks, wheel zooms. Space is a physical hop with follow camera and ceiling checks. Robot-specific takeoff/landing poses are not authored yet. Shift + direction runs (1.7× walking speed), including Shift held while using the on-screen direction buttons.

## Actual runtime budgets

| Candidate | Triangles including logo | Bones | Draws | GLB bytes | Height |
| --- | ---: | ---: | ---: | ---: | --- |
| Walking robot | 4,942 | 32 | 4 | 1,172,928 | 1.65 m |
| R01 hover robot | 3,804 | 60 | 3 | 678,908 | 1.45 m + 0.18 m hover |

Counts describe the exported assets, not marketplace polygon estimates. Only the selected avatar is loaded into the scan. Selection disposes the previous model, skeletons, and textures. The studio intentionally loads both. Full-scene performance depends on the LCC rendering workload: the studio reached about 60 fps locally, while the scan was substantially slower. This is not a mobile or production performance certification.

## Size and downstairs grounding (2026-11-08)

Robot size buttons are always visible: Full size, ⅔ size, and ½ size (default for both robots). They share the existing model scale state/slider. The walking robot heights are 1.65 m, 1.10 m and 0.825 m; R01 scales by the same factors. Navigation speed and stride reference scale together so cadence remains stable. The physical controller keeps its existing collision clearance.

Only PROD-02B's downstairs start is moved 2 m backwards and 1.2 m to the viewing-left of the authored pose, onto the clear side of the table/chair. Both eye and target move together, preserving view direction and floor height. PROD-01 drafts and shared 02A starts are not rewritten.

The previous floor ray began at eye height + 0.4 m, allowing the ground scan's rough upper surfaces to become the next floor. Avatar locomotion now probes downward from feet + 0.28 m over 1.48 m, and independently rejects SDK hits above a 0.28 m step or below a 1.2 m drop. Missing/invalid exterior hits preserve the previous ground height; variations smaller than 1.5 cm are ignored to prevent floor-noise shaking. Stationary avatar movement skips horizontal depenetration so noisy furniture contacts do not push the body back and forth. Q/E rotation is unchanged. This prevents jumping onto a higher storey through a doorway; it does not repair missing scan geometry or implement navigation between actual floors. Upstairs remains a separate floor selection. Legacy navigation retains its existing ray behavior.

## Performance and stability (2026-11-08)

PROD-02B has its own quality settings/persistence; PROD-02A presets stay unchanged. Default Performance = 300k splats / 28 m / DPR ≤0.85 / ≤1280×720 equivalent pixel budget. Balanced = 650k / 40 m / DPR ≤1 / ≤1600×900; High = 1.2M / 55 m / DPR ≤1.25 / ≤1920×1080. Actual drawing size also respects the device DPR. MSAA is disabled for this scan host. LOD smoothing is off for Performance/Balanced and automatic LOD inflation is disabled for robot profiles.

Auto-adjust performance (default on) uses five-second windows after a ten-second warm-up, targeting stable 30 fps or better. Below 27 fps or p95 >55 ms it reduces splats and resolution (four bounded levels). Recovery needs three windows at ≥29 fps / p95 <38 ms; stable 30 Hz displays retain detail. Loading, background time and long resume gaps are excluded. Manual profile changes reset the budget. Auto changes do not remount the scene or move the player.

The bundled SDK 0.6.3 allows large default caches (desktop defaults can reach 1.5 GiB CPU / 3 GiB GPU before device adjustments). Robot loads explicitly request 192 MiB CPU / 128 MiB GPU cache ceilings, or 96/64 MiB when reported device memory ≤4 GB or hardware concurrency ≤4. Two concurrent downloads and two worker requests/frame limit bursts. These are SDK cache limits, not guaranteed total process/VRAM limits; collision data, buffers and other browser allocations are additional. Precision Gaussian measurement raycasting is disabled for navigation; native wall/floor/camera collision queries remain enabled.

Removed both the every-frame `load().then(setDebug)` path and a settings-effect `load → setDebug → new tuning object → effect` feedback loop that repeatedly updated React for an already-ready avatar. Navigation tuning is memoized. Load notification now occurs only when selection changes, with debug telemetry at 2 Hz. Camera collision uses one endpoint sphere + five rays instead of dozens of sphere probes when the ray API exists. The legacy collision path is retained for other labs. Hidden tabs stop the host/studio loops and resume with cleared timing samples. Unmount unloads the SDK, disposes owned avatar/renderer resources and releases the WebGL context. Context loss stops drawing and offers Reload scene.

The always-visible performance meter reports FPS, p95 frame interval, CPU frame submission time, draw/triangle counts, Three geometry/texture counts, drawing-buffer dimensions, effective splat budget and Chrome JS heap when available. GPU timing, actual Gaussian/SDK/worker/VRAM allocation are **not** inferred from these figures. Frame timing uses a fixed 180-entry ring. PerformanceSession keeps 720 five-second snapshots (~one hour) plus 120 minute summaries, including minute heap lows/highs. The trend fits completed minute lows after a two-minute warm-up; it is a diagnostic, not a leak verdict. Session timing survives floor/robot changes. Download performance report posts to `/labs/prod-02b/report`, which validates the payload and returns an `application/json` attachment with `Content-Disposition`, `no-store`, and no persistence/logging. There are no Blob URLs to revoke. Reload scene explicitly starts a fresh report session.

Validation: `test-prod02b-performance.mjs` covers pixel caps on phones/laptops/4K, adaptation hysteresis and fixed history/cache budgets; real robot tests verify Run selection and size/grounding. Production build passes. Early browser check reached ~30 fps with CPU submission ~1–2 ms and stable five geometries/nine textures; earlier 13–17 fps figures were development/previous settings, **not** a controlled hardware benchmark. Long-session Chrome stability and different devices still require soak testing; no universal FPS/crash-free claim is made.

Resource lifecycle follows [Three.js cleanup guidance](https://threejs.org/manual/pages/how-to-dispose-of-objects.html); visibility handling follows [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).

## Chrome soak and actual download — 2026-11-09

Actual downloaded schema-v2 report: `spatial-robot-performance (1).json`, saved by Chrome 156 on macOS at 11:41 UTC. Started 11:31:56 UTC; 552.2 seconds (9 m 12 s), 108 retained snapshots, largest snapshot gap 5.62 s. User confirmed Chrome remained responsive and the report saved. Computer-use control became unavailable during the check, so the final file was obtained with the user's download click, then parsed and validated from Downloads; this is not an unattended all-UI pass.

- Half-size walking robot, ground floor, Performance/Auto, collision enabled.
- Post-warm-up JS heap approximately 65.6–81.4 MB; completed-minute lows fell from ~71.3 MB to ~66.4 MB. Minute-low trend −1.15 MB/min; no sustained JS heap increase in this sample.
- Median sampled FPS after the first minute: 58; individual low-FPS samples and frame-time spikes remain. This is not a guarantee of 58 fps throughout.
- Five geometries / nine textures for every post-warm-up snapshot; zero reported WebGL context losses.
- Last three minutes: camera coordinates unchanged to floating-point precision, boom distance unchanged. The initial idle camera pulse did not persist in the sampled position data.
- Raw report and compact analysis copied into the task's `outputs/chrome-soak-2026-11-09.json` and `chrome-soak-summary-2026-11-09.json`.

Also passed: two-hour synthetic recorder/history/trend tests (bounded sample count), malformed download validation, live HTTP 200 attachment/content headers, TypeScript and optimized production build. Nine minutes is a useful stability check, not an hours-long or multi-device soak; JS heap excludes total Chrome, workers and GPU allocations.

## Asset preparation

`build-prod02b-robots.mjs` builds both runtime GLBs under `public/labs/prod02b/avatars/robots/`, with measured `.meta.json` files. Native sources are never overwritten. Sphere/mecha and RobMesh are excluded.

The walking robot uses the evaluated original Blender mirror mesh, with subdivision disabled, and the original native constrained IK walk sampled at 24 fps. `sample-prod02b-walker.py` can regenerate samples in Blender 3.6; compressed samples live in `scripts/labs/robot-sources/walker-sampled.json.gz` so a normal rebuild does not require Blender. The builder reverses the native cycle and mirrors one support phase to correct opposing foot travel, removes horizontal root drift, and retains vertical motion. Runtime playback follows movement speed (full-size 1.25 m/s walk, 2.125 m/s run; scaled with robot size; Walk stride reference 0.63 m/s). Run is a separate 0.8 s loop derived from the repaired native cycle with extra chest lean and a restrained pelvis lift; its stride reference is 1.12 m/s. Human motion remains archived, not offered by the candidate buttons.

R01 retains its original shell and skeleton with unique exported bone names. Authoring control lines and demo gestures are omitted. New Idle/Walk/Run actions provide a restrained hover, bob and forward lean. Run increases lean to 0.09 radians and shortens the hover cycle to 0.9 s. This character has no legs, so its navigation does not depend on a walk cycle. Its original diffuse texture and a normal map derived from the original bump texture are included. UV-degenerate tangents receive a valid orthogonal fallback.

Both use PBR materials and the supplied Spatial House mark on the chest and back. Marks are approximately 60% of their earlier width and share one logo material/draw per robot. Walking robot panels use cream, charcoal and bronze. Logos keep their alpha transparency. A generated environment and local filmic highlight compression are assigned only to avatar materials, without changing the LCC scene's lighting or tone mapping. No extra dynamic avatar shadow pass is added.

## Rebuild and verification

Use Node 22+ from the repository root:

```sh
node scripts/labs/build-prod02b-robots.mjs /path/to/R01_Animate_S.fbx /path/to/mark.png
node scripts/labs/test-prod02b-robots.mjs
node scripts/labs/test-prod02b-avatar.mjs
node scripts/labs/test-prod02b-performance.mjs
node scripts/labs/test-prod02b-report.mjs
npx tsc --noEmit
```

The builder defaults to `~/Downloads/R01_Animate_S.fbx` and the sibling SpatialHouse logo. Rebuilding native walking samples: run `sample-prod02b-walker.py` from Blender's Python console; gzip the resulting `walker-sampled.json` into the fixture path. Use a copy or unsaved session; the script opens the source with embedded scripts disabled and never saves it.

Both exported GLBs pass Khronos glTF validation with zero errors and warnings (the original logo's non-power-of-two dimensions are informational). Real-asset tests check both rigs, actual animation changes, bounds, material alpha, repeated switching, walking-only Shift behavior, jump physics, turn inputs, camera follow and opt-in isolation. Browser checks cover the studio and candidate switching in the scan.

Original human experiment and PROD-01/SpatialHouse production are preserved. Final avatar choice, bespoke robot jump poses and device-level scan performance tuning remain review steps.

---

## Archived human experiment

# Spatial House character (previous experiment)

**Status: 2026-11-08.** Implemented in the isolated PROD-02B lab. Originals and PROD-01 / SpatialHouse production are unchanged.

- Walkthrough: **http://127.0.0.1:3000/labs/prod-02b**
- Front/back character and animation studio: **http://127.0.0.1:3000/labs/prod-02b/avatar**

## Character and branding

The character is the user's original Mixamo mesh and 65-joint rig, with the head reduced to 48% width / 52% height/depth, hands to 80%, a looser shirt and baggy trousers, short hair and simple facial features. The conventional Y-up metre-space export stands **1.75 m** tall. It retains the original skin weights; cut-edge vertices interpolate and normalize the original influences.

The tee uses the supplied `SpatialHouse/public/images/brand/mark.png` unchanged in a baked 1024×1024 atlas. Front: mark + **SPATIAL HOUSE** underneath. Back: mark + **SPATIAL HOUSE** + **Real spaces. Global possibilities.** Palette comes from SpatialHouse CSS: paper `#f4f1eb`, ink `#1b1916`, bronze `#7a5a34` / `#5c4326`, sand. Pants are charcoal, shoes sand. glTF UVs use top-left V=0; front and back vertices have separate UV seams to keep text upright and readable.

## Runtime asset and animation

`public/labs/prod02b/avatars/spatial-house-avatar.glb` is the sole runtime download, with geometry, skin, texture and eight explicitly named actions. `spatial-house-avatar.meta.json` contains measured counts. Original `standing.glb`, `walk.glb`, `left.glb`, `right.glb` are immutable build inputs and are no longer fetched at runtime.

| Action | Source / behaviour |
| --- | --- |
| Idle | Original standing[0], ~6.03 s |
| Walk | Original walk[1], ~1.07 s |
| Run | Authored 0.72 s loop on the original rig: opposing arm/leg swing, bent elbows, knee recovery, torso lean/twist and flight bob. **Not** a sped-up Walk clone. |
| JumpStart | Authored 0.12 s anticipation crouch, feet grounded |
| Jump | Authored 0.64 s airborne action, leg tuck and arm motion |
| Land | Authored 0.16 s landing compression and recovery |
| TurnLeft | Original left[3], ~0.97 s |
| TurnRight | Original right[2], ~1.03 s |

The original GLBs accumulate earlier actions: the longest clip in all four is the 6.03 s Idle, which was the verified sliding cause. The builder maps those original actions explicitly; the runtime resolves the new actions by name. Missing actions report an error instead of falling back to Idle.

Bone transforms/inverse bind matrices and source pelvis tracks are normalized together from the original rotated centimetre-scale armature. Other source local rotation curves retain the original rig. Runtime clips remove X/Z pelvis drift and **preserve Y movement** for run flight, crouch and landing. The controller remains authoritative for world position.

## Controls and jump sequence

- WASD / arrows: camera-relative movement, character turns smoothly toward travel.
- Shift + movement: 1.7× speed and the independent Run clip. Diagonal speed is capped.
- Q/E: body and camera heading turn together.
- Space: `grounded → takeoff (0.12 s) → airborne → landing (0.16 s) → grounded`.
- Flight: 4.6 m/s launch, 14.7 m/s² gravity, ~0.72 m peak, ~0.626 s flight on level ground. The follow camera tracks the elevated body.
- Holding Space does not auto-bounce. Focus loss releases input; pose/floor/navigation changes clear jump state.
- Mouse drag looks; scroll zooms. PROD-02B starts at 2.8 m boom / 1.0 m target, independent of approved PROD-02A presets.

Gameplay remains opt-in through `enableAvatarLocomotion`. Existing ground/capsule collision stays authoritative during flight; jumping is not obstacle vaulting or rigid-body platforming. An upward ray limits rise at ceilings based on the resized model's height. Collision depends on the loaded scan's collision data.

## Rendering and budgets

- **8,354 triangles, 13,322 vertices, 65 joints, five material draws.** Clean shirt/waist/cuff/hair cuts and facial details account for the increase from the original 5,606 triangles.
- **1,256,492 bytes (~1.20 MiB)**, versus ~2.2 MB previously loading four meshes. One embedded 1K PNG atlas.
- Unlit materials preserve logo texture, palette and baked vertex shading; no avatar lights, shadows, cloth simulation, subdivision or morph targets.
- Normals remain standard float glTF; joint/weight/color attributes use aligned bytes, UVs normalized shorts. No Draco decoder is needed at runtime.
- One animation mixer; 66 tracks/action instead of the old 194. Avatar diagnostics are throttled to 150 ms. Shared geometry/material/texture resources are disposed on unload.
- Studio shows two characters at about 60 fps on this machine. This measures the character alone, **not** the full LCC scene's rendering budget.

## Rebuild

Node 22+, project dependencies (`draco3d` is a build-only dev dependency), Python + Pillow:

```sh
python3 scripts/labs/create-prod02b-shirt-atlas.py /path/to/SpatialHouse/public/images/brand/mark.png
node scripts/labs/build-prod02b-avatar.mjs
node scripts/labs/test-prod02b-avatar.mjs
```

The builder reads originals only, deforms the existing mesh, clips clean clothing boundaries, interpolates existing weights, bakes the authored skeletal curves and writes a new standalone GLB + manifest. Re-running is deterministic. No Blender installation is required. Blender 3.6 and a separate official 4.5 LTS both crashed before Python execution in this session, so the completed edits were made directly in glTF. The final GLB can be imported into Blender for further editing.

## Validation and playtest

Automated checks load the actual new geometry and skeletal curves (only the browser-only PNG reference is omitted in Node), verify named clips, skin binding, real leg changes, human height, asset/draw budgets, sprint, capped diagonals, takeoff/flight/landing order, ceiling, teleport, blur and opt-in isolation. The Khronos glTF validator reports **0 errors / 0 warnings**. TypeScript checks pass. In the full downstairs LCC2 scene, the new character loaded with collision data and 66 bound Walk tracks; keyboard movement and Space selected Walk and Jump. Full scan rendering was ~19 fps on Balanced quality during that check. Both floors still need the manual movement/collision checklist below.

Manual pass:

1. Inspect both sides in `/labs/prod-02b/avatar`; use **Inspect shirt print** for logo/name/motto.
2. Preview Stand, Walk, Run, Jump, both turns. Run must differ from Walk; Jump must crouch, lift, tuck and land.
3. In the LCC lab, test WASD, Shift, Space, Q/E, drag/zoom; push against walls, pass doorways and jump near low ceilings.
4. Switch both floors and camera styles; test cancellation during a jump, window blur, capsule / character and first-person / orbit modes.
5. Validate the feel on the target device before promoting to the final product. This change is not published or pushed.

## Changelog

| Date | Change |
| --- | --- |
| 2026-11-03 | Isolated Mixamo avatar on PROD-02A navigation, four imported GLBs, capsule and camera comparisons |
| 2026-11-08 | Fixed sliding caused by selecting accumulated Idle; first movement/jump prototype and regression tests |
| 2026-11-08 | Spatial House outfit and human proportions; standalone normalized GLB; independent authored Run / JumpStart / Jump / Land, phased controller, front/back studio, standard glTF validation and asset budgets |
