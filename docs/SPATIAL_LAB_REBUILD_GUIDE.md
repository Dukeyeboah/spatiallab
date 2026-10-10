# Spatial Lab — Rebuild Guide for Coding Agents

This document is a complete, self-contained specification for rebuilding **Spatial Lab** (a browser-based LiDAR point-cloud learning lab) or a variant of it for another web purpose. Give it to a coding agent together with the dataset files and one of the prompts in [section 12](#12-prompt-templates).

It is maintained alongside the code: every lab that changes the app also updates this guide (see the [changelog](#13-changelog)).

---

## Contents

1. [What Spatial Lab is](#1-what-spatial-lab-is)
2. [Guiding principles](#2-guiding-principles)
3. [Stack, versions and project setup](#3-stack-versions-and-project-setup)
4. [Architecture](#4-architecture)
5. [Data: formats, conversion and coordinate frames](#5-data-formats-conversion-and-coordinate-frames)
6. [Rendering pipeline](#6-rendering-pipeline)
7. [Lab-by-lab build specification](#7-lab-by-lab-build-specification)
8. [Pitfalls we hit and how they were fixed](#8-pitfalls-we-hit-and-how-they-were-fixed)
9. [Validation playbook](#9-validation-playbook)
10. [Adapting Spatial Lab for different web purposes](#10-adapting-spatial-lab-for-different-web-purposes)
11. [Not built yet / roadmap](#11-not-built-yet--roadmap)
12. [Prompt templates](#12-prompt-templates)
13. [Changelog](#13-changelog)

---

## 1. What Spatial Lab is

A deliberately small Next.js + React Three Fiber app that renders a **real** LiDAR scan in the browser and grows one concept at a time:

| Lab | Topic | Concept learned |
| --- | --- | --- |
| 1 | Point cloud viewer | typed arrays → `BufferAttribute` → `BufferGeometry` → `<points>` |
| 1b | Point budgets + `r3f-perf` | how point count affects density, loading and frame time |
| 2 | Scanner trajectory | shared coordinate frames, offsets, aligning two datasets |
| 2B | Pose playback | position + quaternion orientation |
| 3 | Shader Points | the WebGL vertex/fragment pipeline, uniforms, varyings |
| 3b | Camera framing | robust bounds, OrbitControls target, reset view |
| 4 | Soft points | alpha, blending, `depthWrite`/`depthTest` tradeoffs |
| 5 | Elliptical Gaussian | anisotropic Gaussians, rotation, covariance (pre-splatting) |
| 6 | 3D Gaussian projection (separate page `/gaussian-projection`) | Σ3D = R S Sᵀ Rᵀ, Jacobian projection Σ2D = J W Σ3D Wᵀ Jᵀ, screen-space quads |
| 7A | Multi-dataset import (local FastAPI backend) | per-dataset offsets and metadata, background conversion, pose/frame validation, safe local storage, GPU disposal on switch |
| 7B | Gaussian compositing (separate page `/gaussian-compositing`) | many Gaussians in one instanced draw call, depth sorting, front-to-back alpha compositing, transmittance, animation |

The dataset used: a handheld/SLAM LiDAR scan (`map.las`, 5,242,880 points, 178 MB, local metric frame, RGB) plus `poses.csv` (208 poses, 5 Hz, 41.4 s).

## 2. Guiding principles

These are requirements, not suggestions. They shaped every decision.

1. **Learning first.** Code is minimal and heavily commented. Prefer clarity over abstraction or optimisation. One concept per lab.
2. **Never fake data.** No generated/synthetic point clouds. If data is missing, show an error, don't invent it.
3. **One shared world frame.** Every dataset in the LAS frame (points, poses, future annotations) subtracts the **same fixed offset** and lives inside the **same Z-up → Y-up group**. Never re-centre a dataset independently.
4. **Never "hack" alignment visually.** If two datasets don't line up, stop and diagnose the transform; don't nudge them.
5. **Don't change what wasn't asked.** Each lab preserves all previous features (point budgets, trajectory, playback, camera, `r3f-perf`, Standard Points).
6. **Verify, don't assume.** Type check, production build, and a headless-browser check with screenshots/pixel metrics after every lab (section 9).
7. **No heavy dependencies** unless a lab explicitly calls for them.

## 3. Stack, versions and project setup

Versions that are known to work together:

| Package | Version | Notes |
| --- | --- | --- |
| `next` | 16.3.8 | App Router, Turbopack by default |
| `react` / `react-dom` | 19.3.0 | |
| `three` | 0.186.1 | |
| `@react-three/fiber` | 9.8.1 | |
| `@react-three/drei` | 10.7.9 | only `OrbitControls` is used now |
| `r3f-perf` | 7.2.3 | performance overlay |
| `typescript` | **5.9.x** | pin to 5 (see pitfalls) |
| `@types/three`, `@types/react`, `@types/react-dom`, `@types/node` | matching | dev |

Python (converter only): `python3`, `laspy`, `numpy` (`laspy[lazrs]` for `.laz`).

Setup from an empty folder (create files by hand rather than an interactive scaffolder):

```bash
npm init -y   # then set scripts: dev/build/start = next dev/build/start
npm install next react react-dom three @react-three/fiber @react-three/drei r3f-perf
npm install -D typescript@5 @types/react @types/react-dom @types/node @types/three
```

Required config:

- `tsconfig.json`: standard Next.js config with `"paths": { "@/*": ["./*"] }`, `strict: true`, `moduleResolution: "bundler"`.
- `next.config.ts` — **required once `r3f-perf` is installed**:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  experimental: {
    // r3f-perf ships a source map pointing at a binary font file, which crashes
    // Turbopack when it tries to read it as text.
    turbopackInputSourceMaps: false,
  },
};
export default nextConfig;
```

- `.gitignore`: `node_modules`, `.next`, `*.las`, `*.laz` (raw scans are large).
- Next.js 16 writes an `AGENTS.md`/`CLAUDE.md` block on `next dev`; leave it.

### 3.1 Local dataset backend (Lab 7A)

Python 3.11+ (tested with 3.13), its own virtual environment, pinned in `backend/requirements.txt`: `fastapi 0.143.0`, `uvicorn[standard] 0.54.0`, `python-multipart 0.0.32`, `laspy 2.7.0`, `numpy 2.5.3`.

```bash
# once
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# terminal 1: backend (local only)
cd backend && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000

# terminal 2: frontend
npm run dev        # http://localhost:3000
```

Environment variables (all optional): `SPATIAL_LAB_DATA_DIR` (default `<repo>/spatial-data`), `SPATIAL_LAB_ALLOWED_ORIGINS` (CORS, default `http://localhost:3000,http://127.0.0.1:3000`), and for the frontend `NEXT_PUBLIC_SPATIAL_API_URL` (default `http://127.0.0.1:8000`). The viewer works without the backend (built-in dataset only).

Disk: an import needs roughly 2.3× the LAS size free while uploading (upload buffer + stored original) plus ~15 bytes × 3.5M points for the budgets.

## 4. Architecture

```
app/
  layout.tsx            root HTML, imports globals.css
  page.tsx              client page: ALL app state + data loading (datasets, budgets, poses); renders scene + panel
  globals.css           full-screen canvas, overlay panel styles
components/
  SpatialScene.tsx      <Canvas>, background, Perf, OrbitControls, grid, LiDAR group
  CameraFraming.tsx     camera + OrbitControls target framed once per dataset, Reset View (renders nothing)
  DatasetManager.tsx    collapsible Datasets section: select, metadata/status, import form, delete
  PointCloud.tsx        BufferGeometry from typed arrays; picks Standard or Shader material
  ShaderPointsMaterial.tsx  RawShaderMaterial; shader table per experiment; uniforms; blending
  Trajectory.tsx        THREE.Line + <points> sharing one geometry of pose positions
  ScannerMarker.tsx     body + cone marker at the selected pose (position + quaternion)
  Controls.tsx          plain HTML overlay panel (no UI library)
  GaussianShapePanel.tsx    learning panel: sigmas, angle, covariance matrix
  gaussian/                 Labs 6 and 7B only (own pages, own Canvas, own camera)
    GaussianProjectionScene.tsx  <Canvas>, OrbitControls, grid, axes, 1σ wireframe ellipsoid, quad; exports CameraReset
    ProjectedGaussianQuad.tsx    imperative RawShaderMaterial; projects every frame in useFrame
    GaussianProjectionPanel.tsx  sliders, toggles, Σ3D/Σ2D displays
    MatrixDisplay.tsx            monospace matrix printer
    CompositingScene.tsx         Lab 7B <Canvas> (transparent clear), OrbitControls, background grid, probe marker
    CompositedGaussians.tsx      Lab 7B frame loop: animate → Σ3D → project → sort → instance buffers; 2 instanced meshes
    CompositingPanel.tsx         Lab 7B controls, probe-pixel table, explanations, stats
app/gaussian-projection/page.tsx   Lab 6 client page: controls state, Σ3D via useMemo
app/gaussian-compositing/page.tsx  Lab 7B client page: controls state, scene via useMemo(count), report state
lib/gaussian/
  gaussianMath.ts       Gaussian3D type, covariance3D(), projectGaussian() (all math, commented)
  gaussianControls.ts   slider state + defaults, toGaussian3D() (Euler degrees → quaternion)
  compositing.ts        Lab 7B: allocation-free covariance/projection (same math as gaussianMath), splatAlphaAt, compositePixel
  compositingScene.ts   Lab 7B: scenes (3 hand-placed / 100 / 500 / 1,000 seeded), animation presets
  compositingControls.ts  Lab 7B panel state + defaults
shaders/projectedGaussianShader.ts  GLSL3 quad vertex/fragment (conic falloff, outline)
shaders/compositedGaussianShader.ts GLSL3 instanced version (per-instance attributes, fill + outline pass)
lib/
  loadPointCloud.ts     binary point-cloud loader (format in section 5)
  loadPoses.ts          poses.csv parser, subtracts the dataset's offset
  worldFrame.ts         LIDAR_TO_THREE_ROTATION (Z-up → Y-up)
  importPlan.ts         folder/files → import plan: role detection, ambiguity flags, preview summary
  datasets.ts           Dataset type (= backend metadata), BUILTIN_DATASET (map.las offset/bounds),
                        asset URLs, pickBudget(), backend API calls, client-side file checks
  usefulBounds.ts       1st–99th percentile bounding box (ignores stray points)
  initialView.ts        computes camera position + target from useful bounds
  viewSettings.ts       ViewSettings type + defaults; shader experiment types/params
shaders/                GLSL as exported TS template strings (no bundler loader needed)
scripts/convert_las.py  LAS → browser binary converter (CLI; uses backend/lidar_conversion.py)
public/data/            built-in dataset: pointcloud-500k/1m/2m.bin (gitignored), poses.csv
backend/                local FastAPI dataset service (Lab 7A)
  app.py                routes, CORS, worker process pool, restart recovery
  storage.py            dataset folders, id validation, atomic metadata.json, budget table
  uploads.py            per-role extension/size/content validation
  converter.py          conversion job (progress → metadata) + pose/frame validation
  lidar_conversion.py   shared core: chunked LAS read, offset, sampling, .bin writer
  requirements.txt
spatial-data/           (gitignored) datasets/<id>/{metadata.json, source/, converted/}
docs/                   this guide
```

Data and state flow:

- `page.tsx` owns state: dataset list (built-in + backend), selected dataset id, preferred budget key, loaded point cloud and poses (each tagged with its dataset id), selected pose index, `ViewSettings`, `viewResetRequest` counter, status/error strings. The dataset list is polled every 1.5 s only while a conversion runs.
- Loaded data is stored as `{ datasetId, data }` and only passed to the scene when `datasetId` matches the selection, so the scene never sees the previous dataset's data together with the new dataset's id (which would frame the camera on the wrong scene).
- Effects depend on primitive keys (URL strings, ids), not on dataset objects, because polling replaces the objects every 1.5 s.
- Data flows **down** as props: `page → SpatialScene → PointCloud/Trajectory/ScannerMarker`, and `page → Controls`.
- Controls report changes **up** via callbacks (`onChange(settings)`, `onBudgetChange`, `onPoseIndexChange`, `onResetView`).
- HTML UI lives outside the `<Canvas>`; communication into the canvas uses props (e.g. an incrementing `viewResetRequest` number that an effect inside the canvas watches).
- `ViewSettings` is one flat-ish object; experiment parameters are grouped (`softPoints`). Add new toggles there with a default.

Scene graph (inside `<Canvas linear flat>`):

```
<color background #1a1a1a>
<Perf position="top-right">
<OrbitControls makeDefault>
<CameraFraming>
<gridHelper 100 m, 1 m cells>             (three.js world, Y-up)
<group rotation={LIDAR_TO_THREE_ROTATION}> (LiDAR frame, Z-up, metres, offset applied)
  <axesHelper 5 m>
  <PointCloud>
  <Trajectory>
  <ScannerMarker>
```

## 5. Data: formats, conversion and coordinate frames

### 5.1 Point-cloud binary format (`.bin`)

Little-endian, no padding:

```
uint32                N
float32[N * 3]        X, Y, Z    metres, the dataset's offset already subtracted, Z-up
uint8[N * 3]          R, G, B    0..255
```

Total size = `4 + 15 N` bytes. The loader validates the size and creates `Float32Array`/`Uint8Array` **views** on the fetched `ArrayBuffer` (no copy).

### 5.2 Converter (`scripts/convert_las.py`)

```bash
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-500k.bin --max-points 500000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-1m.bin  --max-points 1000000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-2m.bin  --max-points 2000000
```

The logic lives in `backend/lidar_conversion.py`, shared by this CLI and the backend (Lab 7A). Steps, in this exact order:

1. Read real XYZ (laspy applies LAS scale/offset) and RGB, in 1M-point chunks (for progress).
2. **Compute the offset from the FULL dataset before downsampling**: X/Y = bounding-box centre, Z = minimum, from the actual points (not the LAS header's min/max, which can be rounded: map.las header says Z min −1.14509, real data −1.14500). Print it.
3. Random downsample with a fixed seed (a fresh `default_rng(0)` per budget).
4. Subtract the offset in float64, store as float32.
5. If RGB max (of the full dataset) > 255, shift 16-bit colours down by 8 bits. No RGB → grey 180, flagged `hasRgb: false`.

The printed offset must be **identical** for every budget. For our scan it is
`[-8.19650038931286, 13.09700062207412, -1.1450000543845817]`, stored in `BUILTIN_DATASET.offset` (`lib/datasets.ts`) together with the original bounds and point count. Imported datasets get theirs in `metadata.json`. The refactored converter reproduces the existing `public/data/*.bin` files **byte for byte** (verified with `cmp`).

Why an offset at all: float32 has ~7 significant digits; real-world coordinates (e.g. UTM, hundreds of thousands of metres) lose centimetre precision. Subtract in float64, then store float32.

### 5.3 `poses.csv`

Header-less, comma-separated, one row per pose:

```
timestamp, x, y, z, qx, qy, qz, qw
```

Validated properties of our file (re-check these for a new dataset before trusting the columns):

- timestamp: Unix seconds, strictly increasing, 0.2 s spacing (5 Hz).
- x, y, z: metres in the **same frame as `map.las`**; first pose ≈ (0, 0, 0).
- quaternion: unit length (|q| = 1 ± 5e-6), **scalar last** (column 8 starts at 0.998; column 5 never near 1).
- body +Z stays within ~10° of world up for all poses → Z-up body frame; yaw dominates.

`loadPoses(url, offset)` subtracts the dataset's offset from positions (float64 → float32) and keeps timestamps (Float64Array) and orientations (Float32Array, xyzw).

Frame-agreement evidence for poses vs LAS (do this for any new dataset): the poses sit inside the LAS bounds, 86% of points lie within 3 m of the path, and the path is ~1.1–1.2 m above the lowest scan points (plausible scanner height). If such checks fail, the frames differ — diagnose; don't nudge.

For imported datasets the backend automates this (`converter.validate_poses`):

| Check | Rule | Fails → |
| --- | --- | --- |
| schema | every row 8 finite numbers; one text header row allowed (skipped) | `invalid` (not served) |
| timestamps | strictly increasing | `suspect` |
| quaternions | max \|‖q‖ − 1\| ≤ 0.01 (otherwise columns are probably not qx, qy, qz, qw) | `suspect` |
| inside bounds | ≥ 95% of poses inside the LAS bounds + 1 m | `suspect` |
| near the scan | median distance pose → nearest of 200k sampled scan points ≤ 2 m | `suspect` |

Only `aligned` poses are loaded and drawn; otherwise the panel shows the reason. Poses are never shifted to fit. map.las + poses.csv: 100% inside, median 0.30 m, p95 0.69 m → aligned; shifted by 500 m → suspect ("median 493.1 m … probably a different coordinate frame"). Neither LAS nor CSV carry enough metadata to prove a shared frame (map.las has no CRS record), so the check is coordinate-based; `georeferenced` (LAS has a `LASF_Projection` VLR) is recorded for future CRS-aware alignment.

### 5.4 Dataset metadata (`metadata.json`, Lab 7A)

One JSON per dataset, also the frontend's `Dataset` type (`lib/datasets.ts`; `BUILTIN_DATASET` uses the same shape):

```jsonc
{
  "schemaVersion": 1, "id": "ds_<12 hex>", "name": "…", "kind": "lidar-capture",
  "createdAt": "ISO", "convertedAt": "ISO",
  "status": "queued | converting | ready | failed", "progress": 0.0–1.0, "stage": "Reading points 40%", "error": null,
  "source": { "pointcloud": { "filename", "bytes", "lasVersion", "pointFormat", "headerPointCount", "hasRgb", "georeferenced" },
              "poses": { "filename", "bytes", "rows", "firstLine", "columns" }, "project": { "filename", "bytes", "topLevelType", "topLevelKeys" }, … },
  "originalPointCount": 5242880,
  "originalBounds": { "min": [x, y, z], "max": [x, y, z] },   // real-world, full cloud
  "offset": [x, y, z],                                        // subtracted from budgets AND poses
  "hasRgb": true,
  "budgets": [{ "key": "500k", "label": "500K", "pointCount": 500000, "bytes": 7500004 }, …],
  "poses": { "status": "aligned | suspect | invalid", "count", "message", "checks": { … } } | null,
  "attachments": [{ "role": "control_points | gnss", "filename", "bytes", "rows", "firstLine", "columns" }],
  "warnings": ["Poses file \"poses.csv\" is empty and was skipped.", …],   // shown with ⚠ in the dataset panel
  "skippedFiles": [{ "role": "poses", "filename": "poses.csv", "reason": "empty" }],
  "projectInferred": { "source", "captureDate", "generatingSoftware", "systemIdentifier",
                       "coordinateReferenceSystem": "unknown | declared in the LAS file (not interpreted yet)",
                       "units": "unknown (treated as metres)", "upAxis": "Z (LAS convention)" } | null
}
```

`warnings`, `skippedFiles` and `projectInferred` are optional on the frontend type (datasets imported before 7A.2 lack them). `projectInferred` is set only when `project.json` is missing, empty or `{}`/`[]`; it records only what the LAS header actually says (blank header fields → `null`), never a guessed CRS.

Budgets: 500K, 1M, 2M; the first budget ≥ the dataset size is replaced by one `"all"` budget labelled `All (N)` and larger budgets are skipped (a 300K scan has only `All (300K)`; a 1.5M scan has 500K, 1M, All (1.5M)).

Extensibility: new asset types (trained splats, meshes, measurements, annotations) become new optional top-level keys next to `budgets`/`poses`, each with its own status; multiple captures of one space and coordinate alignment become a `frame` transform relative to another dataset on top of `offset`. Bump `schemaVersion` when an existing key changes meaning.

### 5.5 Coordinate frames

Each dataset has its own local frame: real-world LAS coordinates minus that dataset's `offset`. Two datasets are therefore **not** in a common frame, even if they cover the same space; comparing captures needs an explicit alignment step (roadmap).

| Frame | Up axis | Where used |
| --- | --- | --- |
| LAS / LiDAR local | +Z | `.bin` positions, poses, quaternions, axes helper |
| three.js world | +Y | grid, camera, OrbitControls |
| Scanner body | +Z up, +X forward (ROS convention, assumed) | scanner marker |
| View space (camera) | camera looks down −Z | shaders (`mvPosition`) |
| Point sprite | `gl_PointCoord` 0..1, **y grows downward** | fragment shaders |

Conversion LiDAR → three.js is exactly one rotation of −90° about X (`LIDAR_TO_THREE_ROTATION = [-π/2, 0, 0]`), so `(x, y, z)_lidar → (x, z, −y)_three`. Apply it **once**, on the parent group. Children (points, path, marker) use raw LiDAR-frame values. Code outside the group that needs world coordinates (camera framing) must apply the same matrix (`new Matrix4().makeRotationFromEuler(new Euler(...LIDAR_TO_THREE_ROTATION))`).

Quaternions: apply the recorded `(qx, qy, qz, qw)` directly as the marker group's `quaternion` inside the LiDAR group (three.js uses the same xyzw order). Any mismatch between the marker geometry's forward axis and the scanner's convention is fixed by a separate constant child rotation (`MARKER_FORWARD_CORRECTION`), never by editing recorded quaternions.

## 6. Rendering pipeline

### 6.1 Geometry

```ts
const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));          // Float32Array
geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3, /*normalized*/ true)); // Uint8Array
geometry.computeBoundingBox(); geometry.computeBoundingSphere();
```

`normalized = true` makes the GPU read uint8 0..255 as 0.0..1.0 (4× less memory than float colours). Dispose the geometry in an effect cleanup when data changes.

### 6.2 Colour management

`<Canvas linear flat>`: no sRGB conversion, no tone mapping. The scanner's RGB bytes appear exactly as stored, and custom shaders match `pointsMaterial` pixel-for-pixel (verified: ≤0.002% pixel difference).

### 6.3 Standard Points

`pointsMaterial` with `vertexColors`, `size` in pixels, `sizeAttenuation={false}`. Toggling `vertexColors` needs a shader recompile → use it as the React `key` to recreate the material.

### 6.4 Shader Points

- `RawShaderMaterial` (not `ShaderMaterial`) so every attribute/uniform is declared visibly in GLSL. three.js still supplies `modelViewMatrix` and `projectionMatrix`. GLSL ES 1.00 syntax (`attribute`, `varying`, `gl_FragColor`) works in WebGL2 when no `glslVersion` is set.
- Shaders live in `shaders/*.ts` as exported template strings tagged `/* glsl */`.
- A table maps each experiment to a `{ vertex, fragment }` pair; most experiments change only one stage. Use `key={experiment}` so each experiment gets a fresh GPU program.
- `uPointSize = sliderPx * devicePixelRatio` (`useThree(s => s.viewport.dpr)`), because `gl_PointSize` is in device pixels and `pointsMaterial` multiplies internally.
- **Uniform updates (critical):** R3F *copies* the values of the `uniforms` prop into the material's own uniform objects. Mutating your object's `.value` later does nothing. Build the uniforms object with `useMemo` keyed on its inputs so a new object is passed whenever an input changes; R3F copies the new values (no recompile).
- Every experiment receives all uniforms; shaders ignore undeclared ones.

Experiments implemented:

| Experiment | Stage changed | Core GLSL |
| --- | --- | --- |
| RGB (baseline) | — | `gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = uPointSize; gl_FragColor = vec4(vColor,1.0);` |
| Height | both | `vHeight = clamp((position.z - uMinHeight)/(uMaxHeight - uMinHeight), 0., 1.)`; `mix(blue, yellow, vHeight)`; bounds = 1st–99th percentile of LiDAR Z |
| Depth Size | vertex | `mvPosition = modelViewMatrix * vec4(position,1.)`; `depth = -mvPosition.z`; `clamp(uPointSize * uReferenceDepth / depth, 1., 4.*uPointSize)`; reference depth 10 m |
| Circle | fragment | `if (length(gl_PointCoord - .5) > .5) discard;` |
| Soft Circle | fragment | `alpha = 1. - smoothstep(uInnerRadius, uOuterRadius, length(gl_PointCoord - .5))` |
| Gaussian Point | fragment | `p = gl_PointCoord - .5; alpha = exp(-dot(p,p) / (2.*uSigma*uSigma)) * uOpacity` |
| Elliptical Gaussian | fragment | `p.y = -p.y; q = rotate2D(p, -uRotation); alpha = exp(-(q.x²/(2σx²) + q.y²/(2σy²)))` |

Transparent experiments also `discard` when `alpha < 0.01`.

### 6.5 Transparency and depth

For Soft Circle / Gaussian / Elliptical Gaussian: `transparent: true`, `depthTest: true`, `depthWrite` user-toggleable (default **off**).

- `transparent` enables blending (`src·α + dst·(1−α)`) and makes three.js draw the object after opaque ones.
- `depthTest` on: points stay correctly hidden behind/in front of opaque objects (path line, marker).
- `depthWrite` **off**: no self-occlusion inside the cloud; smooth blending but draw-order dependent and see-through in dense areas; other transparent objects drawn later (pose dots) show through.
- `depthWrite` **on**: correct-looking occlusion but dark/cut-out halos, because points are drawn in file order (not back-to-front) and soft edges write depth.
- The proper fix (later) is per-frame back-to-front sorting, as Gaussian-splat renderers do.

### 6.6 Camera framing

- Compute **useful bounds**: per-axis 1st/99th percentile from an evenly strided sample of ≤50,000 points. (Our full box is ~28×31×7 m because of stray points; 98% of points sit in ~6×8×1.5 m, centred ~15 m from the full-box centre.)
- Rotate that box into three.js space with the LiDAR group's rotation; target = box centre.
- Distance = bounding-sphere radius / sin(min(vFov, hFov)/2). Direction: elevation 15°, azimuth 45°.
- Compute once per dataset (keyed by dataset id) from its first loaded budget, store in a ref, reuse for Reset View: switching budgets never moves the camera; switching datasets frames the new scene.
- When applying a view with damped OrbitControls, flush leftover drag momentum first: set `enableDamping = false`, `update()`, set position/target, `update()`, restore damping.

### 6.7 Projecting a 3D Gaussian (Lab 6)

One Gaussian = position μ, per-axis 1σ `scale` s, unit quaternion rotation q, colour, opacity. Per frame, on the CPU (`lib/gaussian/gaussianMath.ts`):

1. **3D covariance**: `M = R·S` (R from q, S = diag(s)), `Σ3D = M·Mᵀ = R S Sᵀ Rᵀ`. Symmetric positive-definite by construction. Computed only when sliders change.
2. **View transform**: `t = V·μ` (V = `camera.matrixWorldInverse`); `W` = its upper-left 3×3. Depth `d = −t.z`.
3. **Visibility**: `d ≤ 0` → "behind the camera", `d < MIN_DEPTH (0.2 m)` → "too close to the camera": not drawn, reason shown in the panel (the Jacobian blows up as d → 0).
4. **Jacobian** of the perspective projection at t (first-order / local-affine approximation, as in EWA splatting and 3DGS), focal `f = (H/2)/tan(fov/2)` px:
   `J = [[f/d, 0, f·x/d²], [0, f/d, f·y/d²]]` with x/d, y/d clamped to ±1.3·tan(half-fov) (prevents huge footprints at screen edges). Screen y points up here; sign doesn't matter for Σ but keep it consistent with the shader.
5. **2D covariance**: `T = J·W`, `Σ2D = T Σ3D Tᵀ` (px²), symmetrised, plus a 0.3 px² low-pass on the diagonal (keeps tiny Gaussians ≥ ~1 px, as 3DGS does).
6. **Ellipse**: eigenvalues `λ = mid ± sqrt(((a−c)/2)² + b²)`, σ = sqrt(λ), angle `½·atan2(2b, a−c)`. σ clamped to 2 viewports (flag `clamped`).
7. **Conic** = Σ2D⁻¹, sent to the fragment shader.

GPU (`shaders/projectedGaussianShader.ts`, GLSL3):

- A `PlaneGeometry(2, 2)` quad whose corners (±1, ±1) are mapped to `±k·σmajor·majorDir ± k·σminor·minorDir` pixels (k = support, default 3σ) — the ellipse's oriented bounding rectangle. Not `gl.POINTS` (square, size-limited).
- `gl_Position = centerClip + vec4(offsetPx · 2/viewportPx · centerClip.w, 0, 0)` — multiplying by w makes the pixel offset survive the perspective divide.
- Fragment: Mahalanobis `m² = pᵀ·conic·p`; discard if `m > k`; `α = opacity·exp(−½ m²)`; output **premultiplied** `vec4(color·α, α)` with `premultipliedAlpha: true`.
- Optional outline via `fwidth`: 1σ (white), support (blue), quad edge (grey).
- `depthTest: false`, `renderOrder` high: the footprint is a 2D overlay of a single Gaussian. The 1σ wireframe ellipsoid is drawn after it (also `depthTest: false`) so its silhouette can be compared against the white 1σ ellipse — they coincide.

### 6.8 Compositing many Gaussians (Lab 7B)

Per frame, on the CPU (`CompositedGaussians.tsx`, math in `lib/gaussian/compositing.ts`):

1. **Animate** each Gaussian (preset + global scale/opacity) into a reused object.
2. **Σ3D** from scale + quaternion, written into a `Float64Array(6)` (`[xx, xy, xz, yy, yz, zz]`).
3. **Project** exactly as section 6.7 (same Jacobian, clamps, 0.3 px² low-pass, σ clamp), written out by hand without allocations. Unit-tested against `projectGaussian`: identical to ~1e-13 over 2,000 random cases.
4. **Sort** the visible Gaussians by the camera-space depth of their **centres** (`Uint32Array.sort` with a comparator): nearest first ("correct"), farthest first ("reversed").
5. **Upload**: write clip centre (vec4), quad half-axes in px (vec4, already × 3σ), conic (vec3) and colour + opacity (vec4) into `InstancedBufferAttribute`s (`DynamicDrawUsage`) in drawing order; `geometry.instanceCount = visible`. 1,000 Gaussians ≈ 1 ms CPU.

GPU (`shaders/compositedGaussianShader.ts`): Lab 6's quad shader with per-instance attributes instead of uniforms (`flat` varyings for conic/colour). `α = min(0.99, opacity·exp(−½m²))`, discarded beyond 3σ or below 1/255 (both as in 3DGS). Output premultiplied.

**Front-to-back blending** ("under" operator), `CustomBlending`, rgb and alpha alike: `src = OneMinusDstAlpha`, `dst = One`. The canvas is cleared to **transparent** (`gl.setClearColor(0, 0)`, no `<color attach="background">`), so its alpha holds 1 − T:

```
dst.rgb += (1 − dst.a) · α·c     // = T·α·c
dst.a   += (1 − dst.a) · α       // T ← T·(1 − α)
```

The browser composites the premultiplied canvas over the page's `#1a1a1a`, adding `T_final·background`. The probe in the panel evaluates the same sum on the CPU at the screen centre (`compositePixel`); rendered and predicted pixels agree within 1/255. Anything drawn later with this blending appears *behind* everything before it, which is how the reference grid is drawn (`renderOrder` 2, after the Gaussians at 1): it is always the farthest layer. Footprint outlines are a second instanced mesh over the same geometry (`renderOrder` 3, normal premultiplied blending, on top). Total: 3 draw calls regardless of count.

Approximations: sorting by centre gives one order per frame for all pixels; overlapping or intersecting Gaussians whose per-pixel order differs from their centre order are composited in the wrong order there, and the order "pops" when centres swap during an orbit. Exact visibility needs per-pixel ordering (ray marching or per-pixel fragment lists). The grid is always behind every Gaussian, even when it is physically in front (seen from below).

## 7. Lab-by-lab build specification

Each lab lists requirements and acceptance criteria. Build them in order.

### Lab 1 — Point cloud viewer

Requirements: full-screen R3F canvas, dark neutral background; load `.bin`; `BufferGeometry` with `position` + `color` attributes; `<points>` + `pointsMaterial` with vertex colours; `OrbitControls`; small HTML panel with point count, point-size slider, RGB toggle, axes toggle, grid toggle. Components: `SpatialScene`, `PointCloud`, `Controls`. Loading/error message if the file is missing. No fake data.

Accept: real scan renders; count matches file; all toggles work; missing file shows a clear error.

### Lab 1b — Point budgets and performance

Requirements: `<Perf position="top-right" />` inside the canvas; "Point Budget" selector 500K | 1M | 2M; show selected budget, actual loaded count, point size; loading message; only one dataset in memory (clear old data before fetching new; abort in-flight fetch on switch with `AbortController`); camera must not reset when switching.

Accept: switching budgets keeps the exact same view (pixel-identical after a round trip); the scan's dense-region centre is identical across budgets (within mm).

### Lab 2 — Scanner trajectory

Requirements: inspect `poses.csv` and validate column meaning from values (section 5.3); parse; subtract the same offset as the point cloud (now the dataset's `offset`, section 5.4); render inside the LiDAR group as a `THREE.Line` (via `<primitive>`, because JSX `<line>` is the SVG element) plus subtle `<points>` markers sharing one geometry; toggles "Show scanner path", "Show pose points"; display pose count. No orientation yet, no animation. If misaligned, report — don't adjust.

Accept: path lies inside the scanned space at plausible scanner height.

### Lab 2B — Pose playback

Requirements: "Scan Playback" slider 1..N (manual only); "Pose: i / N"; elapsed seconds from first timestamp; scanner marker (box body + forward cone along local +X, plus a small axes helper showing the raw body frame) placed with pose position + recorded quaternion inside the LiDAR group; `MARKER_FORWARD_CORRECTION` constant for any fixed geometry-axis correction; "Show scanner marker" toggle.

Accept: body +Z stays near up for all poses; marker turns with the slider; no per-pose drift between marker and path.

### Lab 3 — Shader Points

Requirements: renderer selector Standard Points | Shader Points; Standard unchanged; Shader uses `RawShaderMaterial` with commented vertex/fragment shaders (position, color, modelViewMatrix, projectionMatrix, gl_Position, gl_PointSize, varying); size slider drives a uniform. RGB toggle disabled in shader mode with a "(Standard only)" note.

Accept: shader RGB visually identical to Standard (≤0.01% pixel difference); size slider changes size live (test by changing the slider *after* switching mode).

### Lab 3b — Shader experiments + camera framing

Requirements: Shader Experiment selector (only in shader mode): RGB, Height, Depth Size, Circle (section 6.4). Camera framing per section 6.6 and a Reset View button.

Accept: each experiment compiles and differs visibly from RGB; Reset View after orbit+zoom returns a pixel-identical view.

### Lab 4 — Soft points

Requirements: Soft Circle (inner/outer radius sliders, inner < outer enforced) and Gaussian Point (sigma 0.05–0.5, default 0.2; opacity multiplier); transparency per section 6.5 with a "Depth write" checkbox; UI note: Gaussian-shaped point sprite, not a full Gaussian splat.

Accept: sigma visibly changes softness (≥5% pixel difference between σ 0.08 and 0.4 in a sparse crop); size slider works; budgets keep world position; dense-area comparison of depthWrite on/off shows halos vs see-through.

### Lab 5 — Elliptical Gaussian

Requirements: Sigma X, Sigma Y (0.03–0.5), Rotation (−180°..180°); `rotate2D()` in GLSL; flip `gl_PointCoord.y` so positive angles are counter-clockwise; rotate local coords by −angle into the ellipse frame; RGB colours; transparency as Lab 4; "Gaussian Shape" panel with σx, σy, angle, circular/elliptical label and the 2×2 covariance `Σ = R·diag(σx², σy²)·Rᵀ`; "Reset Experiment" button that restores only the current experiment's parameters (`EXPERIMENT_PARAMETERS` map).

Accept (measured with image moments on an isolated point, section 9): equal sigmas → elongation 1.00; σx 0.25 / σy 0.07 → elongation ≈3.6 at 0°; rotation 45°/90°/−45° → measured major axis 45°/±90°/−45°; existing modes pixel-identical to previous references.

Limitations to state: every point has the same screen-space ellipse (not per-point 3D shape); the ellipse is clipped by the screen-aligned square sprite (with 2σ > 0.5 the tails are cut, so a large σ looks like a soft square/rectangle); maximum sprite size is GPU-limited (`ALIASED_POINT_SIZE_RANGE`); no depth sorting.

### Lab 6 — Projecting one 3D Gaussian into 2D

Requirements: separate route `/gaussian-projection` with its own `<Canvas>` and camera (start (0, 0, 6), fov 50, OrbitControls at the origin) — the LiDAR viewer's renderers, frames, trajectory, camera and playback are untouched; links between the two pages. Gaussian data model (position, scale, quaternion, colour, opacity); Euler XYZ sliders in degrees converted to a quaternion; math and shader per section 6.7. Panel: Position XYZ (Z −30..8), Scale XYZ (0.02–2 m), Rotation XYZ (−180..180°), Opacity, Support (1–4σ), "Footprint outline" and "3D 1σ ellipsoid" toggles, Reset (controls + camera), Σ3D (m²) and Σ2D (px²) matrices, depth / σ major / σ minor / angle, "Not drawn: <reason>" when hidden. Defaults: scale (0.6, 0.2, 0.2), rotation Z 30°, opacity 0.9, support 3σ. Out of scope: many Gaussians, sorting, spherical harmonics, a full splatting pipeline.

Accept:

1. Isotropic scale → circle (ratio 1.00).
2. Anisotropic (0.6, 0.2, 0.2) facing the camera → ratio 3.00.
3. Rotation Z 0/30/60/−45° → measured angle equals the slider; rotation Y 90° → circle (long axis end-on).
4. Moving 6 m → 12 m from the camera halves σ (42.9 → 21.5 px for scale 0.3 at the default window).
5. Orbiting changes Σ2D while Σ3D stays fixed (side view of the default → ratio ~1).
6. Σ2D symmetric and positive-definite for random inputs; Monte Carlo (sample N(0, Σ3D), push through T) matches within ~1%.
7. No shader/TS/console errors; behind/too-close cases hidden with a reason; Reset restores the defaults.

Limitations to state: first-order (affine) projection — exact at the centre, approximate for large Gaussians close to the camera or near screen edges; clamping of x/d, y/d and of footprint size; 0.3 px² low-pass slightly enlarges tiny Gaussians; depth test off (single overlay, no occlusion); no sorting.

### Lab 7A — Multi-dataset import and management

Requirements:

- Local FastAPI backend (`backend/`, section 3.1), bound to 127.0.0.1, CORS only for the dev origin. Endpoints: `GET /health`, `GET /datasets`, `POST /datasets` (multipart: `name`, `pointcloud` required; `poses`, `project`, `control_points`, `gnss` optional), `GET /datasets/{id}`, `DELETE /datasets/{id}` (409 while converting), `GET /datasets/{id}/points/{budgetKey}`, `GET /datasets/{id}/poses`.
- Storage `spatial-data/datasets/<id>/` (gitignored, outside `public/`): `source/` (originals under fixed names: `pointcloud.las`, `poses.csv`, `project.json`, `control_points.csv`, `gnss.csv`), `converted/` (budgets + normalised header-less poses), `metadata.json` (section 5.4, written atomically via temp file + `os.replace`).
- Security: ids generated server-side (`ds_` + 12 hex) and matched against a strict regex before any path is built, and the resolved path must stay inside the store; budget keys served only if listed in the metadata; client file names are display text only; per-role extension + size limit (LAS 4 GiB, CSV 200 MiB, JSON 10 MiB) + content check (`LASF` signature and a laspy header read, uncompressed only; UTF-8 text without NUL for CSV; `json.loads` for JSON); nothing uploaded is executed; helpful messages for `.laz`, `.ply`, `.splat`, `.e57`, … (also checked client-side before uploading).
- Conversion in a `ProcessPoolExecutor(max_workers=1, spawn)` worker; progress (reading 0–60%, budgets 60–90%, poses 90–100%) written to metadata; the page polls every 1.5 s while anything converts. Interrupted conversions are re-queued on backend start. On failure, partial `converted/` output is deleted, sources are kept, and the error is shown.
- Pose validation per section 5.3; control points/GNSS stored with rows/first line only (schema not assumed); project JSON parsed, top-level keys recorded. None of these are treated as splat data.
- Frontend: built-in dataset (`BUILTIN_DATASET`, served from `public/data`, works without the backend) + backend datasets in one list; collapsible "Datasets" section (`<details>`): select (status in the option label), metadata (original points, size, offset with full precision in the tooltip, budgets, poses count + status, source file, attachments, import date), progress bar, "Import dataset…" form (see the importer below), "Delete" with `window.confirm`. Global `WORLD_OFFSET` and `pointBudgets.ts` removed.
- Importer (`lib/importPlan.ts` + `ImportForm`): "Choose folder…" (`<input type=file webkitdirectory>`, recursive; the attribute is set through a ref because React's types lack it) or "Choose files…" (`multiple`). Nothing is uploaded until "Upload and convert". Detection by extension and name only (contents are checked by the backend):

  | File | Detected as |
  | --- | --- |
  | `.las` | point cloud |
  | `.json` | project metadata |
  | `.csv` with `control_points`/`gcp` in the name | control points |
  | `.csv` with `gnss`/`gps` | GNSS |
  | `.csv` with `pose`/`trajectory`/`odom` | scanner poses |
  | other `.csv` | unrecognised (not imported unless the user assigns a role) |
  | `.laz`, `.ply`, `.splat`, `.e57`, other | not imported, with a reason |
  | `.DS_Store`, dot-files, `Thumbs.db` | skipped silently |

  A role is assigned automatically **only if exactly one file claims it**. Two LAS files or several pose/JSON candidates are marked "Ambiguous" and left unassigned: a missing point cloud blocks the upload ("Found 2 LAS files; choose which one is the point cloud"), an unresolved optional role is a warning ("…none will be imported unless you choose one"). Each file has a role dropdown (only roles valid for its extension, plus "Don't import"); two files on one role block the upload. Preview line: "Found 1 LAS point cloud, 1 poses CSV, 1 project JSON, and 2 optional metadata files." (counts assigned files plus unresolved candidates; control points + GNSS = optional metadata). Paths are shown relative to the picked folder; the folder name becomes the default dataset name.
- Sparse datasets (7A.2): the point cloud is the only required file and must be a valid, non-empty LAS (empty → 400 "the file is empty"; bad content → "LASF signature" error). Empty optional files (`poses`, `control_points`, `gnss`, `project`) never fail the import:
  - Preview: a 0-byte file gets "Don't import" with the note "Empty file (0 bytes): will be skipped." and a yellow warning; it is not counted as unrecognised. A 0-byte `.las` with no other point cloud is a blocking problem. With a point cloud but no `project.json`, the preview warns that metadata will be inferred and the CRS may be unknown.
  - Backend: an optional file that is 0 bytes or only whitespace (UTF-8 BOM allowed) is deleted from `source/`, listed in `skippedFiles`, and warned about. Non-empty but invalid optional files (bad JSON, binary CSV) are still rejected, so a corrupt file is never silently dropped.
  - Missing/empty/`{}` project: `infer_project_metadata` (`backend/uploads.py`) fills `projectInferred` from the LAS header and adds warnings that the CRS is unknown (or declared in the LAS but not interpreted) and coordinates are a local frame in metres. The panel shows "Project metadata: inferred from the LAS header (CRS: …)" plus each `⚠` warning.
  - A whitespace-only file isn't 0 bytes, so only the backend catches it; the warning appears in the dataset panel after upload.
- Switching datasets: drop the old point cloud and poses (JS arrays freed; `PointCloud`/`Trajectory` dispose GPU geometry on change/unmount), keep `ViewSettings`, reset pose playback, keep the *preferred* budget key (`pickBudget` falls back to the largest budget not bigger than it), reframe the camera once per dataset.

Accept:

1. Built-in dataset unchanged (500K/1M/2M, 208 poses, same framing).
2. The same `map.las` converted through the backend: identical offset, bounds, 5,242,880 points; budgets byte-identical to `public/data`; screenshot pixel-identical (0% diff) to the built-in dataset.
3. Budget switching within a dataset after an orbit (camera at rest): 0% diff.
4. Switching datasets reframes; Reset View returns exactly to that dataset's framing.
5. Poses: aligned ones drawn (208); shifted/malformed ones hidden with a specific reason.
6. Repeated switching: live WebGL buffer bytes, textures and programs of the scene canvas stay constant.
7. Validation messages for wrong extension, fake LAS content, empty name; delete removes the files and falls back to the built-in dataset; backend offline → built-in still works and the panel says so.
8. No TypeScript, Python (pyflakes) or console errors.

Limitations to state: each dataset has its own local frame (no cross-dataset alignment yet); the whole LAS is held in memory during conversion (~40 bytes/point); LAZ/E57 not supported; conversions run one at a time; no authentication (local development only).

### Lab 7B — Multiple Gaussians and alpha compositing

Requirements: separate route `/gaussian-compositing` (own `<Canvas>`, camera as Lab 6, reuses Lab 6's `CameraReset`); links from the LiDAR viewer and Lab 6. The Gaussians are explicit synthetic teaching objects (like Lab 6's single Gaussian), never presented as scan or splat data. Rendering and math per section 6.8.

- Scenes (`compositingScene.ts`): **3** hand-placed Gaussians, one per depth layer (red z = 1, green z = 0, blue z = −1; opacity 0.8; all covering the screen centre), or **100 / 500 / 1,000** from a seeded PRNG (mulberry32, seed = count) in the same three layers (colour families per layer, σ ≈ sqrt(4.4/N), random rotation, opacity 0.55–0.9). Each Gaussian: position, scale, quaternion, colour, opacity (+ an animation phase).
- Controls (`compositingControls.ts`; defaults in brackets): count [3], ordering Correct | Reversed [Correct], footprint outlines [on], opacity × 0.05–1 [1], scale × 0.25–2 [1], preset None | Breathing | Wave | Dreamscape [None], speed 0–3× [1], Pause/Play [playing], Reset (controls, animation time, camera).
- Animation (time advances only while playing: `t += min(delta, 0.1)·speed`): Breathing — scale × (1 + 0.3 sin(2π·0.25t)); Wave — y += 0.25 sin(2x − 2π·0.3t); Dreamscape — rotation about own Z (±0.5 rad) and X (±0.25 rad), scale × (1 ± 0.12), opacity × (0.7…1), each with its own phase. Colour is never animated.
- Panel: drawing order; **probe pixel** table (screen centre, ring marker) with depth, α, T before, T·α per contributing Gaussian (first 8) + final T and the predicted pixel colour; Gaussian 0's live animated values (scale factor, Δy, opacity, rotation angle vs base); collapsible explanations (alpha, transmittance, depth ordering, why footprints overlap, why the wrong order looks wrong, limits of centre sorting); stats (drawn, draw calls, CPU ms). Reports throttled to 10 Hz and only when a rounded key changes.

Accept:

1. Unit test: `compositing.ts` projection equals `projectGaussian` (random cases); weights + T_final = 1.
2. 3 Gaussians, correct order at the probe: red α 0.499 (T 1) → green 0.619 (T 0.501) → blue 0.581 (T 0.191), T_final 0.080, pixel ≈ (0.566, 0.416, 0.287); rendered pixel within 1/255.
3. Reversed: blue first, pixel ≈ (0.252, 0.477, 0.679) — same T_final, different colour; ~8% of the image changes.
4. Orbit ~180°: blue becomes nearest and is drawn first; rendered still matches predicted.
5. Each preset changes only its properties (Breathing: scale; Wave: y; Dreamscape: rotation, scale, opacity).
6. Pause: values and image identical over 1.5 s (excluding the Perf overlay); Play resumes.
7. Reset after changing everything and orbiting: defaults restored, image identical to the initial one.
8. 100 / 500 / 1,000: 3 draw calls per frame; no console errors; LiDAR viewer and Lab 6 unchanged.

Limitations to state: centre-based sorting (section 6.8); CPU projection and sorting (fine for ~1,000, not for millions — real splatting projects in the vertex/compute stage and sorts on the GPU, per screen tile); first-order projection as Lab 6; no spherical harmonics (one colour per Gaussian); not a trained splat and no file loading.

## 8. Pitfalls we hit and how they were fixed

| Symptom | Cause | Fix |
| --- | --- | --- |
| `zsh: command not found: python` | macOS ships `python3` | use `python3` |
| Turbopack panic "invalid utf-8 sequence" after adding `r3f-perf` | its source map references a binary `.woff` | `experimental.turbopackInputSourceMaps: false` |
| Type-check risk with TypeScript 7 | native TS 7 may lack the JS API Next uses | pin `typescript@5` |
| Scene shifts slightly between budgets | converter computed the offset *after* sampling | compute offset from full LAS before sampling; print and compare |
| "Uncontrolled input to controlled" warning, or `Cannot read properties of undefined` crash, after adding a setting | Fast Refresh keeps the old `useState` settings object, which lacks the new (possibly nested) keys | `withDefaults()` in `lib/viewSettings.ts` merges defaults (including nested `softPoints`) into the state on every render in `page.tsx`; extend it when adding new nested groups |
| Shader size slider "does nothing" until switching mode | R3F copies `uniforms` values; mutating your object later is ignored | rebuild the uniforms object via `useMemo` with deps |
| Reset View lands slightly off | OrbitControls damping keeps applying drag momentum | flush with `enableDamping=false; update()` before setting the view |
| Initial view too high / building low in frame | framing on full bbox dominated by stray points | percentile ("useful") bounds + low elevation |
| JSX `<line>` type errors | `line` is the SVG element in React's JSX types | create `new THREE.Line(...)` and render with `<primitive>` |
| Headless screenshots time out at 2M points | software rendering (SwiftShader) of large blended sprites | longer timeouts, smaller point size during heavy steps |
| Uniforms that change every frame (camera-dependent) | the `useMemo` uniforms rule only triggers on React renders | create the material imperatively (`useMemo(() => new RawShaderMaterial(...), [])`) and mutate `material.uniforms.x.value` in `useFrame`; report results to React only when a rounded key changes |
| `fwidth` unavailable / shader error in outline code | GLSL ES 1.00 needs an extension for derivatives | use `glslVersion: THREE.GLSL3` (`in`/`out`, declare `out vec4 fragColor;`) |
| (Preventive) quad culled although visible | three.js frustum-culls using the plane's model-space bounds, but the shader places it elsewhere | `frustumCulled={false}` on the mesh |
| Wireframe 1σ ellipsoid invisible in Lab 6 | the near-opaque footprint (depthTest off) is drawn over it | draw the wireframe after it: higher `renderOrder`, `depthTest: false` |
| Offset differs slightly from expectations | LAS header min/max are stored rounded | compute bounds from the actual points |
| Camera frames the *previous* dataset after a switch | for one render the scene got the new dataset id with the old data | tag loaded data with its dataset id; pass it only when ids match |
| Effects re-run / reload every 1.5 s while converting | polling replaces dataset objects | depend on URL strings and ids, not objects |
| "Budget switch moves the camera" in headless tests | OrbitControls damping is per frame; SwiftShader renders few frames per second, so the drag keeps drifting for seconds | wait until two screenshots are identical before comparing |
| Live WebGL buffer count grows a little on every switch | r3f-perf's chart canvas (310×100, its own context) rebuilds small text buffers when the point count changes | not an app leak: the scene canvas's buffers stay constant; attribute buffers to their canvas when checking |
| Headless folder upload "finds no .las" | Playwright's directory `setInputFiles` skips symlinked files | use a hard link (`ln`, same disk, no copy) in test folders |
| A background server started with `( … &)` inside a one-off shell dies | it ends with that shell | start long-running servers as their own background process |
| `[Errno 28] No space left on device` during conversion | each conversion writes ~52 MB of budgets; uploads need ~2.3× the LAS size | failed jobs delete partial output; free disk before importing large files |
| Front-to-back blending shows nothing / Gaussians vanish over the grid | "under" blending needs destination alpha = accumulated opacity; a `<color attach="background">` clear (alpha 1) or an opaque object drawn first already reads as fully covered | clear to alpha 0, let the page background show through, and draw everything that should be behind *after* the Gaussians with the same blending |
| Test uploads land in the user's real dataset store | the user's own backend was already listening on :8000, so the test server failed to bind and requests went to theirs | check `lsof -iTCP:8000` first; run test backends on another port with a temp `SPATIAL_LAB_DATA_DIR` |
| Killing a background `uvicorn` leaves it listening | the shell wrapper was killed, not the server | `lsof -ti tcp:8000 -sTCP:LISTEN \| xargs kill` |

## 9. Validation playbook

Run after every change:

1. `npx tsc --noEmit`
2. `npx next build`
3. Headless browser checks against the running dev server (Playwright installed **outside** the project, e.g. `/tmp/sl-check`, so it is not a project dependency):

```js
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on("console", m => /* collect errors; ignore the known THREE.Clock deprecation warning */ 0);
await page.goto("http://localhost:3000/");
await page.waitForFunction(() => document.body.innerText.includes("Loaded points: 500,000"));
```

Techniques used:

- **Shader compile errors**: any `console.error` (three.js logs `THREE.WebGLProgram: Shader Error`). Expect zero.
- **Pixel diffs** (with `pngjs`): count pixels whose RGB differs by > 30. Use a scene clip that excludes the panel and the Perf overlay. Same camera + same data must give 0%.
- **Camera stability**: screenshot, switch 500K → 2M → 500K, screenshot again → 0% difference.
- **Reset View**: screenshot, drag + wheel, click Reset, screenshot → 0% difference.
- **Slider effect**: compare a sparse crop before/after changing a slider (expect several % difference).
- **Shape measurement**: crop around an isolated point, weight pixels by luminance above background, compute second moments → elongation `sqrt(λ1/λ2)` and major-axis angle `½·atan2(2σxy, σxx − σyy)` (flip image y to get counter-clockwise angles).
- **Data checks** (Python): offsets identical across conversions; 1st–99th percentile centre identical across budget files.
- **Pure-math unit tests** (Lab 6): import `lib/gaussian/gaussianMath.ts` from a script run with `npx tsx` (outside the project); check circle/ratio/angle/distance cases, symmetry + positive-definiteness for thousands of random inputs, and a Monte Carlo comparison (sample points from N(0, Σ3D), push through T = J·W, compare sample covariance to Σ2D).
- **Backend without copying big files** (Lab 7A): create a dataset folder whose `source/pointcloud.las` is a *symlink* to the original, write `new_metadata()`, call `converter.convert_dataset(id)` directly; use `SPATIAL_LAB_DATA_DIR=/tmp/...` so tests don't touch the real store. Patch `converter.BUDGETS` (e.g. a 10M budget) to exercise the "All (N)" path with real data. `cmp` the budgets against `public/data`.
- **API checks** with `curl -F`: wrong extension, fake content, empty name, invalid ids (`..%2F`), delete.
- **Importer**: unit-test `planImport`/`describePlan` with `npx tsx` (Node's `File`, `webkitRelativePath` set via `Object.defineProperty`): complete folder, two LAS files, several pose candidates, user resolution, two files on one role, unknown CSV + unsupported formats, no LAS, only system files. In the browser, `setInputFiles(<folder path>)` on the folder input; placeholder files are enough for the preview, and uploading a placeholder `.las` must return the backend's "LASF signature" error. End to end: a folder with a hard link to `map.las` + `poses.csv` + `project.json` → 5,242,880 points, same offset, poses aligned, 0% pixel diff vs the built-in dataset.
- **Sparse imports** (7A.2), against a backend with `SPATIAL_LAB_DATA_DIR=/tmp/...` on a spare port (never the user's running backend on 8000 — it writes to the real store; in Playwright, `page.route` can redirect `:8000` to the test port): `map.las` + empty `poses.csv`/`control_points.csv` + whitespace/BOM `gnss.csv` → 201, three skip warnings, `projectInferred` with CRS unknown, conversion ready, poses none; empty `project.json` and `{}` → inferred metadata; full set → no warnings, poses aligned (unchanged); empty LAS → 400; invalid non-empty JSON → 400.
- **GPU leak check**: `page.addInitScript` wrapping `createBuffer/deleteBuffer/bufferData/createTexture/createProgram` on both WebGL prototypes to count live objects and bytes, grouped by `ctx.canvas` size (to separate the r3f-perf chart canvas from the scene). Compare the same state before and after N round trips.
- **Projected-footprint measurement** (Lab 6): weight only pixels with the Gaussian's hue (`(G−B)/(R−B) ≈ 0.47` for the orange), and keep only the half of the screen away from the axis lines (the footprint is centrally symmetric) — otherwise axes blended into the faint tail bias the moments. Compare to a *simulated measurement* of the predicted Σ2D (same opacity, 8-bit rounding, threshold and 3σ cut), not to raw Σ2D: truncation and thresholding make the measured σ ~6% smaller.
- **Compositing** (Lab 7B): unit-test `compositing.ts` against `gaussianMath.ts` with `npx tsx` (run with `NODE_PATH=<repo>/node_modules` so `three` resolves). In the browser, average the 2×2 pixels around the canvas centre and compare with the panel's predicted probe colour (the canvas uses `linear`, so screenshot values are the shader's values); count draw calls per frame by wrapping `draw*` on `WebGL2RenderingContext.prototype` (only the scene canvas, width > 400); orbit with `page.mouse` drags (≈ viewport height / 2 px of horizontal drag = 180°); exclude the panel and the Perf overlay from pause/reset image diffs (both change while the scene doesn't).
- Note: FPS numbers from SwiftShader are meaningless; use real hardware for performance conclusions.

## 10. Adapting Spatial Lab for different web purposes

Keep sections 2, 5 and 6 (principles, frames, pipeline) and change the rest:

| Purpose | Keep | Change / add |
| --- | --- | --- |
| **Property / real-estate tour** | standard points, camera framing, reset | hide debug panel; preset viewpoints/hotspots; RGB only; mobile-first budget (≤1M); Gaussian splats later for photoreal |
| **Construction progress / site monitoring** | shared world offset (critical for comparing dates) | load multiple epochs with the *same* offset; toggle/compare scans; measurement tools; clipping boxes |
| **Robotics / SLAM debugging** | trajectory, pose playback, quaternion handling, axes | timeline playback/animation; per-pose scan frames; covariance/uncertainty ellipses; error metrics |
| **Cultural heritage / museum** | soft/Gaussian sprites for nicer look | annotations with text/media; guided camera paths; high-quality splats |
| **Education / training** (this app) | everything, comments, experiment selectors | more labs; side-by-side comparisons |
| **Marketing embed / landing page** | standard points, auto-framing | small budget (100–300K), no Perf, no panel, auto-rotate, lazy load, poster image fallback |
| **Mobile / low-power** | point budgets | default to 500K or less; smaller point size; `dpr={[1, 1.5]}` on Canvas; avoid transparent modes |
| **WebXR** | shared Z-up group, metric units | `@react-three/xr`; real-world scale is already metres; budget ≤1M for headset GPUs |
| **Large datasets (>10M points)** | loader pattern | streaming LOD formats (Potree / COPC / 3D Tiles), octree loading, workers; don't load full LAS in-browser |

General scaling rules: raw LAS is never loaded directly; convert offline to a typed-array format; keep one dataset in GPU memory at a time; host `.bin` files with compression (gzip/brotli) or quantise positions to int16 with a scale for 2× smaller files.

## 11. Not built yet / roadmap

Explicitly out of scope so far (each would be its own lab): cross-dataset alignment (multiple captures of one space in one frame, using control points/GNSS/CRS), trained splat and mesh assets per dataset (metadata keys reserved, section 5.4), LAZ/E57 import, LiDAR intensity visualisation, pose animation, clipping/cropping, measurement tools, annotations/hotspots, full Gaussian splatting (Lab 6 projects one Gaussian; Lab 7B composites up to 1,000 with CPU projection, centre sorting and instanced quads; still missing: projection and sorting on the GPU for millions of Gaussians, tile-based rasterisation, spherical-harmonic colour, loading `.ply`/`.splat` files, training), ordinary meshes, WebXR, LOD/octrees, workers.

## 12. Prompt templates

**Rebuild the whole app:**

> Build "Spatial Lab" exactly as specified in `docs/SPATIAL_LAB_REBUILD_GUIDE.md`. Follow the principles in section 2, the versions and config in section 3, the architecture in section 4, and implement Labs 1 through 7B in order (section 7). The built-in dataset is in `public/data/` (`pointcloud-500k.bin`, `pointcloud-1m.bin`, `pointcloud-2m.bin`, `poses.csv`); its offset is in section 5.2. Start the backend as in section 3.1. After each lab run the validation playbook (section 9) and report results. Do not generate fake data.

**Variant for another purpose:**

> Using `docs/SPATIAL_LAB_REBUILD_GUIDE.md` as the reference, build a variant for **[purpose]**. Keep sections 2, 5 and 6 unchanged. Apply the adaptations for [purpose] from section 10. Omit the learning panels and shader experiment selector unless needed. Validate with section 9.

**Add a new lab:**

> Extend Spatial Lab with **[lab]**. Preserve all features listed in section 7. Follow the principles in section 2 and the pipeline rules in section 6 (especially the uniform-update rule and shared world frame). Validate with section 9, then update `docs/SPATIAL_LAB_REBUILD_GUIDE.md` (lab spec, pitfalls, changelog).

**New dataset:**

> Start the backend (section 3.1) and import `[file.las]` (+ `poses.csv`) through the Datasets panel. Check the metadata: offset, bounds and point count from the full cloud, budgets, pose status. If poses are `suspect`, read the reason and diagnose the frames instead of adjusting. (Offline alternative: `scripts/convert_las.py` per budget, confirm identical offsets, and add a dataset record like `BUILTIN_DATASET`.)

## 13. Changelog

| Lab | Change |
| --- | --- |
| 1 | Next.js + R3F scaffold, binary loader, `PointCloud`, `Controls`, converter |
| 1b | `r3f-perf`, point budgets, abortable loading, camera preserved across budgets; Turbopack source-map fix |
| 1c | Converter: offset from full dataset before sampling (fixed scene shift) |
| 2 | `poses.csv` validation, shared `WORLD_OFFSET`, `Trajectory` |
| 2B | Pose playback slider, `ScannerMarker` with recorded quaternion |
| 3 | Standard / Shader renderer, `RawShaderMaterial`, commented GLSL |
| 3b | Shader experiments (RGB, Height, Depth Size, Circle); percentile camera framing; Reset View; damping flush |
| 3c | Fixed uniform updates (R3F copies uniform values) |
| 4 | Soft Circle, Gaussian Point, transparency + depthWrite toggle |
| 5 | Elliptical Gaussian (`rotate2D`, σx/σy/rotation), Gaussian Shape panel with covariance, Reset Experiment; this guide |
| 5a | `withDefaults()` so settings added during development can't crash a hot-reloaded page |
| 6 | Separate `/gaussian-projection` page: 3D Gaussian → Σ3D → Jacobian-projected Σ2D → screen-space quad with conic falloff, premultiplied alpha, outlines, Σ displays; wireframe ellipsoid drawn on top |
| 7A | Local FastAPI backend (upload validation, worker-process conversion with progress, pose/frame validation, `spatial-data/` store); per-dataset metadata replaces `WORLD_OFFSET` and `pointBudgets.ts`; Datasets panel; per-dataset camera framing; converter core moved to `backend/lidar_conversion.py` (byte-identical output); `.bin` files and `spatial-data/` gitignored |
| 7A.1 | Importer: folder or individual files, preview summary, per-file role selection, ambiguity flags instead of guessing (`lib/importPlan.ts`); verified end to end with the real map.las |
| 7A.2 | Sparse datasets: empty optional files (poses, control points, GNSS, project) are skipped with warnings instead of failing the import; missing/empty project.json → metadata inferred from the LAS header with explicit unknown-CRS warnings; new metadata keys `warnings`, `skippedFiles`, `projectInferred`; warnings shown in the import preview and the dataset panel |
| 7B | Separate `/gaussian-compositing` page: 3 / 100 / 500 / 1,000 Gaussians in three depth layers; allocation-free projection (same math as Lab 6, unit-tested); per-frame centre-depth sort; one instanced draw call with front-to-back ("under") blending on a transparent canvas; correct/reversed ordering; Breathing/Wave/Dreamscape presets, speed, pause, reset; probe-pixel transmittance table; explanations; links from the viewer and Lab 6; Lab 6's `CameraReset` exported |
