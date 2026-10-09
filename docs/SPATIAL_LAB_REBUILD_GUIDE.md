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

## 4. Architecture

```
app/
  layout.tsx            root HTML, imports globals.css
  page.tsx              client page: ALL app state + data loading; renders scene + panel
  globals.css           full-screen canvas, overlay panel styles
components/
  SpatialScene.tsx      <Canvas>, background, Perf, OrbitControls, grid, LiDAR group
  CameraFraming.tsx     initial camera + OrbitControls target, Reset View (renders nothing)
  PointCloud.tsx        BufferGeometry from typed arrays; picks Standard or Shader material
  ShaderPointsMaterial.tsx  RawShaderMaterial; shader table per experiment; uniforms; blending
  Trajectory.tsx        THREE.Line + <points> sharing one geometry of pose positions
  ScannerMarker.tsx     body + cone marker at the selected pose (position + quaternion)
  Controls.tsx          plain HTML overlay panel (no UI library)
  GaussianShapePanel.tsx    learning panel: sigmas, angle, covariance matrix
  gaussian/                 Lab 6 only (own page, own Canvas, own camera)
    GaussianProjectionScene.tsx  <Canvas>, OrbitControls, grid, axes, 1σ wireframe ellipsoid, quad
    ProjectedGaussianQuad.tsx    imperative RawShaderMaterial; projects every frame in useFrame
    GaussianProjectionPanel.tsx  sliders, toggles, Σ3D/Σ2D displays
    MatrixDisplay.tsx            monospace matrix printer
app/gaussian-projection/page.tsx  Lab 6 client page: controls state, Σ3D via useMemo
lib/gaussian/
  gaussianMath.ts       Gaussian3D type, covariance3D(), projectGaussian() (all math, commented)
  gaussianControls.ts   slider state + defaults, toGaussian3D() (Euler degrees → quaternion)
shaders/projectedGaussianShader.ts  GLSL3 quad vertex/fragment (conic falloff, outline)
lib/
  loadPointCloud.ts     binary point-cloud loader (format in section 5)
  loadPoses.ts          poses.csv parser, applies WORLD_OFFSET
  worldFrame.ts         WORLD_OFFSET and LIDAR_TO_THREE_ROTATION (single source of truth)
  pointBudgets.ts       list of { label, url } datasets
  usefulBounds.ts       1st–99th percentile bounding box (ignores stray points)
  initialView.ts        computes camera position + target from useful bounds
  viewSettings.ts       ViewSettings type + defaults; shader experiment types/params
shaders/                GLSL as exported TS template strings (no bundler loader needed)
scripts/convert_las.py  LAS → browser binary converter
public/data/            pointcloud-500k.bin, pointcloud-1m.bin, pointcloud-2m.bin, poses.csv
docs/                   this guide
```

Data and state flow:

- `page.tsx` owns state: selected budget, loaded point cloud, poses, selected pose index, `ViewSettings`, `viewResetRequest` counter, status/error strings.
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
float32[N * 3]        X, Y, Z    metres, WORLD_OFFSET already subtracted, Z-up
uint8[N * 3]          R, G, B    0..255
```

Total size = `4 + 15 N` bytes. The loader validates the size and creates `Float32Array`/`Uint8Array` **views** on the fetched `ArrayBuffer` (no copy).

### 5.2 Converter (`scripts/convert_las.py`)

```bash
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-500k.bin --max-points 500000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-1m.bin  --max-points 1000000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-2m.bin  --max-points 2000000
```

Steps, in this exact order:

1. Read real XYZ (laspy applies LAS scale/offset) and RGB.
2. **Compute the offset from the FULL dataset before downsampling**: X/Y = bounding-box centre, Z = minimum. Print it.
3. Random downsample with a fixed seed (`default_rng(0)`).
4. Subtract the offset, store as float32.
5. If RGB max > 255, shift 16-bit colours down by 8 bits.

The printed offset must be **identical** for every budget. For our scan it is
`[-8.19650038931286, 13.09700062207412, -1.1450000543845817]`, hard-coded in `lib/worldFrame.ts` as `WORLD_OFFSET`. If `map.las` changes, update it.

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

`loadPoses.ts` subtracts `WORLD_OFFSET` from positions (float64 → float32) and keeps timestamps (Float64Array) and orientations (Float32Array, xyzw).

Frame-agreement evidence for poses vs LAS (do this for any new dataset): the poses sit inside the LAS bounds, 86% of points lie within 3 m of the path, and the path is ~1.1–1.2 m above the lowest scan points (plausible scanner height). If such checks fail, the frames differ — diagnose; don't nudge.

### 5.4 Coordinate frames

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
- Compute once from the first dataset, store in a ref, reuse for Reset View, so switching budgets never moves the camera.
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

## 7. Lab-by-lab build specification

Each lab lists requirements and acceptance criteria. Build them in order.

### Lab 1 — Point cloud viewer

Requirements: full-screen R3F canvas, dark neutral background; load `.bin`; `BufferGeometry` with `position` + `color` attributes; `<points>` + `pointsMaterial` with vertex colours; `OrbitControls`; small HTML panel with point count, point-size slider, RGB toggle, axes toggle, grid toggle. Components: `SpatialScene`, `PointCloud`, `Controls`. Loading/error message if the file is missing. No fake data.

Accept: real scan renders; count matches file; all toggles work; missing file shows a clear error.

### Lab 1b — Point budgets and performance

Requirements: `<Perf position="top-right" />` inside the canvas; "Point Budget" selector 500K | 1M | 2M; show selected budget, actual loaded count, point size; loading message; only one dataset in memory (clear old data before fetching new; abort in-flight fetch on switch with `AbortController`); camera must not reset when switching.

Accept: switching budgets keeps the exact same view (pixel-identical after a round trip); the scan's dense-region centre is identical across budgets (within mm).

### Lab 2 — Scanner trajectory

Requirements: inspect `poses.csv` and validate column meaning from values (section 5.3); parse; subtract the shared `WORLD_OFFSET`; render inside the LiDAR group as a `THREE.Line` (via `<primitive>`, because JSX `<line>` is the SVG element) plus subtle `<points>` markers sharing one geometry; toggles "Show scanner path", "Show pose points"; display pose count. No orientation yet, no animation. If misaligned, report — don't adjust.

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
- **Projected-footprint measurement** (Lab 6): weight only pixels with the Gaussian's hue (`(G−B)/(R−B) ≈ 0.47` for the orange), and keep only the half of the screen away from the axis lines (the footprint is centrally symmetric) — otherwise axes blended into the faint tail bias the moments. Compare to a *simulated measurement* of the predicted Σ2D (same opacity, 8-bit rounding, threshold and 3σ cut), not to raw Σ2D: truncation and thresholding make the measured σ ~6% smaller.
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

Explicitly out of scope so far (each would be its own lab): LiDAR intensity visualisation, pose animation, clipping/cropping, measurement tools, annotations/hotspots, full Gaussian splatting (Lab 6 projects a single Gaussian; still missing: many Gaussians via instanced quads with per-instance Σ3D, projection in the vertex shader, back-to-front depth sorting, spherical-harmonic colour, loading `.ply`/`.splat` files), ordinary meshes, WebXR, LOD/octrees, workers.

## 12. Prompt templates

**Rebuild the whole app:**

> Build "Spatial Lab" exactly as specified in `docs/SPATIAL_LAB_REBUILD_GUIDE.md`. Follow the principles in section 2, the versions and config in section 3, the architecture in section 4, and implement Labs 1 through 6 in order (section 7). The datasets are in `public/data/` (`pointcloud-500k.bin`, `pointcloud-1m.bin`, `pointcloud-2m.bin`, `poses.csv`); the offset is in section 5.2. After each lab run the validation playbook (section 9) and report results. Do not generate fake data.

**Variant for another purpose:**

> Using `docs/SPATIAL_LAB_REBUILD_GUIDE.md` as the reference, build a variant for **[purpose]**. Keep sections 2, 5 and 6 unchanged. Apply the adaptations for [purpose] from section 10. Omit the learning panels and shader experiment selector unless needed. Validate with section 9.

**Add a new lab:**

> Extend Spatial Lab with **[lab]**. Preserve all features listed in section 7. Follow the principles in section 2 and the pipeline rules in section 6 (especially the uniform-update rule and shared world frame). Validate with section 9, then update `docs/SPATIAL_LAB_REBUILD_GUIDE.md` (lab spec, pitfalls, changelog).

**New dataset:**

> Convert `[file.las]` with `scripts/convert_las.py` for each budget; confirm the printed offset is identical; update `WORLD_OFFSET` in `lib/worldFrame.ts`. Validate `poses.csv` columns as in section 5.3 before rendering, and check frame agreement; if it fails, report instead of adjusting.

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
