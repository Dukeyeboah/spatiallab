# LAB EXP-02 — Performance, navigation, floor map and collision

**Status (2026-10-17):** Incremental upgrade on LAB EXP-01. Plain Three.js + XGRIDS LCC Web SDK **0.6.3**. No R3F for this renderer. No cloud spend. Sample packages remain **proprietary XGRIDS demos** — not for public deploy without verified rights.

| Item | Location |
|------|----------|
| Route | `/labs/spatial-experiences` |
| Host | `components/labs/experiences/ExperienceTourHost.tsx` |
| Walk | `lib/labs/lccWalkControls.ts` |
| Quality presets | `lib/labs/experiences/qualityPresets.ts` |
| Floor map | `components/labs/experiences/FloorMapPanel.tsx` |
| Catalog | `lib/labs/experiences/catalog.ts` |
| SDK playground | `/labs/lcc-web-sdk` (unchanged) |

## Architecture (unchanged)

Next.js UI + plain Three.js + LCC SDK. Catalog / overrides stay separate from LCC tiles (`localStorage` `spatial-lab.experiences.overrides.v1`).

## Phase results

### 1. Performance

**Diagnosis (Room, M2 Mac, development):**

| Signal | Observation |
|--------|-------------|
| FPS / frame time | Room under EXP-01-style load typically ~35–50 fps with UI open; spikes when LOD streams or after scene switch |
| Gaussian budget | Room meta ~6.0M total; live budget via `setMaxSplats` matters more than meta total |
| DPR / canvas | Uncapped DPR on Retina was a major cost; presets now cap 1 / 1.5 / 2 |
| Load time | Room first load typically a few seconds (IndexedDB + tiles); PentHouse slower (~180 MB) |
| LOD | `setLodAutoLevelUp(true)` + `setMaxDistance` used; `setMaxNodeSplats` **skipped** (legacy LCC, not LCC2) |
| React | Host keeps one mount per `dataPath`; stats/UI via refs — no per-frame React setState except throttled FPS (~2 Hz) and pose (~8 Hz) |
| Collision cost | Capsule + floor ray only on walk wish movement — not tied to splat count |

**Presets (starting benchmarks):**

| Preset | maxSplats | maxDistance | pixelRatioCap |
|--------|-----------|-------------|---------------|
| Performance | 750K | 35 m | 1 |
| Balanced (default) | 1.5M | 55 m | 1.5 |
| Quality | 2.5M | 80 m | 2 |

**Measured (Room, local Chrome via Cursor browser, ~706×448 viewport, Walk idle after load warm, Dev panel FPS, 2026-10-17):**

| Preset | FPS | DPR | Budget | maxDistance |
|--------|-----|-----|--------|-------------|
| Performance | **59** | 1.00 | 0.75M | 35 m |
| Balanced (default) | **56** | 1.50 | 1.5M | 55 m |
| Quality | **41** | 2.00 | 2.5M | 80 m |

Room first-ready log: load **3110 ms**, collision **yes**. EXP-01 previously used uncapped DPR (often 2) + a free max-splats slider — Quality-like settings felt choppier on move. Note: Dev `ms/frame` is CPU tick only (often &lt;1 ms) and understates GPU cost; use FPS as the primary smoothness signal.

### 2. Walk navigation

- **Walk is default** for all catalog scenes
- WASD / arrows, mouse drag look, **double-click** canvas for pointer lock, **Shift** sprint, **Esc** unlock
- Acceleration / deceleration; eye height 1.55 m locked in walk
- Reset restores interior view from capture poses / fallback
- First-visit Help overlay + **Help** button; copy lists only implemented controls
- Hotspot clicks still work; walk keys use capture-phase `window` listeners (skip when typing in Dev inputs)
- **Fix (post EXP-02):** capsule was intersecting the floor every frame and zeroing velocity — walk felt dead. Capsule now clears the floor (`CAPSULE_FOOT_CLEARANCE`); axis-separated slide; click scene to focus canvas

### 3. Viewpoints / rooms

- Viewpoints support `roomId`, `order`, optional `mapUv`
- Visitor **Rooms** list from unique room labels
- Dev: Capture → name + room → Save; reorder ↑↓; Del (hides built-ins)
- Fly-to: smooth lerp when path clear; **fade-and-teleport** when collision ray hits geometry between eye positions
- PentHouse / Revit Home: **no invented rooms** (`viewpointsReady: false`)

### 4. Floor map

- Expandable panel (Room only initially): manual `worldBounds` AABB — **not** `getBounds()`
- Markers from `mapUv` or projected eye XZ
- Visitor position / facing arrow from pose ticks
- Multi-floor data model (`floors[]`); sample uses one floor
- Optional `imageUrl` for a plan image later

### 5. Collision

| Scene | `data/mesh` | `hasCollision()` expectation | Notes |
|-------|-------------|------------------------------|-------|
| Room | 8 PLY tiles | yes when SDK builds mesh | Capsule slide + floor ray follow |
| Revit Home | 8 PLY tiles | yes when SDK builds mesh | Same path; viewpoints empty until inspected |
| PentHouse | **no mesh folder** | no | Collision toggle inert; walk without walls |

**Tests (Room):**

- Walking into walls: capsule `intersectsCapsule` pushes with delta (slide along, not hard stick in most cases)
- Floor follow: downward `intersectsRayFromOriginExt` keeps eye height
- Doorways: passable when mesh opens; if mesh is coarse, may feel sticky — Dev can disable collision
- Teleport to viewpoint: fade path when blocked; destination not re-validated against interior void (safe fall-back if mesh incomplete)

**Limitation:** Collision quality depends on XGRIDS collision PLYs. If `hasCollision()` is false after load, UI shows “no collision mesh” and walk ignores capsule resolve. Do not claim wall-solid without `hasCollision === true` in Dev stats.

### 6. Revit Home sample

- Zip located: `~/Downloads/LCC Sample Data/XGRIDS_Revit__Home.zip`
- Extracted: `public/labs/lcc-samples/XGRIDS_Revit__Home/` (`meta.lcc2`, ~4.15M splats, ~49 MB)
- Scene selector: Room · Penthouse · **Revit Home**
- **Verified load:** ready · **60 fps** · load **3969 ms** · splats **4148359** · **collision yes**
- Starting camera via existing interior-view resolver (may start close to a wall — walk/Reset; no named rooms until inspected)

**PentHouse check:** ready · ~60 fps idle (Balanced) · **10.7M** meta · hint **no collision mesh** (no `data/mesh`) · rooms empty by design.

### 7. Client UI

Property title / subtitle, scene selector (dev), quality, Walk/Orbit, Reset, Help, Rooms, Hotspots, Hide UI, Fullscreen, floor map, loading bar, Dev tools (stats, collision, authoring). Scene stays full-bleed behind chrome.

### 8. Remaining issues / next stage

1. Measure collision fidelity more rigorously (stuck corners, stair gaps) once Room mesh normals are trustable
2. Author PentHouse / Revit viewpoints after walking — never invent room names
3. Optional floor-plan image + map marker admin UI (click-to-place UV)
4. Touch / mobile walk still deferred until desktop collision + FPS are reliable
5. Confirm commercial license / `appKey` before any public deploy

## How to open

1. Samples under `public/labs/lcc-samples/` (see README; gitignored)
2. `npm run dev` → `/labs/spatial-experiences`
3. Prefer **Balanced**; drop to **Performance** if choppy
4. SDK diagnostics remain at `/labs/lcc-web-sdk`
