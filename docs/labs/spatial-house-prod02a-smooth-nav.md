# LAB PROD-02A — Smooth avatar navigation (isolated)

**Status (2026-11-03):** Camera V2 approved + **PROD-02A.1** mobile joystick / touch look. Does **not** replace PROD-01 `/labs/property-experience`. Default FOV **65°**.

## Open

**http://localhost:3000/labs/prod-02a**

## Root-cause audit (V1 → V2)

| Issue | Cause in V1 | Fix in V2 |
|-------|-------------|-----------|
| A/D / body turn spun the camera | `followYaw = damp(bodyYaw + orbitYaw)` | Absolute `camYaw` / `camPitch` owned only by mouse / look pad |
| Walking recentered behind avatar | `recenterBehind` default **on** | Free Follow never recenters; Ecctrl recenter **off** by default + delay |
| Look-at fought orbit | `lookAt` used body-facing offset | Framing target + quaternion from user yaw/pitch |
| Camera pushed through walls | Soft position damp after a single ray | Boom with sphere samples + multi-ray; **hard clamp** inward each frame |
| Fixed boom length | Single `cameraBackOffset` | Preferred / min / max + fast inward / slow outward |

**Baseline preserved:** nav kind **Current (1P)** still uses `LccWalkControls`. Free Orbit (Three.js) unchanged for look-around.

## Camera styles (Smooth nav)

### A. Free Follow (XGRIDS-inspired) — primary

- Tracks follow target on the invisible body with light lag
- Mouse / look pad owns yaw & pitch; movement never rotates the camera
- Camera-relative WASD on the horizontal plane
- Boom shortens into tight rooms; restores preferred distance outdoors
- **No** automatic behind-avatar recenter

### B. Ecctrl-inspired Orbit Follow

- Same movement controller + collision boom
- Optional recenter behind body after idle delay (default **off**)
- Manual drag cancels recenter immediately

## Architecture (separate states)

1. **Movement controller** — body position, velocity, body yaw, capsule, `setMoveIntent` (keyboard / pads / future Point & Move)
2. **Camera orientation** — `camYaw`, `camPitch`, look idle timer
3. **Follow target** — smoothed point at `targetHeight` + framing offsets
4. **Camera boom** — preferred / current / min / max, obstruction flag
5. **Presentation** — third-person boom, optional first-person fallback when boom collapses

## Collision-aware boom

When walk/camera collision is on and `lcc.hasCollision()` is true:

1. Sphere samples along target → preferred camera
2. Center + offset rays reinforce corner hits
3. Inward correction uses high responsiveness + hard clamp (no damp-through-wall)
4. Outward recovery is slower for comfort
5. Near-clip / margin via `collisionMargin` + `cameraCollisionRadius`

**Not verified** where mesh is missing — see limitations. Do not treat Gaussian appearance as solid geometry.

## Dev Mode

- Camera style Free / Ecctrl
- Follow, rotation, collision, movement sliders
- Save / Restore / Clear preset (localStorage), Reset defaults, Production preset
- Capsule + camera debug gizmos + readout (preferred / boom / obstructed / yaw)
- Scroll wheel adjusts preferred boom length

Visitor Preview: leave Dev Mode unchecked (gizmos off).

## Manual tests (bathroom → doorway → kitchen)

Use Downstairs LCC2 with **collision yes** in the stats line.

| Scenario | Expect |
|----------|--------|
| A Open room | Preferred boom holds; A/D does not yaw camera; mouse orbits freely |
| B Small bathroom | Boom shortens; avatar fills more of the frame; no wall clip / oscillation |
| C Doorway | Boom pulls in at frame; restores after exit; no door-jamb tunnel |
| D Kitchen | Distance recovers smoothly; character turn ≠ camera turn |
| E Style compare | Same path: Current / Free Follow / Ecctrl (+ recenter on/off) |
| F Gaps | Note rooms where `obstructed` stays no while splat wall is visible → mesh hole |

## Known limitations

- Camera collision requires SDK `intersectsSphere` / `intersectsRayFromOriginExt` and package `data/mesh`
- Thin furniture or missing mesh ⇒ possible clip; report exact spot, do not mark verified
- Sphere stepping is an approximation (not a true swept capsule)
- Point & Move pathfinding not implemented; `setMoveIntent` is the shared intent hook only
- PROD-01 not merged

## Recommended preset (lab default / production-leaning)

After bathroom/doorway smoke on this package:

| Knob | Lab default | Production preset |
|------|-------------|-------------------|
| Style | Free Follow | Free Follow |
| Preferred distance | 1.35 m | 1.45 m |
| Min distance | 0.38 m | 0.40 m |
| Inward / outward | 28 / 4.5 | 32 / 3.8 |
| Recenter | off | off |
| Facing | face-move | face-move |

Tune live, then **Save preset** or apply **Production preset**.

## vs official XGRIDS viewer

Observations from reference screenshots (not confirmed internals): independent view angle, closer boom in tight rooms, wider in open space, walls respected. Our Free Follow targets that behavior with an explicit boom + mesh probes.

## PROD-01 integration (later — do not merge yet)

1. Feature-flag Free Follow behind Dev / visitor opt-in
2. On room / floor change: `cancelMotion()`, reset boom, rebind collision, safe camera place (no wall lerp)
3. Point & Move → `setMoveIntent` / future path follower on the same body
4. Keep stair triggers / starts untouched until approved

## PROD-02A.1 — Mobile joystick & touch look

Same Smooth / Walk controller. Joystick → `setMoveIntent`; right-zone drag → `applyLookDelta`. No second mover, no Ecctrl/R3F.

| Control | Behavior |
|---------|----------|
| Left zone + joystick | 360° stick, dead zone, magnitude → speed (no auto-sprint) |
| Right zone | Multitouch-safe look; release stops immediately |
| Dev → Mobile controls | Size, opacity, dead zone, sensitivities, fixed/floating, L/R layout, force-on-desktop |
| Visitor | Auto when `(pointer: coarse)` / touch; quality presets unchanged |

Joystick engage calls `cancelAutoMove` (Point & Move ready later).

### Desktop smoke (done in lab tooling)

1. Force-on-desktop → stick diagonals + look multitouch (DevTools device mode)
2. Free Follow + Ecctrl: stick does not yaw camera
3. Keyboard after stick release still walks
4. Panel clicks do not move avatar (zones under panel / limited height)
5. FOV default 65

### Real-device checklist (required before “production-ready mobile”)

- [ ] iOS Safari portrait + landscape: stick + look simultaneous
- [ ] Android Chrome: same
- [ ] Safe-area / home indicator clearance
- [ ] Narrow doorway + wall boom while using stick
- [ ] Performance / Balanced / High while walking
- [ ] Release / cancel / finger leaves stick boundary
- [ ] Open Dev panel mid-move — no stuck intent
- [ ] No page scroll/zoom from control surfaces

## Changelog

| Date | Note |
|------|------|
| 2026-11-03 | Isolated lab; LCC2; Current vs Smooth; quality presets |
| 2026-11-03 | FOV 55°; Ground start; Orbit; third-person follow |
| 2026-11-03 | Softer turn; closer follow; single-ray pull-in |
| 2026-11-03 | **V2:** decoupled cam yaw; Free + Ecctrl styles; sphere/multi-ray boom; fast-in/slow-out; Dev presets + debug |
| 2026-11-03 | **02A.1:** mobile joystick + touch look; FOV 65°; shared intent API; Dev mobile panel |
