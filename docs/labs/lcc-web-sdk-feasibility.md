# Lab LCC-WEB-01 — XGRIDS LCC Web SDK feasibility

**Status (2026-10-17):** SDK audited; isolated playground at `/labs/lcc-web-sdk` (**Plain Three.js only** — R3F UI hidden for now). Client-tour prototype: `/labs/spatial-experiences` (LAB EXP-01). Local sample packages selectable (Room default). Independent of LiDAR, camera-calibration, and Nerfstudio pipelines. No cloud spend.

| Item | Location |
|------|----------|
| SDK (vendored) | `public/vendor/lcc-web-sdk/0.6.3/` (`lcc-sdk-three.js` + `.d.ts`) |
| Playground | `/labs/lcc-web-sdk` |
| Sample (gitignored) | `public/labs/lcc-samples/Room_tour_L2_PRO_P/meta.lcc2` |
| Source package | `~/Downloads/LCC-Web-0.6.3.zip` / extracted folder |

---

## 1. Confirmed SDK capabilities (from package inspection)

Source: `README.md`, `sdk/lcc-sdk-three.d.ts`, `examples/three*.html`.

### Loading formats

| Format | Evidence |
|--------|----------|
| **`.lcc` meta packages** | README + `three.html` default `assets/ConfuciusTemple/meta.lcc` |
| **`.lcc2` meta packages** | XR example `meta.lcc2`; sample ZIPs use `meta.lcc2` + `data/3dgs/*.sog` |
| **`LccFileInfo` object** | Typed alternative to a single URL (index/data/meta/env/collision/shcoef URLs) |
| **Splat payload** | Samples: `splatType: ".sog"` under `data/3dgs/` |
| **Environment** | `useEnv` / `useEnvironment`, `hasEnvironment`, `env.sog` in samples |
| **Collision mesh** | `hasCollision`, `intersectsRayExt`, `getCollisionGeometry`; Home/Room samples include `data/mesh/*.ply` |
| **SH coefficients** | `useShcoef` / `hasShcoef` (optional package part) |

**Not LCC:** Spatial Lab Nerfstudio PLY / SuperSplat scenes — do not use them to claim LCC compatibility.

### Three.js dependency

| | Version |
|--|--------|
| Spatial Lab `three` | **0.186.1** (`REVISION` 186) |
| SDK examples’ bundled Three | **r184** |
| SDK API | Takes `renderLib: THREE` + `renderer` + `scene` + `camera` + `canvas` at load time |

Close major line (184 vs 186). Compatibility must be **runtime-proven** (playground does this). Cesium build also ships; out of scope for this lab.

### Core API (`LCCRender`)

- `load` / `unload` / `dispose` / `update` / `setCamera`
- `getVersion`, `clearIndexDB`, `setOffscreenRender`, `setWriteDepth` (Three-only)
- Per-model (`LccObject`): LOD, max splats/distance, visibility, alpha, points colour, semantic colours, clip box/plane, select box, env/SH toggles, raycast + collision intersects, optional reveal effect

### Rendering / navigation (examples)

- Perspective + orthographic cameras (`three_ortho.html`)
- First-person controls (SDK sample) and OrbitControls (commented in basic example)
- Loading reveal effects (`ring` / `wave`)
- IndexedDB tile cache (`useIndexDB`)
- XR / WebXR (`three_xr.html`, HTTPS required)
- Host cache / GPU cache / download concurrency knobs on `LoadOptions`

### Interaction (API + pick example)

- Splat pick: `raycast({ evt, maxDistance, radius })` → point
- Collision pick: `intersectsRayExt` → `{ point, normal }` (preferred over deprecated `intersectsRay`)
- Capsule / sphere intersects for locomotion collision
- Clip box / clip plane for sectioning

### Licensing / app key (unresolved)

- `LoadOptions.appKey?: string` — examples pass `appKey: null` with comment “replace your key”
- No license text in the ZIP README beyond linking to developer.xgrids.com
- **Open:** whether production / branded tours require a paid developer key; sample data with `null` may still load locally

---

## 2. Successfully tested features

Runtime on 2026-10-17 against Room sample (`meta.lcc2`), Spatial Lab Three **r186**, SDK **0.6.3** UMD:

| Feature | Status |
|---------|--------|
| UMD load via `window.THREE` + `/vendor/.../lcc-sdk-three.umd.js` | **OK** (ESM bare `from "three"` fails without import map — avoided) |
| Load `meta.lcc2` Room sample | **OK** (progress → 100%, phase `ready`) |
| Progress callback | **OK** |
| Meta / bounds HUD | **OK** (`XGrids Lcc2 Splats · quality · splats 6009120`; bounds returned) |
| `hasEnvironment` / `hasCollision` | **OK** (both true on Room) |
| FPS overlay | **OK** (~23–27 FPS in lab browser at load) |
| Extra Three mesh in same scene | **OK** (demo box visible) |
| Ctrl+click splat `raycast` | **OK** (returned world point e.g. `(0.000, 1.957, 5.490)`) |
| Orbit / first-person / reset / env / clip | Wired in UI — orbit used during PoC; others available |
| Collision `intersectsRayExt` | API ready; Room reports collision — exercise via UI “Pick collision” |
| R3F shared scene + `useFrame` update | **API OK** (progress 100%, meta/bounds/collision reported) — **visual incomplete** at default camera (demo box only; needs framing / depth follow-up). Prefer plain host for tours. |

Distinguish: **API inspected** (section 1) vs **runtime exercised** (this table).

---

## 3. Compatibility issues

| Issue | Notes |
|-------|--------|
| Three r184 (examples) vs app r186 | **Works** for Room load on plain host (r186 + SDK 0.6.3 UMD) |
| ESM `from "three"` | Fails under Next without import map → use **UMD** + `window.THREE` |
| R3F bridge | Load callbacks succeed; splat visibility at default framing not confirmed — do not assume R3F-ready for product yet |
| Host switch + `dispose()` | Disposing the singleton breaks the other tab → **unload only** |
| Coordinate frame | Official `modelMatrix` maps LCC Z-up → Three Y-up; Spatial Lab LiDAR uses a different convention — keep LCC tours in their own world |
| `usePage: true` | Set when `dataPath` ends with `.lcc2` (matches XR example) |
| Next.js bundling | Vendor loaded via runtime `import()` of a **public** URL so Turbopack does not parse the 1.8 MB bundle |
| Sample size | Room package ~100 MB+; keep under gitignore |

---

## 4. Model formats actually tested

| Model | Format | Source |
|-------|--------|--------|
| `Room_tour_L2_PRO_P` | **LCC2** (`meta.lcc2` + `.sog` + `data/mesh`) | Local `~/Downloads/LCC Sample Data/Room_tour_L2_PRO_P.zip` |
| ConfuciusTemple | `.lcc` (docs only) | Not present locally; official sampledata page |
| Nerfstudio PLY | — | **Not tested** (intentionally) |

Other local ZIPs available (not yet extracted into the playground): Church, ConferenceHall, PentHouse, Sculpture, TrainMuseum, Office Showroom, XGRIDS_Revit__Home.

---

## 5. App-key and licensing questions still unresolved

1. Is `appKey: null` allowed only for official samples, or for any self-hosted LCC2?
2. What domains / watermarks apply without a key?
3. Redistribution rights for the SDK JS vs sample assets vs client captures?
4. Commercial branded property-tour terms?

Ask XGRIDS via https://developer.xgrids.com/#/forum or account docs before production use.

---

## 6. Recommended architecture for Spatial Lab

```
/labs/lcc-web-sdk          ← isolated feasibility / tour prototyping (this lab)
/gaussian-viewer           ← SuperSplat / our trained PLY (unchanged)
/ (LiDAR) + /camera-calibration  ← unchanged
```

**Tour product path (proposed):**

1. Keep **LCC as a separate rendering backend** behind a tour route (e.g. `/tours/[id]`), not inside the LiDAR R3F scene.
2. Prefer **plain Three.js + LCCRender** (or a thin React wrapper that owns one canvas) until R3F bridge is proven stable across devices.
3. Use LCC collision / raycast for hotspots and optional first-person locomotion; store hotspot anchors in app JSON (world positions in LCC frame after `modelMatrix`).
4. Serve LCC packages from local/static or signed CDN URLs; never mix with COLMAP/LAS frames without an explicit transform product.
5. Continue independent Gaussian reconstruction for research / non-LCC assets.

---

## 7. Suggested next development steps

1. Confirm Room sample loads in the playground; complete the runtime table above (pick, clip, env, R3F).
2. Extract a second sample (e.g. Sculpture or Home) and compare `hasCollision` / env.
3. Resolve **appKey** requirements with XGRIDS.
4. Prototype a branded shell (logo, hotspot list, mobile layout) on top of the plain host.
5. Mobile Safari/Chrome perf pass on a mid-size LCC2.
6. Only then consider wiring a property-tour CMS; keep calibration / Nerfstudio labs untouched.

---

## Sample data note

Local sample ZIPs were already under `~/Downloads/LCC Sample Data/`. The playground extracts **Room_tour_L2_PRO_P** into `public/labs/lcc-samples/` (gitignored). Additional packages can be unzipped the same way. Official listing: https://developer.xgrids.com/#/download?page=sampledata.
