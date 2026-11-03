# LAB PROD-02A — Smooth LOD, Point & Move, camera polish

**Status (2026-11-03):** Implemented in Spatial Lab property player + shared tour host. No avatar. No paid cloud.

## Your Spintex Gaussian counts

| Floor | Total Gaussians in file | LOD levels (coarse→fine pyramid) |
|-------|-------------------------|----------------------------------|
| Ground | **13,284,470** | 5 bands: ~6.9M / 3.4M / 1.7M / 0.86M / 0.43M |
| First | **13,026,304** | Similar 5-level split |

The graphics lever does **not** load the whole file. `setMaxSplats` is a **draw budget** (how many the GPU may show at once). Distant areas still use coarser LOD tiles inside that budget.

So Ultra at 6M ≈ half the file’s Gaussians as a ceiling — still heavy for a browser.

## What the three knobs mean

| Knob | SDK / renderer call | Meaning |
|------|---------------------|---------|
| **Max splats** | `lcc.setMaxSplats(n)` | Cap on Gaussians drawn. Lower = smoother FPS, softer far detail. |
| **Draw distance** | `lcc.setMaxDistance(m)` | How far (metres) tiles may load. Lower = less far scenery, cheaper. |
| **Pixel ratio** | `renderer.setPixelRatio(cap)` | Sharpness vs fill-rate. 1× = 1 CSS pixel → 1 GPU pixel; 2× = retina cost. |

**LOD smoothing** (`lcc.setSmooth(true)`) is separate: it eases popping when LOD levels swap. It is **not** walk acceleration. Already enabled by default when the SDK exposes it (0.6.3 types include `setSmooth`).

## Graphics presets

**Ladder** (scale all three knobs together):  
Eco → Perf → Std → **Balanced** → Plus → Quality → High → Ultra

**Mix tests** (uncouple knobs for A/B):  
Near dense (4M·30m·1×), Near sharp, Dense 1×, Far 1×, Far light, Far crisp, Mid mix  

Use Mix tests to compare e.g. many Gaussians + short distance + 1× vs fewer Gaussians + far + 2×.  
(see `lib/labs/experiences/qualityPresets.ts`)

## First Floor → Ground stairs

| Piece | Value |
|-------|--------|
| Stop (trigger) | `(-4.82, 0.45, -5.28)` |
| Beyond (void direction) | `(-5.17, 0.35, -4.68)` |
| Soft block | `block-stair-void` past beyond |
| Modal | “Go downstairs?” → loads Ground Floor scene |

Seeded in `spintexSeed.ts`; existing drafts get it via `ensureSpintexStairDefaults`.

## Navigation audit

| Mode | Mechanism | Notes |
|------|-----------|--------|
| Perspective camera | Always (Three `PerspectiveCamera`) | Orthographic not used |
| Walk | `LccWalkControls` first-person | Soft accel/friction; collision slide |
| Point & Move | Click walkable floor → move target | Collision + LOS probe; cancel WASD/Esc |
| Orbit | `OrbitControls` | Double-click sets pivot |
| Avatar click-nav | Not implemented | Spec: no humanoid yet |
| `setSmooth` | LOD transitions | Enabled on load via `applyQuality` |

## Manual tests

1. `/labs/property-experience` → First Floor.
2. Graphics: Ladder Eco→Ultra, then Mix tests (Near dense vs Far crisp); watch FPS + near detail vs far haze.
3. **Walk**: WASD + pads; feel soft stop.
4. **Point & Move**: click open floor → bronze ring → walk there. Click behind a wall → should refuse. WASD mid-path → cancel.
5. **Orbit**: drag; double-click a wall/floor → pivot jumps there.
6. Change Floor mid Point & Move → path must die (host remount).
7. Narrow doorway / furniture: should slide or stop, not clip.

### Pathfinding

Not built. If LOS is blocked, Point & Move refuses. Around-corner routing needs a navmesh later.

## Changelog

| Date | Note |
|------|------|
| 2026-11-03 | 8-step quality ladder; softer walk; Point & Move + orbit pivot; setSmooth default on |
| 2026-11-03 | Mix-test quality presets; First→Ground stair stop/modal from author positions; auto-persist floor start |
