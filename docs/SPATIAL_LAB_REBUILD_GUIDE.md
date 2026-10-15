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
| 7C | 5M budget + Properties → Captures | budgets added later are backfilled from stored originals in the same frame; organising datasets by place and session without merging frames |
| 8 | Real Gaussian splat viewer (separate page `/gaussian-viewer`) | real trained splats (PLY / SOG) imported locally and shown with the official SuperSplat Viewer; formats, packages, robust framing, renderer isolation and teardown |
| 9 | Gaussian Inspector (separate page `/gaussian-inspector`) | single Gaussians of a real trained PLY: stored vs decoded values (log scale, logit opacity, quaternion, SH colour), isolated preview through Lab 6's projection, experiments, view-dependent colour, reproducible samples |
| 10A | Photos for Gaussian training (separate page `/gaussian-training`) | training projects of real photographs: validated upload, thumbnails, per-photo checks (resolution, blur heuristic, duplicates, sizes) as warnings, planned pipeline stages, local training-environment assessment; nothing is trained yet |
| 10B (step 1) | Camera poses (same page) | structure from motion with COLMAP as a cancellable background job: which photos were placed, sparse points, reprojection error, lens; solved cameras and points in 3D; nothing is trained yet |
| 10C (stage 1) | Cloud training package (same page) | the COLMAP result checked from the shipped files and zipped with the placed photos, pinned Nerfstudio splatfacto scripts and a step-by-step rented-GPU procedure; nothing is uploaded or trained by the app |
| Basel | Basel House preview (built-in dataset on the main page) | a second binary layout (interleaved, metadata JSON), an explicit LAS → dataset → world chain, verifying the up axis from the data, framing a named region (scanner trajectory bounds) vs the whole cloud |

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
| `@playcanvas/supersplat-viewer` | **1.37.0** (exact) | Lab 8 only; the official SuperSplat Viewer, embedded with `createViewer` |
| `playcanvas` | **2.23.0** (exact) | the viewer's peer dependency (engine); the version the viewer is built against |
| `@types/three`, `@types/react`, `@types/react-dom`, `@types/node` | matching | dev |

Python (converter only): `python3`, `laspy`, `numpy` (`laspy[lazrs]` for `.laz`).

Optional CLI (not a dependency): SplatTransform, `npx @playcanvas/splat-transform` (3.10.1 tested; Node ≥ 22), to convert splat formats the viewer can't open (section 5.7).

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

Python 3.11+ (tested with 3.13), its own virtual environment, pinned in `backend/requirements.txt`: `fastapi 0.143.0`, `uvicorn[standard] 0.54.0`, `python-multipart 0.0.32`, `laspy 2.7.0`, `numpy 2.5.3`, `pillow 12.3.0` (Lab 8: decoding SOG WebP images to measure scenes), `scipy 1.18.1` (Lab 13V: calibration experiments; without it the backend still runs and `/xgrids/calibration/*` answers 503). After pulling a lab that adds a requirement, run `pip install -r` again and restart the backend.

```bash
# once
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# terminal 1: backend (local only)
cd backend && .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000

# terminal 2: frontend
npm run dev        # http://localhost:3000
```

Environment variables (all optional): `SPATIAL_LAB_DATA_DIR` (default `<repo>/spatial-data`), `SPATIAL_LAB_ALLOWED_ORIGINS` (CORS, default `http://localhost:3000,http://127.0.0.1:3000`), `SPATIAL_LAB_XGRIDS_DIR` (Lab 13R: the `<recording>/reconstruction/xgrids/images` folder of extraction runs; unset = the calibration page says so), and for the frontend `NEXT_PUBLIC_SPATIAL_API_URL` (default `http://127.0.0.1:8000`). The viewer works without the backend (built-in dataset only).

Disk (splat scenes, Lab 8): an upload needs about 2× its size while uploading; a .zip also keeps its extracted scene next to the original (≈ 2× the zip on disk).

Disk: an import needs roughly 2.3× the LAS size free while uploading (upload buffer + stored original) plus ~15 bytes × 3.5M points for the budgets.

## 4. Architecture

```
app/
  layout.tsx            root HTML, imports globals.css
  page.tsx              client page: ALL app state + data loading (datasets, budgets, poses); renders scene + panel
  globals.css           full-screen canvas, overlay panel styles
components/
  SpatialScene.tsx      <Canvas>, background, Perf, OrbitControls, grid, LiDAR group
  CameraFraming.tsx     camera + OrbitControls target: initial / scan-area / entire-cloud views computed once per dataset; Reset View, Focus on Scan Area, Frame Entire Cloud (renders nothing)
  DatasetManager.tsx    collapsible Properties section: property → capture → dataset pickers, catalog actions, metadata/status, import form, delete
  PointCloud.tsx        BufferGeometry from typed arrays; picks Standard or Shader material
  ShaderPointsMaterial.tsx  RawShaderMaterial; shader table per experiment; uniforms; blending
  Trajectory.tsx        THREE.Line (drawn on top) + <points> (≤ MAX_POSE_POINTS = 2,000 poses) sharing one geometry; start sphere
  ScannerMarker.tsx     body + cone marker at the selected pose (position + quaternion); ScannerBody = the reusable body frame (Lab 13R)
  calibration/          Lab 13R only
    CalibrationLayers.tsx  inside SpatialScene's LiDAR group (prop lidarLayers): instanced clickable event dots, halo, ScannerBody with
                           per-channel direction helpers (origin dot, dashed ray, translucent cone, up tick, drei <Html> label) and a
                           labelled X/Y/Z gizmo, Focus marker / Look along / "ray" camera moves (serial requests, damping flush)
    useCorrespondenceLab.ts   Lab 13U state: records (localStorage after mount), channel, pending pixel + pick, picking options,
                           assumed fisheye model, overlay toggles; chosenPick (nearest = "approximate"), datasetToLas (float64)
    CorrespondenceSection.tsx Lab 13U panel: workflow note, feature guidance, event chips, channel, pending pixel + "look along its ray",
                           Pick in 3D (armed toggle), pick result (nearest vs ray ∩ plane, refusal reason), settings, feature/quality/
                           notes + Save, record list (Show/Edit/Delete), projection controls + error stats, export/import;
                           Lab 13W: scene select, CoveragePanel + ReviewList, "other events" coverage toggle, `reference` prop
    CorrespondenceReview.tsx  Lab 13W: CoveragePanel (per-camera reliable counts vs 15–25, SVG fisheye coverage diagram, guidance,
                           "dataset not complete" note) and ReviewList (details, flags, Exclude/Restore, review status, scene,
                           corrections with history, filters)
    CorrespondenceViewer.tsx  Lab 13U image viewer (bottom right, Large/Small): wheel zoom about the cursor, drag pan, click = original
                           pixel (OpenCV), size/file-name check before picking, numbered markers, predicted × + residual, overlay canvas;
                           without onPick it only displays (Lab 13V)
    useCalibrationOptimization.ts  Lab 13V state (memory only): source export text + parsed records, audit, include/exclude overrides,
                           experiment, displayed parameter set, overlay toggle
    CalibrationOptimizationSection.tsx  Lab 13V panel: source (browser records via buildExport, or a file, text kept unchanged), audit
                           table with flags + use checkboxes, "Run optimization (experimental)", per-camera parameter (± 1σ, status) and
                           training/held-out error tables, diagnostics, per-point errors, image check, warnings, export/import
    CorrespondenceLayers.tsx  Lab 13U in the LiDAR group: canvas pointer handler (armed only, ≤ 4 px = click) → pickPoint; saved (cyan, #n)
                           and pending (white nearest, green refined, yellow chosen) markers drawn on top
    CalibrationPanel.tsx   run picker, LiDAR settings, frame check, event selection + facts, scanner pose, marker check, calibration status
                           (unknown); renders children (the direction test) at the end
    DirectionTestSection.tsx  Lab 13S: yaw/pitch/roll per channel (slider + number), reset/mirror/swap, cone length/angle, gizmo toggle,
                           presets, test-set chips + ◀/▶, per-event verdicts + notes, JSON export
    CameraPairPanel.tsx    ch14 + ch18 images from the backend, Hide/Small/Large, centre cross-hair, per-image file-name + size checks
app/camera-calibration/page.tsx    Lab 13R client page: LiDAR preview + poses (SHA-256 frame check), runs, event, cross-check, provisional cameras;
                                   Lab 13U: workspace mode (direction | correspondences), overlay (memoised projectCloud), record markers, ray views;
                                   Lab 13V: third mode "optimization" (viewer display-only, markers + overlay from the chosen parameter set)
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
    InspectorScene.tsx           Lab 9 <Canvas> (Lab 6 camera/reset), 1σ ellipsoid + own axes, gizmo, quad with SH colour, view reporter
    InspectorPanel.tsx           Lab 9 scene/index/sample pickers, stored → decoded table, experiments, Σ3D/Σ2D, scene statistics
app/gaussian-inspector/page.tsx    Lab 9 client page: scenes, layout, record + edits, sample, summary; preview Gaussian via useMemo
app/gaussian-training/page.tsx     Lab 10A–10C client page: projects, uploads with progress, environment report; pose job polling, photos ↔ 3D view; package report/build
components/training/               Lab 10A–10C
  TrainingPanel.tsx     project picker/creation, facts, add photos (files/folder), checks, refused files, camera poses (start/cancel/result), cloud training package (checks, size, build, download, next steps), stages, environment
  PhotoGrid.tsx         thumbnail grid: size, bytes, format, warnings, notes, placed/not placed, held out for evaluation, Remove
  PoseScene.tsx         Lab 10B <Canvas>: sparse points, camera frustums, click a camera → its photo, look through it
app/gaussian-viewer/page.tsx       Lab 8 client page: splat scene list, catalog, selection, start view; SplatViewer + SplatPanel
components/splat/                  Lab 8 only (no React Three Fiber on this page)
  SplatViewer.tsx       embeds the official SuperSplat Viewer (createViewer in a <div>), one instance per scene, destroy on change
  SplatPanel.tsx        scene picker (standalone / per capture), facts, start view, performance, capture assignment, delete, import form
app/gaussian-projection/page.tsx   Lab 6 client page: controls state, Σ3D via useMemo
app/gaussian-compositing/page.tsx  Lab 7B client page: controls state, scene via useMemo(count), report state
lib/gaussian/
  gaussianMath.ts       Gaussian3D type, covariance3D(), projectGaussian() (all math, commented)
  gaussianControls.ts   slider state + defaults, toGaussian3D() (Euler degrees → quaternion)
  compositing.ts        Lab 7B: allocation-free covariance/projection (same math as gaussianMath), splatAlphaAt, compositePixel
  compositingScene.ts   Lab 7B: scenes (3 hand-placed / 100 / 500 / 1,000 seeded), animation presets
  compositingControls.ts  Lab 7B panel state + defaults
  inspector.ts          Lab 9: record/layout/summary types + API, edits, preview Gaussian (180° Z, magnification), view colour
  sphericalHarmonics.ts Lab 9: SH basis (degrees 0–3, reference constants) and view-dependent colour
shaders/projectedGaussianShader.ts  GLSL3 quad vertex/fragment (conic falloff, outline)
shaders/compositedGaussianShader.ts GLSL3 instanced version (per-instance attributes, fill + outline pass)
lib/
  loadPointCloud.ts     binary point-cloud loader: "counted-planar" (section 5.1) and "interleaved-xyzrgb" (section 5.1.1)
  previewDataset.ts     static preview datasets: metadata JSON validation, loads points + metadata, count check
  loadPoses.ts          poses.csv loader; parsePoses(text, offset) parses and subtracts the dataset's offset
  xgrids.ts             Lab 13R: extraction-run types + API calls, image URLs, channel order, sha256Hex, positionAt (poses at a time)
  calibration.ts        Lab 13R/13S: per-camera intrinsics/extrinsics state (both "unknown"), provisional camera-to-scanner offsets
                        (yaw + = right, pitch + = up, roll + = clockwise) → rotation/axes/words, STARTING_HYPOTHESIS (ch14 −90°, ch18 +90°)
  directionTest.ts      Lab 13S: Basel test set (courtyard/indoor), helper shape, notes + presets in localStorage, JSON export
  correspondences.ts    Lab 13U: Correspondence record (pixel ↔ LAS, image identity, scanner pose, provisional), validation,
                        localStorage, export/import (schema "spatial-lab/xgrids-correspondences" v1), predict + error stats;
                        Lab 13W optional review fields (excludedFromFit, reviewStatus, scene, history) + withChange
  correspondenceReview.ts  Lab 13W: BASELINE_STAGE_B reference + LAB_13V_REVIEW ids, chooseReference, reviewRecords (distance, height,
                        region, sector, off-axis, reference error, flags mirroring the backend audit), coverage (reliable-only)
  pointPicking.ts       Lab 13U: screen-space pick (front surface, nearest point), PCA plane refinement (ray ∩ plane, refusals),
                        surfaceRangeAlongRay, Jacobi eigen-solver
  fisheyeProjection.ts  Lab 13U: assumed equidistant model (f, cx, cy, usable radius; status "assumed" | "experimental-estimate"),
                        LAS → pixel projector, projectCloud (overlay), pixelRayDirection (inverse)
  calibrationExperiment.ts  Lab 13V: audit/experiment types, POST calls (export text sent unchanged), experiment validation
                        (schema "spatial-lab/xgrids-calibration-experiment" v1), predictWith(record, set camera)
  worldFrame.ts         the documented LAS → dataset → world chain: LIDAR_TO_THREE_ROTATION (Z-up → Y-up),
                        lasBoxToDataset, lidarBoxToWorld, lidarPointToWorld, describeVerticalAxis (up-axis check)
  importPlan.ts         folder/files → import plan: role detection, ambiguity flags, preview summary
  catalog.ts            Property/Capture/Catalog types, helpers, catalog API calls (Lab 7C)
  splats.ts             Lab 8: SplatScene type, splat API calls, selection checks, start camera (robust box, 180° Z)
  training.ts           Lab 10A: training project/environment types, API calls, warning explanations, file partition, batched XHR upload with progress; 10B pose job/preview types + calls; 10C package types, calls, download URL
  poseView.ts           Lab 10B: COLMAP frame → display (median centre, cameras' mean up, 90% radius), frustum line segments
  datasets.ts           Dataset type (= backend metadata), BUILTIN_DATASETS (map.las + Basel House preview),
                        asset URLs, pickBudget(), backend API calls, client-side file checks
  usefulBounds.ts       1st–99th percentile bounding box (ignores stray points)
  initialView.ts        camera position + target: computeViewOfBox(box) and computeInitialView (= useful bounds)
  viewSettings.ts       ViewSettings type + defaults; shader experiment types/params
shaders/                GLSL as exported TS template strings (no bundler loader needed)
scripts/convert_las.py  LAS → browser binary converter (CLI; uses backend/lidar_conversion.py)
scripts/xgrids/         standalone XGRIDS .xbin tools (section 5.12; README.md lists commands and options)
  index_xbin.py         Lab 13P: indexer of the camera frames (no image decoding) → frames.csv, index-summary.json
  extract_frames.py     Lab 13Q: decodes chosen ch14 + ch18 pairs to JPEG via FFmpeg, interpolated scanner poses
  calibrate_cameras.py  Lab 13V: audit + experimental calibration of a correspondence export → audit/experiment JSON outside the repo
  compare_experiments.py  Lab 13W: compares experiment files against a baseline (parameters, σ shifts, errors, folds, image check)
tests/xgrids/           unittest suite on synthetic XBAG-like files (synthetic_xbag.py builds them; no real data);
                        test_camera_calibration.py (Lab 13V, synthetic correspondences, needs SciPy)
docs/xgrids/            xbag-format.md (format, verified vs provisional), investigation-log.md, calibration-notes.md,
                        calibration-workspace.md (Lab 13R: running, behaviour, assumptions, validation, remaining work),
                        correspondences.md (Lab 13U: workflow, picking, schema, conventions, projection assumptions, validation),
                        calibration-experiments.md (Lab 13V: concepts, method, commands, format, Basel results, limits;
                        Lab 13W sensitivity), correspondences.md § Review and coverage (Lab 13W)
public/data/            built-in dataset: pointcloud-500k/1m/2m/5m.bin (gitignored), poses.csv
public/datasets/basel-house/  Basel House preview: basel-preview-1m.bin + basel-preview-metadata.json,
                        basel-preview-5m.bin + basel-preview-5m-metadata.json (.bin gitignored, JSON tracked)
backend/                local FastAPI dataset service (Lab 7A)
  app.py                routes, CORS, worker process pool, restart recovery
  storage.py            dataset folders, id validation, atomic metadata.json, budget table + planned/missing budgets
  catalog.py            properties/captures in catalog.json (references only), atomic writes, lock
  splats.py             Lab 8: splat scene store, PLY/SOG/zip inspection, safe extraction, served-file whitelist
  splat_bounds.py       Lab 8: robust bounds + free "inside" viewpoint from the splat centres (PLY, SOG decoding)
  gaussian_records.py   Lab 9: memory-mapped, read-only access to single Gaussians of a PLY; decoding; SplitMix64 samples; statistics
  training.py           Lab 10A: training-photo store, Pillow validation, thumbnails, checks (resolution, blur, duplicates, sizes), planned stages
  training_env.py       Lab 10A: read-only report of OS/CPU/memory/GPU/disk/tools/packages and a local-training verdict
  training_poses.py     Lab 10B: COLMAP pose job (preprocess → features → matching → mapper), progress from its logs, cancel, summary + preview
  xgrids_runs.py        Lab 13R: read-only access to extraction runs in SPATIAL_LAB_XGRIDS_DIR (strict manifest parse, events,
                        manifest-listed images only); GET /xgrids/runs, /xgrids/runs/{run}, /xgrids/runs/{run}/images/{file}
  camera_calibration.py Lab 13V: correspondence loading/validation, run cross-check, audit flags, equidistant projection, Stage A/B
                        robust fits (SciPy least_squares), leave-one-event-out, sensitivity, identifiability, experiment JSON, image
                        check (NCC); POST /xgrids/calibration/audit, /xgrids/calibration/experiments (stateless, body ≤ 5 MB)
  training_package.py   Lab 10C: COLMAP binary reader, checks of the shipped files, lossless JPEG metadata removal, zip + manifest + SHA256SUMS
  cloud_training/       Lab 10C files copied into every package: README.md (cloud procedure), setup_env.sh, train.sh,
                        requirements-nerfstudio.lock.txt (239 pins, resolved as of Nerfstudio 1.1.5's release)
  uploads.py            per-role extension/size/content validation
  converter.py          conversion job (progress → metadata), budget backfill job, pose/frame validation
  lidar_conversion.py   shared core: chunked LAS read, offset, sampling, .bin writer
  requirements.txt
spatial-data/           (gitignored) datasets/<id>/{metadata.json, source/, converted/}, splats/<id>/{...},
                        training/<id>/{project.json, source/, thumbs/, work/, exports/, output/}, catalog.json
docs/                   this guide
```

Data and state flow:

- `page.tsx` owns state: dataset list (built-in + backend), catalog (properties/captures), selected dataset id, preferred budget key, loaded point cloud and poses (each tagged with its dataset id), selected pose index, `ViewSettings`, `viewRequest` (`{kind: "initial" | "scanArea" | "entire", serial}`), status/error strings. For preview datasets the loaded metadata fills the dataset's `offset`, `originalBounds` and `originalPointCount`. The dataset list is polled every 1.5 s only while a conversion runs.
- Loaded data is stored as `{ datasetId, data }` and only passed to the scene when `datasetId` matches the selection, so the scene never sees the previous dataset's data together with the new dataset's id (which would frame the camera on the wrong scene).
- Effects depend on primitive keys (URL strings, ids), not on dataset objects, because polling replaces the objects every 1.5 s.
- Data flows **down** as props: `page → SpatialScene → PointCloud/Trajectory/ScannerMarker`, and `page → Controls`.
- Controls report changes **up** via callbacks (`onChange(settings)`, `onBudgetChange`, `onPoseIndexChange`, `onResetView`).
- HTML UI lives outside the `<Canvas>`; communication into the canvas uses props (e.g. a `viewRequest` whose `serial` increments on every click, watched by an effect inside the canvas).
- `ViewSettings` is one flat-ish object; experiment parameters are grouped (`softPoints`). Add new toggles there with a default.

Scene graph (inside `<Canvas linear flat>`):

```
<color background #1a1a1a>
<Perf position="top-right">
<OrbitControls makeDefault>
<CameraFraming>
<gridHelper 100 m, 1 m cells>             (three.js world, Y-up; at lidarPointToWorld(helperOrigin))
<group rotation={LIDAR_TO_THREE_ROTATION}> (LiDAR frame, Z-up, metres, offset applied)
  <axesHelper 5 m position={helperOrigin}> (helperOrigin = [0,0,0], or −offset = the LAS origin for previews)
  <PointCloud>
  <Trajectory>
  <ScannerMarker>
  {lidarLayers}                            (optional page-specific layers in the LiDAR frame, e.g. Lab 13R's CalibrationLayers)
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

#### 5.1.1 Interleaved preview format (Basel House)

`loadPointCloud(url, signal, "interleaved-xyzrgb")`. No header, one 15-byte record per point, little-endian:

```
float32 X, float32 Y, float32 Z, uint8 R, uint8 G, uint8 B     (× N, N = bytes / 15)
```

Records are 15 bytes, so floats are not 4-byte aligned: they **cannot** be viewed as a `Float32Array`; the loader de-interleaves through a `DataView` (`getFloat32(i*15 + k*4, true)`) into new planar arrays, then the rest of the app sees the same `PointCloudData` as for the planar format. Size not a multiple of 15 → error.

Every preview has a metadata JSON next to it (`lib/previewDataset.ts` validates it; the point count must equal `previewPointCount`):

```jsonc
{ "source": "map-002.las", "sourcePointCount": 259986436, "previewPointCount": 1003809,
  "coordinateCenter": [-22.6653, 0.4986, 32.0324],      // subtracted from LAS coords = the dataset offset
  "sourceBounds": { "min": [...], "max": [...] },       // full LAS cloud, original coordinates
  "strideBytes": 15, "layout": "float32 xyz + uint8 rgb",
  "coordinateSystem": "Original LAS axes; centered only" }
```

Basel's `coordinateCenter` is the midpoint of `sourceBounds` (including Z), unlike our converter, which uses the minimum Z. `Dataset.preview` (in `lib/datasets.ts`) holds `files` (points + metadata URL per budget key) and an optional `scanArea` box in **original LAS coordinates** (Basel: the scanner trajectory bounds X −41.80..6.85, Y −22.63..17.66, Z −3.60..2.73). Previews have no backend; optional `posesUrl` points to a header-less `poses.csv` in original LAS coordinates (loaded with `loadPoses(url, offset)` like any dataset's poses; the pose `status` in the dataset record documents the frame checks run offline). Basel has two budgets, 1M (1,003,809 points) and 5M (5,097,774 points, 76.5 MB), with the same `coordinateCenter` and `sourceBounds`.

Budget switches keep the frame: `page.tsx` keeps the dataset's last loaded metadata (`previewFrame`) while another budget loads, so offset, axes/grid position and the framing boxes never change, and it **refuses** a budget whose `coordinateCenter` differs from the dataset's ("Couldn't load the 5M budget: its coordinateCenter … differs"), rather than showing it shifted.

### 5.2 Converter (`scripts/convert_las.py`)

```bash
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-500k.bin --max-points 500000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-1m.bin  --max-points 1000000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-2m.bin  --max-points 2000000
python3 scripts/convert_las.py source-data/map.las public/data/pointcloud-5m.bin  --max-points 5000000
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

Budgets: 500K, 1M, 2M, 5M (`storage.BUDGETS`); the first budget ≥ the dataset size is replaced by one `"all"` budget labelled `All (N)` and larger budgets are skipped (a 300K scan has only `All (300K)`; a 4.2M scan has 500K, 1M, 2M, All (4.2M)) — points are never duplicated. `storage.planned_budgets(total)` is the single rule used by both the conversion and the backfill.

**Backfill (7C):** adding a budget to `BUDGETS` is enough for existing datasets. On backend start, every ready dataset with `missing_budgets()` gets a `budgetJob` and `converter.backfill_budgets` runs in the worker: it re-reads `source/pointcloud.las`, recomputes the offset and point count and **refuses** (job `failed`, nothing written) if either differs from `metadata.json`; otherwise it writes only the missing files with the *stored* offset and appends them to `budgets`. Existing budget files are never rewritten. The dataset stays viewable (the panel shows the job's stage and progress); `DELETE` is refused while it runs. `budgetJob`: `{status: queued|running|failed, progress, stage, error}` or `null`.

Extensibility: new asset types (trained splats, meshes, measurements, annotations) become new optional top-level keys next to `budgets`/`poses`, each with its own status, or their own datasets referenced from a capture (section 5.6). Bump `schemaVersion` when an existing key changes meaning.

### 5.6 Properties and captures (`catalog.json`, Lab 7C)

```
Property  (a real-world place: resort, house, gallery)
  Capture   (one scanning / photography session there)
    representations: [{ kind: "lidar", datasetId }]            → dataset folders (section 5.4)
                     [{ kind: "gaussian-splat", datasetId }]   → splat scenes (section 5.7, Lab 8)
```

`spatial-data/catalog.json` (atomic writes, one lock in the API process):

```jsonc
{
  "schemaVersion": 1,
  "properties": [{ "id": "prop_<12 hex>", "name", "createdAt", "frame": null }],
  "captures": [{ "id": "cap_<12 hex>", "propertyId", "name", "createdAt", "environment": null,
                 "representations": [{ "kind": "lidar", "datasetId": "ds_… | builtin-map" }],
                 "alignment": { "status": "unaligned", "method": null, "reference": null, "transform": null } }]
}
```

Rules: the catalog only **references** datasets (never copies, moves or edits their files, metadata or offsets); a dataset is in at most one capture (assigning it elsewhere moves the reference); datasets in no capture are "unassigned"; deleting a property or capture never deletes files (its datasets become unassigned); only `DELETE /datasets/{id}` removes files, and it also drops the reference. Captures are **never merged** and not assumed to share a frame: each keeps its dataset's offset. `alignment` (capture → property transform, method such as registration or control points, reference) and the property's `frame` are reserved for future registration and are not applied anywhere; `environment` is reserved for indoor/outdoor organisation. Future representation kinds: photos, trained splats, meshes.

**Migration:** none needed. No `catalog.json` = empty catalog = every existing dataset (and the built-in one) under "Unassigned datasets". Dataset folders are untouched; an older backend simply ignores `catalog.json`.

### 5.5 Coordinate frames

Each dataset has its own local frame: real-world LAS coordinates minus that dataset's `offset`. Two datasets are therefore **not** in a common frame, even if they cover the same space; comparing captures needs an explicit alignment step (roadmap).

| Frame | Up axis | Where used |
| --- | --- | --- |
| LAS / LiDAR local | +Z | `.bin` positions, poses, quaternions, axes helper |
| three.js world | +Y | grid, camera, OrbitControls |
| Scanner body | +Z up, +X forward (ROS convention, assumed) | scanner marker |
| View space (camera) | camera looks down −Z | shaders (`mvPosition`) |
| Point sprite | `gl_PointCoord` 0..1, **y grows downward** | fragment shaders |

Conversion LiDAR → three.js is exactly one rotation of −90° about X (`LIDAR_TO_THREE_ROTATION = [-π/2, 0, 0]`), so `(x, y, z)_lidar → (x, z, −y)_three`. Apply it **once**, on the parent group. Children (points, path, marker) use raw LiDAR-frame values. Code outside the group that needs world coordinates (camera framing, grid position) must use the same matrix through `lidarBoxToWorld` / `lidarPointToWorld` (`lib/worldFrame.ts`).

The full chain, the only transforms in the app (documented at the top of `lib/worldFrame.ts`):

```
dataset = LAS − offset                 (offset = converter offset, or coordinateCenter for previews)
world   = R · dataset                  (R = −90° about X: (x, y, z) → (x, z, −y))
```

Named regions given in LAS coordinates (a preview's `scanArea`) go through `lasBoxToDataset(min, max, offset)` and then the same rotation. No other rotation, offset or scale is applied anywhere; if a scan looks wrong, check the data, don't add one.

**Up axis is checked, not assumed:** `describeVerticalAxis(positions)` compares the 1st–99th percentile extents and reports "Z up (checked …)" when Z is the smallest, or a ⚠ warning otherwise (shown in the panel's stats). map.las: 6.2 × 7.7 × 1.5 m; Basel: 56.1 × 42.1 × 8.7 m (full box 225 × 208 × 99 m because of outliers).

Quaternions: apply the recorded `(qx, qy, qz, qw)` directly as the marker group's `quaternion` inside the LiDAR group (three.js uses the same xyzw order). Any mismatch between the marker geometry's forward axis and the scanner's convention is fixed by a separate constant child rotation (`MARKER_FORWARD_CORRECTION`), never by editing recorded quaternions.

### 5.7 Gaussian splat scenes (Lab 8)

Trained 3D Gaussian splat scenes are a **separate store** (`spatial-data/splats/spl_<12 hex>/`), never read as LAS:

```
splats/<id>/
  metadata.json
  source/      the original upload, never modified: scene.ply | scene.compressed.ply | scene.sog | original.zip | package/<relative paths>
  converted/   only for .zip uploads: the scene extracted from it (scene.ply | scene.sog | package/<relative paths>)
```

Supported inputs (exactly these; all are opened by the viewer directly, so no format conversion happens):

| Import | Detected by | `format` | Viewer opens |
| --- | --- | --- | --- |
| Trained Gaussian `.ply` | PLY header: `format binary_little_endian`, `element vertex` with `x y z f_dc_0..2 opacity scale_0..2 rot_0..3` (+ `f_rest_*`: 9/24/45 → 1/2/3 SH bands); file length = header + Σ count × stride | `ply` | `scene.ply` |
| SuperSplat compressed PLY | `element chunk` + vertex `packed_position` (the header decides, not the extension) | `compressed-ply` | `scene.compressed.ply` |
| Bundled `.sog` | a zip with `meta.json` at its root + the WebP images it lists (inspected without extracting) | `sog` | `scene.sog` |
| SOG folder | `meta.json` (`count`, `means/scales/quats/sh0[/shN]` each with `files`) + those WebP images | `sog-folder` | `package/…/meta.json` |
| SOG with levels of detail | `lod-meta.json` (`count`, `lodLevels`, `filenames` → chunk `N_M/meta.json`, optional `environment`) + every chunk's WebP images | `sog-lod` | `package/…/lod-meta.json` |
| `.zip` of any of these (e.g. SuperSplat downloads: "Ceramic Studio.zip" = SOG LOD, "Ceramic Studio (1).zip" = PLY, the "-vite" project export = SOG LOD under `public/splat/`) | the shallowest `lod-meta.json`, else `meta.json`, else exactly one `.sog` or `.ply` | as above | extracted copy in `converted/` |

Package rules (folder and zip): the package root is the folder of the shallowest `lod-meta.json` (chunk folders contain `meta.json` too), else of the shallowest `meta.json`; every referenced file must exist ("incomplete SOG package: 1 referenced file(s) missing: 0_1/quats.webp"); WebP signatures (`RIFF….WEBP`) checked; the folder structure and relative paths are preserved exactly (the viewer fetches WebP images and chunks relative to the manifest URL). Each path segment must match `[A-Za-z0-9_][A-Za-z0-9 ._()+-]*`, at most 6 deep, no `..`/absolute paths; hidden files and `__MACOSX` are skipped; only `.json .webp .sog .txt` are stored from folders (other files are reported as ignored). Zip extraction re-validates every name, refuses encrypted entries, caps total size (4 GiB) and file count (2,000), and stops if an entry yields more bytes than it declares. Nothing uploaded is executed. `license.txt` (attribution, e.g. CC BY-NC) is kept and shown.

Rejected with explanations: ordinary point-cloud/mesh PLY ("vertex properties: x, y, z, red… not a trained Gaussian splat… LiDAR point clouds are imported as .las"), ASCII/big-endian PLY, truncated PLY ("header declares 3,701,324 splats (873,513,942 bytes) but it has 50,000,000"), `.las/.laz` (→ LiDAR viewer), a lone `meta.json`/`.webp` (→ choose the folder), `.splat/.ksplat/.spz/.lcc` (→ SplatTransform, below), `.html` exports, zips without exactly one scene.

**Conversion with SplatTransform** (only for formats the viewer can't open, or to shrink a big PLY):

```bash
npx @playcanvas/splat-transform scene.splat scene.sog          # .splat / .ksplat / .spz / .lcc → bundled SOG
npx @playcanvas/splat-transform scene.ply scene.sog            # optional: shrink a PLY, much faster loading
npx @playcanvas/splat-transform scene.ply out/lod-meta.json    # optional: streaming LOD package (import the out/ folder)
```

Tested: Ceramic Studio `scene.ply` (236 MB, 999,986 splats) → `scene.sog` 16.6 MB in ~3.5 min on an M-series Mac (GPU k-means); it imports and renders like the SuperSplat download. The LOD command failed there in GPU k-means (`readBuffer`); `-g cpu` works around GPU failures but took over 15 min, so prefer the LOD package SuperSplat exports.

Import the result as usual; the original stays wherever it was.

Metadata (`metadata.json`): `id, name, kind: "gaussian-scene", createdAt, format, formatLabel, splatCount, shBands, lodLevels, source {kind: file|folder|zip, filename (display only), bytes, fileCount}, servedFrom (source|converted), entry, files [{path, bytes}], sceneBytes, conversion (zip extraction note or null), license, robustBounds, warnings, frame {units, upAxis, alignedTo: null}`. Only paths listed in `files` are served (`GET /splats/{id}/files/{path}`, resolved inside `servedFrom`); `original.zip`, `license.txt` and `metadata.json` are not.

**Frames.** A trained scene has its own arbitrary frame (often the camera solver's, Y-down, unknown scale). It is **never** assumed to match a LiDAR capture, even inside the same capture of the catalog; `frame.alignedTo` stays null. The viewer rotates every scene 180° about Z (Y-down → Y-up); code that computes viewer-space positions from file values applies `(x, y, z) → (−x, −y, z)` (`startCamera` in `lib/splats.ts`).

**Robust bounds and start view** (`splat_bounds.py`, computed at import, never fails the import): centres are read per format (PLY `x y z` memory-mapped; compressed PLY: chunk box centres; SOG: `means_u << 8 | means_l` / 65535 → lerp(`mins`, `maxs`) → `sign(v)·(exp|v| − 1)`); the 2nd–98th percentile box per axis frames the scene (Ceramic Studio: core 10.9 × 3.8 × 3.3 inside a ±200 floater box; PLY and SOG versions give the same box to 4 decimals). `centralFraction` (share of centres in the middle half of the box: rooms 0.04–0.17, a compact object ~0.8) picks the default start view (> 0.35 → outside). `insideViewpoint`: the box in 16³ cells; a cell is free if it and its 26 neighbours are (almost) empty; the free cell at mid height nearest the centre, looking along the horizontal direction (of 16) with the longest clear run; the orbit target sits half that run ahead.

### 5.8 Trained Gaussian attributes (Lab 9)

A trained Gaussian PLY (3D Gaussian Splatting reference layout; SuperSplat's PLY download is the same) is a text header plus one binary little-endian `vertex` record of float32 properties per Gaussian, found by **name**, never by position (Ceramic Studio's order is `x y z rot_0..3 scale_0..2 opacity f_dc_0..2 f_rest_0..44`, 236 bytes; training output usually has `nx ny nz` after `z`, always 0 and unused). Gaussian *i* starts at `dataOffset + i·stride` (`dataOffset` = header length plus any earlier elements).

| Stored | Meaning | Decoded (what the renderer uses) |
| --- | --- | --- |
| `x y z` | centre, scene file frame | as is |
| `scale_0..2` | natural log of the standard deviation along the Gaussian's own axes | `σ = exp(v)` (always > 0; spans µm–m) |
| `rot_0..3` | quaternion **(w, x, y, z)**, not normalised | `q / |q|` (three.js order is `(x, y, z, w)`) |
| `opacity` | logit | `α = 1 / (1 + e^−v)` (in (0, 1)) |
| `f_dc_0..2` | degree-0 SH coefficient per RGB channel | base colour `0.5 + C0·f_dc`, `C0 = 0.28209479177387814` |
| `f_rest_*` | 3·K higher SH coefficients, K = 3 / 8 / 15 (degree 1 / 2 / 3), **channel-major**: all K red, then K green, then K blue | coefficient k of channel c = `f_rest[c·K + k]`; colour(dir) = base + Σ coefficient·basis(dir), clamped ≥ 0 |

SH basis and constants are the reference implementation's (`sh_utils.py`), identical to PlayCanvas's `evalSH` (its constants and signs were compared); `dir` = unit vector **from the camera to the Gaussian, in the file (model) frame** (PlayCanvas: `normalize(center.view * mat3(modelView))`). An ordinary point-cloud PLY (`x y z red green blue …`) has none of these fields and is refused at import (section 5.7). A compressed PLY (chunked, quantised) and SOG (quantised WebP images) are not per-Gaussian records: the inspector refuses them with a hint (decompress with SplatTransform / import the `.ply`).

**Reading** (`backend/gaussian_records.py`): `np.memmap` of the vertex records (structured dtype from the header), so a request reads only the requested records' pages (~16 ms for 3 records of a 236 MB file); read-only, nothing written back. Non-finite values become `null` in JSON and are flagged in `checks` (with zero-length quaternions, scales > 1 km and base colours outside 0..1). Samples use **SplitMix64** (seed → the same indices on any machine/NumPy version; duplicates skipped; modulo bias < 2⁻⁴⁰); the summary reads 20,000 sampled records in sorted order.

**Ceramic Studio facts** (20,000 sampled, seed 1): no non-finite values or zero quaternions; quaternions already unit length (1 ± 4·10⁻⁸); largest σ median 11.4 mm (5%: 1.7 mm, 95%: 69 mm); smallest σ median 1.4 mm and ~0 for 5% (flat discs: largest ÷ smallest median 6.6, 95th percentile 10⁸); opacity median 0.21; every opacity is a multiple of 1/255 and every base colour inside 0..1 → this PLY was saved from compressed data (SuperSplat export), not straight from training. Cross-check: decoding 128 sampled PLY Gaussians and matching them by position to the same scene's SOG package (decoded independently: means, `scales` codebook → exp, `sh0` codebook + alpha/255, smallest-three quaternions) agrees to 3·10⁻⁷ m, exact scales and colours, opacity within 10⁻⁸, identical rotations.

### 5.9 Training photographs (Lab 10A)

Photographs for Gaussian training are a **third separate store**, `spatial-data/training/trn_<12 hex>/` (never mixed with LiDAR datasets or splat scenes):

```
project.json     name, createdAt, association {propertyId: null, captureId: null} (reserved), images[], rejected[] (last 200), jobs: []
source/          originals as <img_id>.jpg|png|heic (extension from the detected content; never served)
thumbs/          <img_id>.jpg, longer side 320 px, EXIF orientation applied (the only image files the API serves)
work/            Lab 10B jobs: poses.json + poses/ (section 5.10)
exports/         Lab 10C: <slug>-training-package.zip + package.json (section 5.11)
output/          reserved for trained results (PLY/SOG)
```

`project.json` is written atomically under one lock per project. Each image entry: `id` (`img_<12 hex>`), `filename` (display only, never used as a path), `storedAs`, `bytes`, `format`, `width`/`height` (after EXIF orientation), `orientation`, `camera` (make, model, focal length, 35 mm focal length; **GPS is never read**), `takenAt`, `sha256`, `dhash`, `sharpness`, `notes`, `addedAt`.

**Upload validation** (`POST /training/{id}/images`, multipart `files`): extension `.jpg/.jpeg/.png/.heic/.heif` (DNG/MOV/MP4 refused with a specific hint), ≤ 64 MiB streamed to a temp file, free disk ≥ 2 GiB + file size, Pillow `verify()` then a full decode (catches truncated JPG/PNG), format from the **content** (a JPEG named `.png` is accepted as JPEG with a note),

**HEIC/HEIF** (iPhone default) is read through `pillow-heif` (`register_heif_opener()`, format name `HEIF`), stored as `.heic` and converted to JPG only in Lab 10B's preprocessing (COLMAP and the trainers don't read HEIC). Differences from JPEG: pillow-heif applies the rotation while decoding (size is already the displayed size, EXIF orientation reads 1; the original tag is `info["original_orientation"]` and is what we record), and **libheif decodes a truncated HEIC without an error** (missing tiles become garbage), so the box chain is checked first (`heif_complete`: every top-level box — 32-bit size, or 64-bit when the size field is 1 — must fit inside the file). ≤ 120 megapixels (decompression-bomb guard), ≤ 2,000 photos per project. Refused files are listed with a reason; nothing is executed or trusted by name.

**Checks** (recomputed on every read, so removing a photo updates them; warnings never block):

| Kind | Rule |
| --- | --- |
| `low-resolution` | shorter side < 1000 px ("very low" < 480 px) |
| `blur` | variance of the Laplacian on a ≤ 1024 px grey copy < 30, or (≥ 5 photos) < 0.35 × the project median. A heuristic: plain walls also score low |
| `duplicate` | same SHA-256 as an earlier photo (exact match is checked before near matches) |
| `near-duplicate` | 64-bit dHash (9×8 grey) within 4 bits of the closest earlier photo (resized, re-encoded, slightly blurred copies) |
| `dimensions` / `orientation` | width × height differs from the most common size; a 90°-turned common size is reported as orientation only |

The checks look at each photo on its own: they **cannot** tell whether photos overlap enough or cover the space. That is only known once camera poses are estimated (Lab 10B).

**Stages** (returned with every project): image preprocessing → camera pose estimation (COLMAP) → Gaussian training (Nerfstudio splatfacto on a rented GPU, Lab 10C) → export Gaussian PLY (readable by Labs 8/9) → optional SOG (SplatTransform). Since 10B step 1 the first two carry the pose job's status (`queued`/`running`/`done`/`failed`/`cancelled`/`outdated`, attributed to the step it stopped in); the rest stay `planned`. No poses or Gaussians are invented; `jobs` in `project.json` stays empty (the pose job lives in `work/poses.json`).

**Environment** (`GET /training/environment`, `training_env.py`): OS/arch, CPU, memory (`sysctl`), GPUs (`system_profiler SPDisplaysDataType -json` on macOS, `nvidia-smi` elsewhere), free disk, tools on `PATH` (colmap, glomap, brush_app, opensplat, ns-train, ffmpeg, nvidia-smi, docker), Python packages found with `importlib.util.find_spec` (torch, gsplat, pycolmap, cv2; nothing imported). Verdict: `local-cuda`, `local-metal-limited` or `cpu-only` with notes (memory < 16 GB, disk < 30 GiB, missing COLMAP/trainer). Read-only: it never installs anything. Tools are looked up on `PATH` and in Homebrew's folders (`/opt/homebrew/bin`, `/usr/local/bin`), since a backend started outside a login shell may lack them.

### 5.10 Camera poses (Lab 10B, step 1)

Structure from motion with **COLMAP** (macOS: `brew install colmap`; 4.2.1 tested, CPU only, about 40 MB plus Qt/Boost/Ceres dependencies). One background job per project (`training_poses.py`), in its own worker process (`training_executor`, so LiDAR conversions don't queue behind it):

```
work/poses.json          job: status, step, stage text, progress 0..1, imageIds (the set it ran on), settings, summary, error + logTail
work/poses/images/       <img_id>.jpg: EXIF orientation applied, longer side 1600 px, quality 95, camera EXIF kept (orientation reset to 1)
work/poses/database.db   features + matches
work/poses/sparse/<n>/   COLMAP models (binary); several = groups of photos COLMAP couldn't connect
work/poses/model/        the largest model as text (cameras.txt, images.txt, points3D.txt; COLMAP 4 adds rigs.txt, frames.txt)
work/poses/preview.json  cameras (centre, camera-to-world axes, matched points) + up to 60,000 points (seeded sample), COLMAP frame
work/poses/*.log         COLMAP output per step
```

| Step | Command and settings | Progress from the log | Measured (191–192 iPhone SE photos, M2, 8 GB) |
| --- | --- | --- | --- |
| preprocess | Pillow (+ pillow-heif): upright copies at 1600 px | per photo | 33 s |
| features | `feature_extractor`, `OPENCV` camera, `single_camera 1` only if every copy has the same size, `use_gpu 0`, 4 threads, `SiftExtraction.first_octave 0` | `Processed file [i/N]` | 24–52 s |
| matching | `exhaustive_matcher` (≤ 300 photos) else `sequential_matcher` (overlap 20, quadratic), `use_gpu 0`, 4 threads | `Processing block [i/B, j/B]` / `Matching image [i/N]` | 100–155 s |
| mapping | `mapper` (incremental), 4 threads | each `Registering image #…` line | 40–67 s |

Whole job about 4 minutes. The job is the only writer of `poses.json` while it runs (the API writes it only when queueing and at startup recovery, so no cross-process lock is needed). **Cancel** = the API touches `work/CANCEL`; the worker polls it every 0.5 s and **kills** COLMAP (it ignores SIGTERM). A job active at startup is marked `failed` ("interrupted by a backend restart"), never silently re-run. While a job is queued/running, uploads, photo removal and project deletion return 409. When the photo set changes after a run, the job view is `outdated` (stored `imageIds` ≠ current ids).

**Summary** (from the text model only): photos placed vs total, `notRegistered` ids, matched points per placed photo, point count, mean reprojection error (px), mean track length, lenses (model, size, focal px), photos per model, seconds per step. **Nothing is guessed**: unplaced photos are listed, not posed. Result on the real 192-photo room set: 176 placed (0.945 px, 20,832 points, focal 1310 px for 1200×1600), the 16 unplaced being plain ceiling/wall shots and extreme close-ups; with the one near-duplicate removed, 174 of 191 (0.942 px). Incremental SfM is sensitive to the exact photo set.

**Incremental vs global mapper** (COLMAP 4's built-in `global_mapper`, formerly GLOMAP): global placed all 192 in 20 s (1.18 px), but its 16 extra photos had 0–100 matched points (median 429 for the others; several had 0–3) — poses without evidence. On the 176 both placed, the cameras agree to 0.45% of the scene radius (median, after a similarity alignment). So the job uses the incremental mapper.

**3D view** (`lib/poseView.ts`, `PoseScene.tsx`): COLMAP fixes no origin, up or scale, so for display only: centre = per-axis median of the points, up = mean of the cameras' up vectors (−y column of camera-to-world; phones are held roughly upright), scale = 90% of points within 4 units. Point colours are sRGB → linear. Frustums: apex at the centre, base = the image rectangle at depth 0.3 using `width/2/fx`, `height/2/fy`. "Look through this camera" sets the view at the solved centre, looking along its z axis, with the photo's vertical FOV (`2·atan(h/2/fy)`).

### 5.11 Cloud training package (Lab 10C, stage 1)

Gaussian training needs an NVIDIA GPU (CUDA), so it runs on a rented one; the app only **prepares** it (`training_package.py`). Nothing is uploaded, no cloud API is called, and the project's `source/` and `work/` are never modified.

```
exports/package.json                    createdAt, file, folder, bytes, sha256 (of the zip), poseJobFinishedAt, imageCount, evalCount, excludedCount
exports/<slug>-training-package.zip     ZIP_STORED (JPEG/binary don't compress), one folder <slug>/:
  images/<img_id>.jpg                   the registered photos only, as COLMAP solved them (work/poses/images: 1600 px, upright)
  sparse/0/{cameras,images,points3D,rigs,frames}.bin   COLMAP's model, byte-for-byte
  manifest.json                         project, pose job (settings, counts, error), cameras, split rule + counts,
                                        per image {colmapImageId, file, imageId, originalFilename, width, height, observations, split, sha256},
                                        excluded (unplaced) photos, trainer versions + presets, file checksums
  README.md setup_env.sh train.sh requirements-nerfstudio.lock.txt   from backend/cloud_training/ ({{NAME}}/{{SLUG}} filled in)
  SHA256SUMS                            `sha256sum -c SHA256SUMS` on the GPU machine
```

`<slug>` = the project name lower-cased, runs of other characters → `-`, ≤ 40 chars (`project` if empty); the name is never used as a path otherwise. One package per project (a rebuild replaces it; built atomically via `.building.zip`). It is `outdated` when the pose job's `finishedAt` differs or the photo set changed.

**Checks** (`GET /training/{id}/package`, about 0.5 s for 175 photos; read from the **shipped** files with our own COLMAP binary reader, not from the summary). Each is `ok`, `warn` or `fail` (any fail refuses the build):

| Check | Rule |
| --- | --- |
| Camera poses | pose job `done` and not outdated |
| One reconstruction | `summary.models` has one group (several → warn: only the largest is exported); the model folder has cameras/images/points3D.bin |
| Intrinsics | camera model in SIMPLE_PINHOLE, PINHOLE, SIMPLE_RADIAL, RADIAL, OPENCV, OPENCV_FISHEYE (a conservative subset of what Nerfstudio reads; our pose job always writes OPENCV), finite params, f > 0, principal point inside the image, one model for all images (Nerfstudio asserts it) |
| Extrinsics | every image: unit quaternion (±1e-6), finite translation, known camera id |
| Sparse points | > 0, finite, every track entry → a registered image and an existing 2D feature, every 2D → 3D reference → an existing point |
| Photos for every pose | each image name is a file in `work/poses/images`, a JPEG of exactly its camera's width × height, and a current project photo; names unique |
| Resolution | longer side ≤ 1600 px: Nerfstudio picks downscale factor 1 itself (above that it **stops to ask interactively**) |
| Frame | model copied byte-for-byte (COLMAP frame and calibration preserved); Nerfstudio's own re-centring is recorded in `dataparser_transforms.json` |
| Held out | Nerfstudio's `--eval-mode interval --eval-interval 8`: images sorted by COLMAP image id, index % 8 == 0 → eval (room1: 22 of 175) |
| Metadata | EXIF/XMP removed losslessly; GPS count reported |
| Photos left out | unregistered photos are not packaged (Nerfstudio's COLMAP loader only reads posed images) |

**Size before export**: photo bytes after metadata removal (exact) + model files + support files + 400 B per manifest image + 120 B per zip entry. room1: estimate 100,417,612 B, actual 100,447,676 B (0.03%).

**Metadata removal** (`strip_jpeg_metadata`): walk the JPEG segments up to SOS and drop APP1 segments starting `Exif\0\0`, `http://ns.adobe.com/xap/1.0/\0` or `http://ns.adobe.com/xmp/extension/\0`; everything else (JFIF, ICC profile, tables, the scan) is copied, so decoded pixels are identical. COLMAP and Nerfstudio don't need EXIF (the calibration is in cameras.bin; the copies are already upright, orientation 1).

**Nerfstudio compatibility** (verified against the v1.1.5 source): `ColmapDataParser` reads `images/` + `--colmap-path sparse/0` (TXT preferred, else BIN), sorts by image id, converts OpenCV → OpenGL camera axes, auto-orients ("up"), centres ("poses") and scales to ±1, undistorts OPENCV images itself (k1, k2, p1, p2 kept), and loads points3D for splatfacto's initialisation. Its own reader read our COLMAP 4.2.1 binary model identically to the text model (175 images, 20,734 points; COLMAP 4's extra `rigs.bin`/`frames.bin` are ignored).

**Pinned environment** (verified 2026-10: PyPI, GitHub releases, ghcr.io, Docker Hub, docs.runpod.io): Nerfstudio 1.1.5 (latest release, 2024-11-11) requires `gsplat==1.4.0`; torch 2.1.2+cu118 (Nerfstudio's recommended install); Python 3.10 (`gsplat-1.4.0+pt21cu118-cp310` prebuilt wheel, GPU code for sm_70/75/80/86/90 — an RTX 4090 (8.9) runs the 8.6 code); `numpy<2` (torch 2.1 is built against NumPy 1). The lock file was resolved with `uv pip compile --exclude-newer 2024-11-12` for `x86_64-manylinux_2_31`: without the date cutoff the loose pins pull e.g. tyro 1.0 / pillow 12 (untested with 1.1.5); with it, tyro 0.8.14, pillow 11.0, rich 13.9, open3d 0.18. Only `pyliblzfse` (C), `fire` and `pycollada` build from source. The lock is closed: re-resolving it with itself as input (same platform, indexes and cutoff) returns the same 238 pins, so `pip check` after the `--no-deps` install must pass (setup_env.sh runs it); all three GPU wheels download (torch 2.1.2+cu118 cp310, torchvision 0.16.2+cu118, gsplat 1.4.0+pt21cu118 cp310 linux_x86_64); no `nvidia-*` packages (the cu118 torch wheel bundles CUDA). Runpod base image `runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04` (template "PyTorch 2.1"; Docker Hub tag active, amd64, 6.76 GB compressed, built 2023-11-08; its history installs `python3.10-dev python3.10-venv` from deadsnakes and links `python3` → 3.10; `cuda-minimal-build-11-8` → `cuda-nvcc-11-8` depends on `build-essential`, so gcc is present; SSH, JupyterLab, `/workspace`); provider-neutral alternative `ghcr.io/nerfstudio-project/nerfstudio:1.1.5` (CUDA 11.8, 5.6 GB, built for arch 61–90).

**Presets** (`train.sh`, same command apart from the length): `ns-train splatfacto --data <pkg> --output-dir /workspace/outputs --experiment-name <slug> --timestamp <preset>-<UTC time> --max-num-iterations N --vis viewer+tensorboard --viewer.quit-on-train-completion True colmap --colmap-path sparse/0 --images-path images --downscale-factor 1 --eval-mode interval --eval-interval 8`, then `ns-export gaussian-splat` (→ `splat.ply`) and `ns-eval --render-output-path` (PSNR/SSIM/LPIPS + one side-by-side PNG per held-out photo, `eval-renders/INDEX.txt` names them). Smoke = 300 iterations (proves training → export → eval → report in minutes before paying for longer runs), quick = 7,000 (the standard early 3DGS checkpoint; splatfacto's LR schedule is fixed at 30k, so it stops mid-schedule), quality = 30,000 (the reference length, default splatfacto: ~6 GB VRAM per the docs). `splatfacto-big` (~12 GB) is the next step if needed. Run id `<preset>-<UTC time>`: Nerfstudio run `outputs/<slug>/splatfacto/<run id>/` (config.yml, dataparser_transforms.json, `nerfstudio_models/step-<N−1, 9 digits>.ckpt`, TensorBoard), result `outputs/<slug>-<run id>/`; runs never share a folder, and `flock` on `outputs/.train.lock` allows one run at a time (GPU memory, viewer port 7007). The result folder adds `config.yml`, `dataparser_transforms.json`, `manifest.json`, `gpu.csv` (nvidia-smi every 5 s), `run.env` and `run.json` (versions, preset, iterations, `status` {train, export, eval}, `problems`, GPU, seconds, peak MiB, Gaussian count from the PLY header, PLY bytes, checkpoint path + bytes, Nerfstudio run folder, held-out count, `evalSplitMatchesManifest`, eval metrics, package provenance).

**Failure handling** (`train.sh`, `set -uo pipefail` without `-e`): each step's state goes to `run.env` (KEY=value, later lines win). Train = `ok` (exit 0 and the highest-step checkpoint, chosen by parsed step number, is exactly `printf 'step-%09d.ckpt' N−1`), `incomplete` (a checkpoint exists, e.g. OOM after 2,000 steps: it is still exported and evaluated) or `failed` (no checkpoint: no export/eval). Export/eval = `ok`/`failed`; a failure never touches the checkpoint or an already written PLY. Every `run.json` field is optional (a missing file → null + a line in `problems`). `bash train.sh finish <result folder>` re-reads `run.env` and repeats only the steps that aren't `ok`. Exit 0 only when all three are `ok`. `eval-renders/INDEX.txt` is built from the **run's own** `config.yml` (yaml-load → `pipeline.datamanager.dataparser`, with `.data` set from `datamanager.data`, since the dataparser's own field is empty → `get_dataparser_outputs("test")`), i.e. exactly the list ns-eval renders, and compared with the manifest.

**Verified against Nerfstudio 1.1.5** (source + pinned install on macOS/Python 3.10 with `BUILD_NO_CUDA=1`): `ColmapDataParser` orders frames by `sorted(im_id_to_image)` (COLMAP image id), `get_train_eval_split_interval` holds out `index % 8 == 0`, `train_list.txt`/`test_list.txt` in the data folder would override it (the package ships none); `FullImageDatamanager.fixed_indices_eval_dataloader` iterates the eval dataset in that order and `get_average_image_metrics` saves `eval_{key}_{idx:04d}.png` with splatfacto's single key `img` (= `cat([gt, render], dim=1)`, gt undistorted to 1199×1599). Running the real dataparser + datamanager on room1's package: 153/22, eval list and render order identical to the manifest (`eval_img_0000` = img_01dd9fa9adfa.jpg … `eval_img_0021` = img_e35a811eaa45.jpg). The exact `ns-train` command parses and writes `config.yml` to the expected path (fails only at the first `.cuda()`); `ns-export gaussian-splat` requires `--load-config` and `--output-dir`, writes `--output-filename` (default `splat.ply`), drops non-finite and opacity < 1/255 Gaussians (PLY count ≤ trained count); `ns-eval --load-config --output-path --render-output-path`; `dataparser_transforms.json` is written to the run folder at the start of `train()`; the trainer always saves a checkpoint in `_after_train`, `save_only_latest_checkpoint=True` keeps one; splatfacto logs a comparison image to TensorBoard every 100 steps.

**Storage** (estimates; measured: torch cu118 wheel 2.33 GB → 4.17 GB installed, open3d 1.11 GB, an eval render PNG 1–2.6 MB): venv ≈ 7 GB; checkpoint ≈ 0.7 GB per million Gaussians (59 floats + 2 Adam moments each; two exist briefly while saving); PLY ≈ 0.25 GB/M; TensorBoard ≈ 0.15 GB quick / 0.6 GB quality; eval renders ≈ 0.05 GB. Setup + smoke + quick (≤ 1 M) + quality (≤ 3 M) ≈ 16 GB worst case → **30 GB volume** (encrypted) suffices; the **20 GB container disk** only holds temporary wheels (`PIP_NO_CACHE_DIR=1`; ≤ 4 GB peak); `TORCH_HOME` (LPIPS weights) points to the volume.

**Estimates** (not measurements, stated as such in the README): setup 5–10 min; smoke 2–5 min; quick 3–8 min (4090) / 5–12 min (3090); quality 15–35 / 25–50 min; 4–10 GB VRAM; 0.3–2 M Gaussians; PLY ≈ 250 MB per million (62 float properties incl. nx/ny/nz and SH degree 3). Runpod prices (pricing page, 2026-10): RTX 4090 $0.34/h Community, $0.74/h Secure; RTX 3090 $0.22/$0.50; disks $0.10/GB/month while the Pod exists, stopped volumes $0.20/GB/month until terminated. Pod settings: Secure Cloud, 1 × RTX 4090/3090, container disk 20 GB, volume 30 GB at `/workspace` with **Encrypt volume**, no network volume, HTTP ports 8888 + 7007; never *Edit Pod* while running (it resets everything outside `/workspace`).

### 5.12 XGRIDS raw recording (`.xbin`, Labs 13P–13R)

The LixelKity K1 writes its raw sensors to one `.xbin` file (Basel House: 13,929,066,496 bytes, starts with `XBAG`). Reverse-engineered from **one** recording (software V3.1.1_20250826), **provisional**, and not proven for other firmware versions or recordings. The full write-up, with a table of what is verified and what is provisional, the corrections and a checklist for new recordings, is `docs/xgrids/xbag-format.md`; the history is in `docs/xgrids/investigation-log.md`. In short:

- **Records**: a 48-byte little-endian header `u32 record length (= payload + 52), u16 1, u16 36, u64 write time µs, u32 payload length, u32 message count, u64 first ts µs, u64 last ts µs, u32 channel, u32 payload length`, then the payload, then 4 unexplained bytes. Channels seen: 1 (2,432 records), 3 (4,852), 14 and 18 (1,459 each, the two cameras), 0 and 21 (1 each). Only the camera channels are decoded.
- **Camera messages** (protobuf, 5 per record, filling the payload exactly): `0a L { 0a n {08 seq, 10 zigzag ts µs, 18 20000}, 10 3, 18 4000, 20 3000, 2a m <H.264 Annex B: SPS 00 00 00 01 67 64 10 3c, PPS, SEI, IDR>, 32 7 {…} }`. Sequence 0 has no `08` field (proto3 default).
- **Basel House**: 14,590 images = 7,295 synchronised pairs (sequence 0–7294 on both channels, channel 18 always first, Δt median 17 µs, max 213 µs), 4000 × 3000, 292–716 KB each, every 0.3 s (≈ 3.0 Hz, longest gap 1.4 s) from 10:10:16.490409 to 10:50:52.990955 UTC. Poses start 17.6 s later: 106 frames precede the first pose, 14,484 lie inside the pose range (nearest pose ≤ 50 ms).

`scripts/xgrids/index_xbin.py <file.xbin>` (standard library only, independent of the app) reads the file read-only in 16 MiB chunks (0.66 GB/s, 22 s for 13.9 GB) and writes `<xbin folder>/reconstruction/xgrids/metadata/frames.csv` (sequence, `timestamp_us` as exact integers, UTC, SPS offset, camera stream, pair status/id/Δt, message offset, declared H.264 length, size, stream evidence) and `index-summary.json` (counts, rejections, batches per channel, rates, pose coverage). Rules: frames are found by the SPS signature (heuristic), the metadata must decode exactly (fields 1–5 in a message whose field 5 starts at the SPS, a single field 6 after the image, plausible values) and only one message start may fit, otherwise the candidate is rejected with a reason; the camera stream is the record's channel only when its header matches its frames exactly; pairs need equal sequence, |Δt| ≤ 5 ms, different streams, and exactly one candidate. Images are neither extracted nor decoded.

**Selective extraction** (`scripts/xgrids/extract_frames.py <file.xbin>`, Lab 13Q). It reads `frames.csv`; no rescan.
- **Selection:** complete `ch14` + `ch18` pairs only.
- **Pose range:** events outside the `poses.csv` time range are excluded and reported separately (Basel: sequences 0–52, 53 events). So are events whose bracketing pose samples are more than 200 ms apart.
- **Sampling:** `--interval 10` takes the first event at or after each 10 s grid time. Alternatives are `--validation` (first, middle and last eligible event) and `--sequences`.
- **Decoding, per image:**
  1. Re-decode the metadata with the indexer's `decode_frame` and compare it with the CSV.
  2. `os.pread` exactly `h264_bytes` from `sps_offset`. Each payload is a self-contained SPS + PPS + 2 SEI + IDR picture.
  3. Run `ffmpeg -loglevel warning -f h264 -i pipe:0 -frames:v 1 -c:v mjpeg -q:v <quality>` to a `.partial` file, then rename it.
  4. Check the JPEG's SOI/EOI markers and that its SOF size equals the declared size; record its SHA-256.
- **Scanner pose per image:** XYZ interpolated linearly between the two bracketing poses, and the quaternion by SLERP. The quaternion order is xyzw, the angle is computed with atan2, and the result is exact down to 10⁻⁶ rad. This is the **scanner** pose; the camera extrinsics are unknown and the manifest says so (`docs/xgrids/calibration-notes.md`).
- **Output:** `<xbin folder>/reconstruction/xgrids/images/<run>/` holds:
  - `seq<NNNNN>_<ch14|ch18>_t<µs>.jpg`;
  - `manifest.csv`: image, sequence, timestamp, channel, offsets, NAL types, decoder status, JPEG size and SHA-256, pose bracket, `scanner_*`, `camera_extrinsics=unknown`;
  - `extraction-summary.json`.
- **Safety:** an `--out` inside the repository (except the ignored `reconstruction/`) is refused.
- **Basel, one pair every 10 s:** 242 events = 484 images at 4000 × 3000, all `ok`, 92 s, 452 MB.

**Inspection in the app** (`/camera-calibration`, Lab 13R; full notes in `docs/xgrids/calibration-workspace.md`). The backend serves runs from `SPATIAL_LAB_XGRIDS_DIR` (never from `public/`). Only files listed in a run's manifest and located inside that run's folder are served, and responses carry file names and hashes, never absolute paths. The page places a run's `scanner_*` positions in the scene only when the run's `source.posesSha256` equals the SHA-256 of the selected dataset's `poses.csv` (same pose file, so same LAS frame). It then uses the usual chain: dataset = LAS − offset, inside the LiDAR group. As an independent cross-check it interpolates the dataset's own poses at the image time (Basel: ≤ 0.002 mm). Camera intrinsics and extrinsics stay `unknown` (`lib/calibration.ts`).

The provisional camera-to-scanner offsets (Lab 13S) are applied in the scanner body frame (X forward, Y left, Z up, checked against motion and gravity), without a lever arm:
- yaw about Z, + = right, so −90° = left;
- then pitch about the new Y, + = up;
- then roll about the viewing axis, + = clockwise seen from behind.

This is `Euler(roll, −pitch, −yaw, "ZYX")`. The offsets are never used as camera poses; presets and notes are stored only in the browser.

**Lab 13S result (Basel):** ch14 looks left (yaw −90°) and ch18 looks right (yaw +100°, ±10°); both are level with roll 0°. This is a direction-only hypothesis test; the method and caveats are in `docs/xgrids/calibration-workspace.md`.

**Correspondences (Lab 13U; `docs/xgrids/correspondences.md`).** Image pixels are stored in original coordinates (OpenCV: u right, v down, (0, 0) = centre of the top-left pixel, image spans [−0.5, W − 0.5]); the viewer maps `screen = (pixel + 0.5)·scale + t`. LiDAR picks are made on dataset coordinates and stored as LAS: `LAS = dataset + coordinateCenter`, computed in float64; viewer or dataset coordinates are never saved. The provisional camera frame is X = optical axis, Y = image left, Z = image up, `v_body = R_off · v_cam`, camera at the scanner position (lever arm unknown). The diagnostic projection is an **assumed** equidistant fisheye: `u = cx + f·θ·(−y/s)`, `v = cy + f·θ·(−z/s)`, defaults f 750 px/rad, (1999.5, 1449.5), usable radius 1400 px. Points outside it have no pixel and no error.

**Calibration experiments (Lab 13V; `docs/xgrids/calibration-experiments.md`).** `backend/camera_calibration.py` fits, per camera and with the conventions above (`R_las_camera = R(q) · R_off`, camera at the scanner position), first the rotation (Stage A, lens fixed) and then the rotation plus f (Stage B, cx/cy fixed). It uses `scipy.optimize.least_squares` (trf, bounded, soft-L1, 20 px scale) and validates by leaving one capture event out; the recommended set has the lowest held-out median. Inputs are Lab 13U exports, read only and identified by SHA-256; results are `spatial-lab/xgrids-calibration-experiment` v1 files outside Git. **Basel (experimental):**
- f ≈ 927 (ch14) and 955 (ch18) px/rad instead of the assumed 750.
- Held-out median errors 80 → 28 px (ch14) and 66 → 35 px (ch18).
- Rotations: ch14 (−88.3°, 3.0°, −1.3°), ch18 (89.4°, 4.0°, 0.6°).
- Better photo–LiDAR agreement on 42 of 48 photos not used for fitting.
- Principal point, lever arm and distortion stay unknown.

Nothing in the app applies these values automatically. Hardware reference photographs (Livox MID-360 with two opposing wide-angle modules) support the ≈ ±90° directions and show that the lens centres are displaced from the pose reference point: the zero lever arm is temporary and a measured or estimated camera-to-scanner translation is still required (`docs/xgrids/calibration-notes.md`). The photos are not calibration measurements.

**Correspondence review (Lab 13W).** Records may carry `excludedFromFit`, `reviewStatus`, `scene` and `history`, all optional, so the schema stays v1. Review errors use a named reference: a loaded experiment's Stage B, else the latest experimental baseline for the Basel export. Image regions are thirds of the usable radius. "Reliable" means in fits with no warning; only reliable matches count towards the 15–25 per-camera target. Refitting without #1, #5 and #16 moved ch14's Stage B by under 1 σ and shrank its roll and f uncertainty about 3×. Held-out error and the photo check did not improve. The expanded dataset is not complete until the user supplies new hand-verified matches.

**Latest experimental baseline (2026-10-15).** The user's reviewed export kept the ids of corrected matches, deleted #11, added one match and re-picked others. Stage B on it (experiment `x_c69aede71834`) gives:
- ch14 (−88.95°, 2.89°, 0.37°), f 961 ± 8;
- ch18 (89.44°, 4.33°, 0.77°), f 962 ± 10;
- held-out medians of 18 and 16 px, against 28 and 35 px for 13V;
- parameter shifts under 1 σ, and an unchanged photo check.

`experiments/baseline-latest-2026-10-15.json`, outside the repo, points to it, and 13V's files are kept. The flag for a record on the Lab 13V list clears once the record has a pixel or LiDAR correction in its history. The dataset is still not complete.

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
- Three views per dataset (`CameraFraming`), all via `computeViewOfBox(box)` with the target at the box centre in world space (so orbiting pivots on what is framed): **initial** (Reset View) = the scan-area view if the dataset has a `scanArea`, otherwise the useful-bounds view; **scanArea** (Focus on Scan Area, button shown only when defined); **entire** (Frame Entire Cloud) = `originalBounds` − offset, or the min/max of the loaded points. Basel: scan-area target (5.190, −32.467, 2.984), entire target (0, 0, 0) at distance ≈ 322.
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

### 6.9 Embedding the official SuperSplat Viewer (Lab 8)

`components/splat/SplatViewer.tsx` uses the package's documented in-page API, not its internals:

```ts
const { createViewer } = await import("@playcanvas/supersplat-viewer/viewer");   // client only
import "@playcanvas/supersplat-viewer/viewer.css";
const viewer = await createViewer({
  container,                 // a sized <div> (position: fixed; inset: 0); the viewer builds canvas + UI inside
  contentUrl,                // http://127.0.0.1:8000/splats/<id>/files/<entry>; format chosen by the file name
  settings: { ...defaultSettings("object"), cameras: [{ initial: startCamera }] },
  noanim: true,              // otherwise it starts with its own camera animation
  ministats,                 // optional engine CPU/GPU graphs (a creation option → recreates the viewer)
});
viewer.events.on("progress:changed", …); viewer.events.on("loaded:changed", …);   // loading indicator
state.cameraMode = "orbit";  // once loaded: orbit + zoom around the start view's target
viewer.resetCamera();        // back to settings.cameras[0].initial
viewer.destroy();            // engine app, GPU device/context, listeners, DOM
```

- **Isolation:** its own route with no `<Canvas>` from React Three Fiber; the viewer owns a separate canvas, PlayCanvas `AppBase` and WebGPU device (WebGL 2 fallback). Nothing is shared with three.js, so there are no renderer conflicts.
- **Lifecycle:** one viewer per scene. The effect depends on the content URL, a JSON key of the start camera and `ministats`; cleanup calls `destroy()`, and a viewer that finishes creating after cleanup is destroyed immediately. Browsers cap live WebGL contexts at ~16, so leaking instances eventually breaks rendering.
- **Errors:** the viewer has no public load-error event (it rejects internally and logs). The page fetches one byte of the scene first (`Range: bytes=0-0`) and listens to `viewer.app.assets.on("error")`, which also covers LOD chunks streamed later.
- **Performance figures:** every 500 ms from `viewer.app.stats.frame` (`fps`, `ms`, `gsplats` = splats submitted) and `app.stats.vram` (`tex + vb + ib + ub + sb`), plus `graphicsDevice.isWebGPU`. The viewer renders on demand, so fps falls towards 0 while nothing moves.
- **Built-in UI kept:** orbit/fly mode buttons, controls help (H), settings, fullscreen, frame (F), reset (R); our panel only adds what the viewer doesn't show (format, splat count, sizes, license, organisation).

**For direct R3F interaction later** (overlaying LiDAR, annotations, measurements in one scene) the embed must be replaced, because two engines can't share a depth buffer or camera: either (a) render splats inside three.js (e.g. a three.js splat renderer, or a custom one growing out of Labs 6/7B: GPU projection, GPU sort, SH colour) so R3F owns one canvas and camera; or (b) keep PlayCanvas and draw the other content in it via `viewer.app` (its scene graph), syncing the camera to React state through `events`. Either way a registration transform between the splat frame and the LiDAR frame (catalog `alignment`) is needed first; until then overlays would be visually "hacked" alignment, which section 2 forbids.

### 6.10 Inspecting one trained Gaussian (Lab 9)

The preview reuses Lab 6 unchanged: `covariance3D`, `projectGaussian`, `ProjectedGaussianQuad` (+ its shader), `CameraReset` and the start camera (0, 0, 6), fov 50, `<Canvas linear flat>`. Only one optional prop was added to the quad: `colorForCamera(cameraPosition, target)`, called every frame instead of copying `gaussian.color` (Labs 6/7B don't pass it).

- **Frame:** shown upright as in the Gaussian viewer: file `(x, y, z)` → preview `(−x, −y, z)`, i.e. `rotation = Rz(180°) · q_file`. A rotation, so the shape is unchanged (test: preview Σ3D = F Σ_file Fᵀ to 10⁻¹⁵).
- **Centre and size:** the Gaussian sits at the preview origin (its real position is shown in the panel). Trained Gaussians are mm–cm, below Lab 6's `MIN_DEPTH` (0.2) at a sensible viewing distance, so the preview is **magnified uniformly** so the original's largest σ is 0.6 units (Lab 6's default size). Scaling the Gaussian and the camera distance together leaves Σ2D unchanged (test: identical to 10⁻¹⁵), so the panel reports real distances (`depth / magnification`). The magnification is fixed per Gaussian (from the stored scales), so scale edits visibly grow/shrink it.
- **Edits** (`GaussianEdits`): stored log σ per axis (slider ±3 around the stored value), Euler XYZ degrees from the stored quaternion (round trip exact to 10⁻¹⁶), decoded opacity, base colour (colour picker; shown as f_dc), SH degree used (0..stored). "Reset Gaussian" restores the decoded record; edits never leave the page.
- **View-dependent colour:** per frame, `dir` = camera → origin in preview space, mapped back to the file frame (`(−x, −y, z)`), `shColor(f_dc from edited base colour, stored f_rest, dir, degree)`. The colour values are used as is (display values, like the viewer); the `linear` canvas writes them unchanged, so a screenshot pixel equals `colour·α + background·(1 − α)` (background `#1a1a1a` → 0.0103 after three's sRGB→linear conversion of `<color>`).
- **Overlays:** the 1σ wireframe ellipsoid with the Gaussian's own axes (`axesHelper` inside the scaled/rotated group: red = scale_0, green = scale_1, blue = scale_2) and a drei `GizmoHelper` for the preview's X/Y/Z.

## 7. Lab-by-lab build specification

Each lab lists requirements and acceptance criteria. Build them in order.

### Lab 1 — Point cloud viewer

Requirements: full-screen R3F canvas, dark neutral background; load `.bin`; `BufferGeometry` with `position` + `color` attributes; `<points>` + `pointsMaterial` with vertex colours; `OrbitControls`; small HTML panel with point count, point-size slider, RGB toggle, axes toggle, grid toggle. Components: `SpatialScene`, `PointCloud`, `Controls`. Loading/error message if the file is missing. No fake data.

Accept: real scan renders; count matches file; all toggles work; missing file shows a clear error.

### Lab 1b — Point budgets and performance

Requirements: `<Perf position="top-right" />` inside the canvas; "Point Budget" selector 500K | 1M | 2M (| 5M since Lab 7C); show selected budget, actual loaded count, point size; loading message; only one dataset in memory (clear old data before fetching new; abort in-flight fetch on switch with `AbortController`); camera must not reset when switching.

Accept: switching budgets keeps the exact same view (pixel-identical after a round trip); the scan's dense-region centre is identical across budgets (within mm).

### Lab 2 — Scanner trajectory

Requirements: inspect `poses.csv` and validate column meaning from values (section 5.3); parse; subtract the same offset as the point cloud (now the dataset's `offset`, section 5.4); render inside the LiDAR group as a `THREE.Line` (via `<primitive>`, because JSX `<line>` is the SVG element) plus subtle `<points>` markers sharing one geometry; toggles "Show scanner path", "Show pose points"; display pose count. No orientation yet, no animation. If misaligned, report — don't adjust.

Accept: path lies inside the scanned space at plausible scanner height.

Later additions (Basel.2): the path line and a green start sphere (first pose, 0.25 m) are drawn **on top** of the cloud (`depthTest: false`, transparent pass, `renderOrder` 10), because interior paths are otherwise hidden behind walls and roofs; per-pose dots are skipped above `MAX_POSE_POINTS` (2,000) and the checkbox says so.

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
- Frontend: built-in dataset (`BUILTIN_DATASET`, served from `public/data`, works without the backend) + backend datasets in one list; collapsible "Datasets" section (renamed "Properties" and reorganised in Lab 7C) (`<details>`): select (status in the option label), metadata (original points, size, offset with full precision in the tooltip, budgets, poses count + status, source file, attachments, import date), progress bar, "Import dataset…" form (see the importer below), "Delete" with `window.confirm`. Global `WORLD_OFFSET` and `pointBudgets.ts` removed.
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

### Lab 7C — 5M budget + Properties and Captures

Requirements (5M budget):

- `BUDGETS` gains `("5m", "5M", 5_000_000)`; budgets per section 5.4 (never duplicate points: smaller clouds get "All (N)"). Built-in: `public/data/pointcloud-5m.bin` from `source-data/map.las` (same offset, printed by the CLI) and a 5M entry in `BUILTIN_DATASET.budgets`; `pickBudget` knows `5m`.
- Existing imported datasets get the new budget by the startup backfill (section 5.4), without re-upload; the other budgets stay usable meanwhile; the page also polls while a `budgetJob` is queued/running.
- Panel: "Loaded points: N" plus "Loaded 75.0 MB in 0.3 s"; loading errors read "Couldn't load the 5M budget: … Try a smaller budget."; the old cloud is still dropped before the new one loads (one cloud in memory; GPU buffers disposed by `<PointCloud>`); the camera doesn't move on budget changes.

Requirements (Properties → Captures, section 5.6):

- Backend endpoints: `GET /catalog`; `POST /properties`, `PATCH`/`DELETE /properties/{id}`; `POST /properties/{id}/captures`, `PATCH`/`DELETE /captures/{id}`; `POST /captures/{id}/datasets` `{datasetId}` (moves it from another capture), `DELETE /captures/{id}/datasets/{datasetId}`. Every change returns the whole catalog. Names: whitespace collapsed, 1–80 characters. Ids regex-checked; dataset ids must exist (or be `builtin-map`). CORS allows `PATCH`.
- Panel ("Properties", `<details>`): Property picker ("Unassigned datasets (N)" + properties with capture counts) with New / Rename / Delete; Capture picker (with dataset counts) with Add / Rename / Delete; Dataset picker (the capture's datasets, or the unassigned ones); "Add a dataset to this capture…" select (other captures' datasets labelled "(moves from …)"); metadata; buttons Import… / Unassign (catalog only) / Delete files (permanent). Names via `window.prompt`; deletes via `window.confirm` that say exactly what happens to files ("No files are deleted: its N dataset(s) stay available under Unassigned datasets" vs "files will be permanently removed … removed from capture X"). Choosing a property/capture views its first dataset. The import form offers "Add to capture "X"" (checked) when a capture is selected. Note under a capture: each capture keeps its own coordinate frame.
- Graceful degradation: backend offline → only the built-in dataset, catalog buttons disabled; backend reachable but older (no `/catalog`) → datasets work, catalog buttons disabled with "restart it to organise datasets".

Accept:

1. Built-in: buttons 500K | 1M | 2M | 5M; 5M loads 5,000,000 points; 500K → 5M → 500K after an orbit: 0% image diff; live scene-canvas buffer bytes return to the 500K value (7.5 MB → 75 MB → 7.5 MB).
2. Backfill on copies of real datasets: a 14.7M-point dataset gains 5M; a 4.2M one gains "All (4.2M)"; existing budget files unchanged (checksums); new files byte-identical to a fresh conversion with the stored offset; a tampered offset → job failed, no file.
3. Fresh import of map.las → 500K/1M/2M/5M byte-identical to `public/data`.
4. Without `catalog.json`: every dataset under "Unassigned"; create property + captures, assign, move, rename, unassign, delete capture/property (datasets remain, files untouched), import into a capture, delete a dataset in a capture (reference removed). API error cases return 400/404 with messages.
5. No TypeScript, pyflakes or console errors (except deliberately blocked requests in the offline test).

Limitations to state: captures are not aligned or merged (one capture viewed at a time; `alignment`/`frame` reserved); only LiDAR representations exist; a dataset belongs to at most one capture; the backfill holds the whole LAS in memory like a conversion; renaming uses browser prompts; no multi-user or cloud storage.

### Lab 8 — Real Gaussian splat viewer

Requirements:

- Route `/gaussian-viewer` (linked from the LiDAR panel), the official SuperSplat Viewer embedded per section 6.9; the LiDAR viewer and Labs 6/7B unchanged.
- Backend: `GET /splats`, `GET /splats/{id}`, `POST /splats` (multipart: `name` + one `files` part for .ply/.compressed.ply/.sog/.zip, or several `files` + matching `paths` for a folder), `DELETE /splats/{id}` (also drops the catalog reference), `GET /splats/{id}/files/{path}` (whitelist). Validation, storage and extraction per section 5.7, done during the upload request (in a thread); failed imports leave no folder.
- Catalog: representations of kind `"gaussian-splat"` (ids `spl_…`) next to `"lidar"`; `POST /captures/{id}/datasets` accepts splat ids; the LiDAR panel counts them ("October capture (0 datasets, 1 splat)") and its delete confirmations say splats become standalone. Scenes are **standalone** unless the user assigns them; nothing assumes a downloaded scene belongs to a LiDAR capture, and nothing is aligned.
- Panel: scene picker grouped "Standalone scenes" / "Property › Capture"; format, splats (+ SH bands, LOD levels), scene file size and file count, source (file/folder/zip + name + size), conversion note, frame note, core extent, warnings, license; loading % with progress bar, "Loaded in N s", errors; Reset camera; Start view Inside / Outside (default from `centralFraction`, switching recreates the viewer); performance (renderer, fps, ms per frame, splats drawn, GPU memory, optional ministats graphs); capture select; "Delete scene files" with a confirm; import form (Choose file… / Choose folder…, client pre-check, editable name, upload %, server message).

Accept (verified with the Ceramic Studio sample in three forms, plus a 3.7M-splat apartment as .sog and as an 874 MB .ply):

1. Every import route succeeds with the right format, count (999,986 / 3,701,324), SH bands 3 and license; folder upload strips the browser's top folder and ignores `.DS_Store`/`index.html`.
2. Error imports give the messages in section 5.7; incomplete package names the missing file; no folders left behind. File endpoint: manifest files 200 (range requests 206), `license.txt` / `original.zip` / `metadata.json` / `../` → 404.
3. Ceramic Studio loads completely (all 999,986 splats drawn, WebGPU, ~1–3 s for SOG LOD, ~12–19 s for the 236 MB PLY); starts inside the studio, upright, natural colours; drag orbits (image changes), wheel zooms, Reset camera → 0.0% image diff to the start view.
4. Switching scenes 6× (WebGPU): one canvas; every previous GPU device destroyed; GPU memory follows the scene (111 → 172 → 386 → 111 MB). 20× on WebGL 2 (navigator.gpu hidden): 20 contexts created, 1 live, still rendering.
5. Capture assign / standalone round trip; delete via the UI removes the folder; backend offline → clear message; `/`, `/gaussian-projection`, `/gaussian-compositing` load; `tsc`, `next build`, pyflakes clean; no console errors except the deliberate 400s of error imports; production build checked in the browser.

Limitations to state: viewing only (no training, editing, deformation effects); authored SuperSplat cameras/annotations (`settings.json`) aren't imported, the start view is computed; the inside/outside default is a heuristic; splat frames are not aligned with LiDAR and units are unknown; `.splat/.ksplat/.spz` need a manual SplatTransform step; imports are synchronous (a big PLY is validated and measured in seconds, but the request waits); the official viewer's own UI and keyboard shortcuts are active on this page.

### Lab 9 — Inspect real Gaussian attributes

Requirements:

- Route `/gaussian-inspector` (linked from the LiDAR panel and Lab 8), its own `<Canvas>` per section 6.10; all other pages unchanged.
- Backend (read-only, section 5.8): `GET /splats/{id}/gaussians?indices=…` (≤ 64), `GET /splats/{id}/gaussians/sample?seed=&count=` (≤ 64, seed 0..2⁶³−1), `GET /splats/{id}/gaussians/summary?seed=` (20,000 sampled). 400 with a message for out-of-range or malformed indices, bad seeds/counts, compressed PLY and SOG scenes; 404 for unknown scenes.
- Panel: scene select (only `ply` scenes enabled; others listed as "not inspectable"); "How one Gaussian is stored" (record size, offset formula, property order, f_rest layout); index box + ◀ Show ▶; seed + "Random sample" (12 Gaussians, swatch, largest σ, α); stored → decoded table (position, 3 scales with e^v, quaternion with |q|, logit → sigmoid, f_dc → base colour, SH count/degree/size) with validity checks; "Why the stored numbers look odd"; experiments (scale, rotation, opacity, base colour, SH degree segmented control with the colour seen from the current view and the view direction), Reset Gaussian; display (support, outline, ellipsoid + own axes); Σ3D (mm²), Σ2D (px²), real camera distance, σ major/minor, angle, magnification note; scene statistics (5% / median / 95% of σ, anisotropy, opacity, SH size; validity; 1/255-quantisation note). Short plain-language notes beside each group.
- Opens the first PLY scene with seed 42 and shows the first sampled Gaussian; each new Gaussian resets the camera.

Accept (Ceramic Studio PLY, 999,986 Gaussians):

1. Decoding: summary valid (0 non-finite, 0 zero quaternions); PLY ↔ SOG cross-check per section 5.8; SH basis orthonormal (16 functions, error 1.5·10⁻⁷); degree 0 = base colour exactly.
2. Projection: unchanged by magnification (10⁻¹⁵); Lab 6's Σ2D matches a Monte Carlo projection of 20 real Gaussians within 2.1% at 8× the start distance (the linearised Jacobian is off by up to ~6% when the Gaussian is ~10% of the camera distance, as in Lab 6 and the reference renderer).
3. Browser: centre pixel = predicted `colour·α + background·(1 − α)` exactly (α 0.02 → (6, 7, 7); α 0.9 → (126, 139, 146); after an orbit (128, 141, 147), i.e. the SH colour changes with the view); orbit changes Σ2D; Base only shows the base colour; editing changes Σ3D and enables Reset Gaussian, which restores it exactly; ◀ ▶ and index 0 work; index 999,986 → "Choose an index from 0 to 999,985."; seed 7 twice → same 12, seed 8 → different; SOG option disabled.
4. `/`, `/gaussian-projection`, `/gaussian-compositing`, `/gaussian-viewer` load; `tsc`, `next build`, pyflakes clean; no console errors.

Limitations to state: inspection and preview only (no editing or saving of the reconstruction); PLY only (compressed PLY and SOG are quantised); one Gaussian at a time, without its neighbours; Euler sliders (gimbal lock near ±90° Y, the quaternion is exact); the preview is magnified (stated in the panel); this Ceramic PLY is itself a quantised export, so its values are SuperSplat's 8-bit-rounded ones, not the original training output.

### Lab 10A — Prepare photographs for Gaussian training

Requirements:

- Route `/gaussian-training` (linked from the LiDAR panel), panel + thumbnail grid, no 3D; all other pages unchanged.
- Backend (section 5.9): `GET /training/environment` (declared before `/training/{id}`), `GET/POST /training` (name 1–80 chars → 201), `GET/DELETE /training/{id}` (204), `POST /training/{id}/images` (multipart `files`, per-file accept/refuse → `{accepted, rejected, project}`), `DELETE /training/{id}/images/{imageId}`, `DELETE /training/{id}/rejected`, `GET /training/{id}/images/{imageId}/thumbnail` (whitelisted ids, `image/jpeg`). Unknown/malformed ids → 404; originals are never served.
- Panel: project picker + "New project name"/Create; facts (photo count, total size, sizes with counts, cameras, "Linked to a property/capture: not yet (reserved)"), Delete project (confirm); "Choose photos…" (multiple) and "Choose folder…" (hidden files skipped, non-JPG/PNG listed as skipped), byte progress bar (XHR, batches of 8), last upload result; Checks (count per warning kind with a plain explanation, "Show only photos with warnings", the overlap/coverage disclaimer); "Unreadable or unsupported files" with reasons and Clear; Training stages (planned badges, "None of these has run"); Training environment (collapsible facts + verdict + notes).
- Grid: thumbnail, filename, W×H, size, format, warnings (explanation as tooltip), notes, Remove (confirm).
- Firestore or any cloud store is not used for images or Gaussian files; associations with a property/capture are reserved fields only.

Accept (fixtures: crops of real renders + generated variants; not committed):

1. 18 files → 14 added, 4 refused with reasons (`.txt` unsupported, text named `.heic` and random bytes named `.jpg` unreadable, truncated JPEG corrupt); HEIC (made with `sips -s format heic`): accepted, orientation-6 photo 3024×4032 with a portrait thumbnail, camera facts read, a truncated HEIC refused as corrupt, HEIC named `.jpg` / JPEG named `.heic` accepted with a note, HEIC vs its JPEG = near-duplicate (0/64 bits); a JPEG named `.png` accepted as JPEG with a note; 65 MB → "larger than 64 MiB"; 132 MP PNG → "larger than 120 megapixels".
2. Checks: the blurred copy (sharpness 1) flagged blurry; the byte copy flagged duplicate; re-encoded/resized/blurred copies flagged near-duplicate (0/64 bits); crops < 1000 px flagged low resolution, 320×281 very low; 4032×3024 vs 980×860 flagged as different size; an EXIF-orientation-6 photo reported 3024×4032. Re-uploading the same folder flags all 14 copies as duplicates (exact wins over near).
3. Removing a photo updates counts and warnings; files on disk match the project (`source/`, `thumbs/`, no leftover `.incoming-*`); deleting the project removes its folder.
4. Thumbnails load from the API; the warnings filter, Clear, environment and stages render; `/`, `/gaussian-projection`, `/gaussian-compositing`, `/gaussian-viewer`, `/gaussian-inspector` load; `tsc`, `next build`, pyflakes clean; no console errors.

Limitations to state: preparation only (no pose estimation, training or export yet); the checks judge photos one at a time and say nothing about overlap or coverage; blur is a heuristic (textureless surfaces look blurry); RAW and video are not imported (export JPG or extract frames first); HEIC is tested with `sips`-made files, not yet with 10-bit HDR iPhone photos (pillow-heif converts those to 8 bit); uploads are synchronous per batch; no link to a property/capture yet (reserved).

### Lab 10B (step 1) — Camera pose estimation

Requirements:

- Prerequisite: COLMAP installed (Homebrew on macOS) and the backend restarted. Nothing else is installed or downloaded (no vocabulary tree, no model weights).
- Backend (section 5.10): `POST /training/{id}/poses` (202; 400 without COLMAP, < 3 photos or low disk; 409 if running), `POST /training/{id}/poses/cancel` (409 if nothing runs), `GET /training/{id}/poses/preview` (404 until done). The project view gains `poses` (job + `outdated`) and stage statuses. Uploads, removal and deletion → 409 while running.
- Panel "Camera poses (Lab 10B, step 1)": Estimate camera poses / Run again (disabled without COLMAP or with < 3 photos, with the reason); while running: stage text, %, progress bar, Cancel, "adding or removing photos is paused"; failed: error + last log lines; done: placed X of N (%), points + mean track length, reprojection error, lens, time per step, plain-language explanation, separate-groups warning, "N not placed" with the list and "Show only photos not placed", "Show cameras in 3D" / "Show photos"; outdated notice. Photo cards: "Placed · N points" / "Not placed by COLMAP" / "Added after poses were estimated".
- 3D view replaces the grid (fetched once per finished job, `next/dynamic` without SSR): points + frustums, info box (cameras, points, unplaced count, the display-frame disclaimer), Reset view, click a camera → its thumbnail, matched points, "Look through this camera".

Accept (real 192-photo room set copied to a test store):

1. Job: start → 202, second start → 409, removal while running → 409, cancel in preprocessing and in feature extraction → `cancelled`, no COLMAP process left after 1.5 s; full run ~4 min with progress through every step; summary per section 5.10; removing a photo afterwards → `outdated`.
2. Page: outdated notice and badges `done`/`outdated` on load; Run again disables uploads and Remove; progress text advances; result 174 of 191 placed, 0.942 px, 17 unplaced cards and filter = 17; 3D view shows 174 frustums inside the room's points; a clicked camera (IMG_8178) shows its photo and looking through it lines the chest and cabinet points up with the photo.
3. `/`, `/gaussian-projection`, `/gaussian-compositing`, `/gaussian-viewer`, `/gaussian-inspector` load; `tsc`, `next build`, pyflakes clean; no console errors.

Limitations to state: poses only (training: Lab 10C); CPU only on macOS (no CUDA SIFT); exhaustive matching grows with N² (sequential above 300 photos assumes the files are in shooting order); one lens per size group, not per phone; the model has no metric scale or gravity (display up is a heuristic); not linked to LiDAR or a property yet; unplaced photos are excluded, not fixed.

### Lab 10C (stage 1) — Cloud training package

Constraints (from the brief): no CUDA or heavy training on the Mac; no cloud instance, upload or charge without the user's explicit approval; original photos and the COLMAP output untouched; a COLMAP success is not assumed to mean a training success.

Requirements:

- Backend (section 5.11): `GET /training/{id}/package` (checks, `ready`, size estimate, held-out photo ids, last build + `outdated`/`available`, `building`), `POST /training/{id}/package` (builds in a thread; 400 if a check fails; 409 while poses run or another build runs), `GET /training/{id}/package/download` (attachment `<slug>-training-package.zip`; 404 before a build). While a build runs, uploads/removal/deletion and starting pose estimation → 409.
- `backend/cloud_training/`: README.md (versions, estimates, Runpod steps 1–7: choose GPU, upload, install, quick test, quality test, download, Stop + Terminate; monitoring; troubleshooting; other providers), `setup_env.sh` (free-space check, gcc check, venv on the volume, `pip install --no-deps -r` the lock with the cu118 and gsplat indexes, `pip check`, GPU + gsplat rasterisation test), `train.sh smoke|quick|quality` (train → export → eval → `run.json`, each step recorded) and `train.sh finish <result>`, the lock file.
- Panel "Cloud training package (Lab 10C)" (shown once poses are done): the checks (✓/!/✗ + detail), contents (photos to train / held out, files), size before export, Build package / Build again, download link, built date + size + SHA-256, outdated notice, "What to do with it" (seven plain steps). Photo cards: "Held out for evaluation".

Accept (copy of room1, 192 photos, 175 placed):

1. Checks all ✓ (one model, OPENCV 1200×1600, 175 poses, 20,734 points / 101,200 observations, 175 files of the right size, 22 held out, no GPS, 17 left out); estimate ≈ actual (100.4 MB).
2. Zip: `shasum -c SHA256SUMS` passes; the five `.bin` files `cmp`-identical to `work/poses/sparse/0`; 175/175 images decode to the same pixels as COLMAP's copies with no EXIF/XMP left; Nerfstudio 1.1.5's own `colmap_parsing_utils` reads the package: 1 camera, 175 images, 20,734 points, all files present at the camera size; its interval split equals the manifest's; manifest `colmapImageId` ↔ file agrees with images.bin.
3. Failure cases: photo removed after poses → poses ✗ and build 400; packaged photo missing → ✗ "missing"; photo resized → ✗ size vs lens; no pose job → ✗; a JPEG with GPS + XMP + ICC → GPS and XMP gone, ICC kept, pixels identical; non-JPEG → error.
4. `run.json` step of `train.sh` run on a fake result (Nerfstudio-style PLY header, nvidia-smi CSV, eval.json): peak memory, Gaussian count, INDEX.txt; Lab 8's `inspect_ply` accepts the Nerfstudio PLY layout (SH degree 3, extra nx/ny/nz).
5. Page (production build on :3011 against a test backend on :8001): 11 ✓, size line, Build → download link, the downloaded file has the reported size, 22 "Held out" cards; removing a photo → ✗ poses, Build disabled, outdated notice, held-out badges gone; the other five pages load without errors; `tsc`, `next build`, pyflakes clean.

6. Preflight (10C.2): the real Nerfstudio 1.1.5 dataparser and datamanager on the built zip give the manifest's 22 held-out photos in the render order; the exact `ns-train` command parses and writes `config.yml` at `outputs/room1/splatfacto/<run id>/`; `ns-export`/`ns-eval` options match; the lock re-resolves to itself; the image tag and wheels exist. `train.sh` with stand-in `ns-train`/`ns-export`/`ns-eval`/`nvidia-smi` and the real report code: all ok → exit 0, `evalSplitMatchesManifest: true`, INDEX from the run's config; eval fails → PLY + checkpoint kept, `finish` repeats only eval; training stops after a checkpoint → `incomplete`, still exported/evaluated; no checkpoint → `failed`, report written; five runs → five separate folder pairs.

Not verified here (needs the GPU machine): the installation itself, training, export and evaluation on a GPU. The smoke preset is the first thing to run there.

Stage 2 (after the first real training, with the user): import `splat.ply` into the splat store linked to the training project with `run.json`/`dataparser_transforms.json` as provenance (Labs 8/9), check its orientation (Nerfstudio's frame is z-up, re-centred and scaled), record viewer FPS/memory and the visual review.

### Basel House — static preview dataset

Data: `public/datasets/basel-house/basel-preview-1m.bin` (1,003,809 points of BM Heritage's `map-002.las`, 259,986,436 points; interleaved format, section 5.1.1) + `basel-preview-metadata.json`, and `basel-preview-5m.bin` (5,097,774 points) + `basel-preview-5m-metadata.json`. The `.bin` files are gitignored like all point data; the JSONs are tracked.

Budgets (density/performance comparison): the existing Point Budget buttons show 1M and 5M for Basel; switching uses the same loader, RGB handling and renderers, keeps camera, target, orientation and offset (section 5.1.1), and frees the previous geometry (`<PointCloud>` unmounts while the next budget loads). Measured on an M-series Mac at the default view: 1M ≈ 4.7 ms GPU, 5M ≈ 10–13 ms GPU, both ~60 FPS; load 0.1 s vs 0.5 s; r3f-perf's geometry count stays at 3.

Requirements (constraints from the brief: existing datasets, renderers, controls and performance tools unchanged; no arbitrary rotations or offsets; no walking, collisions, Gaussian training or image registration):

- `BASEL_HOUSE_DATASET` in `BUILTIN_DATASETS` (`lib/datasets.ts`), id `builtin-basel-house`, budgets 1M and 5M (Basel.1); offset/bounds/count come from the metadata at load time. Backend: `catalog.BUILTIN_DATASET_IDS` so it can be assigned to a capture.
- Loader: second layout `interleaved-xyzrgb`; map.las keeps `counted-planar` (default).
- Coordinates: section 5.5 chain; the scan area (trajectory bounds in LAS coordinates) via `lasBoxToDataset`. Up axis verified with `describeVerticalAxis`.
- Panel: **Focus on Scan Area** (only for datasets with a `scanArea`) and **Frame Entire Cloud** under the title next to Reset View; vertical-axis line in the stats; preview note in the dataset info. Axes and grid are placed at the original LAS origin for previews (the bounding-box centre's Z = 32 m is in the sky).

Scanner trajectory (Basel.2): `public/datasets/basel-house/poses.csv` is a byte copy (SHA-256 `ba621b73…`) of the capture's `project_data/poses.csv` (24,198 rows, no header, 10 Hz, 2,419.8 s; gitignored like the point data). Checked before showing it, with `converter.validate_poses` against the 5M preview in LAS coordinates: timestamps increasing, max |‖q‖ − 1| = 0.0005 (qx, qy, qz, qw; w is the large component), 100% inside the LAS bounds, median 0.53 m / p95 1.04 m to the nearest scan point → aligned; the same poses shifted 500 m → suspect. Scanner height above the lowest points of its 0.5 m cell: median 1.20 m (handheld; spread from floors above/below). Same chain as the points (LAS − coordinateCenter, then the group rotation): the loaded path's box equals the scan-area box to 5 mm, and the first pose sits at LAS (0, 0, 0), i.e. at the axes helper. Shown with either budget; switching budgets doesn't reload it (the offset is kept, section 5.1.1).

Accept: tsx test with the real code — parse equals numpy, 67.6% of points inside the scan area, view targets as in section 6.6, map.las 500K still loads (7,500,004 bytes) with an unchanged initial view; in the browser Basel lists, loads (15.1 MB, ~0.1 s), shows the metadata values and "Z up", the three view buttons move the camera, Standard/Shader, RGB and point size work, switching back to map.las hides Focus on Scan Area; all other pages load; `tsc` and `next build` clean.

### Lab 13P — XGRIDS XBAG camera frame indexer

Constraints (from the brief): read the 13.9 GB `.xbin` in chunks, never whole; the `.xbin`, LAS and trajectory stay unchanged; no image extraction, calibration or training; a standalone Python tool, independent of Next.js/React.

Requirements: `scripts/xgrids/index_xbin.py` as in section 5.12; patterns straddling chunks found once (overlap = longest pattern − 1, accept only offsets beyond the last accepted one; metadata read with `os.pread` at exact offsets, so chunk size doesn't matter); integer microseconds throughout (`datetime + timedelta` for UTC strings, `Decimal` for poses.csv); progress lines on stderr; `--max-bytes` for partial runs, `--out`, `--poses`, `--chunk-mib`.

Accept: first 64 MiB vs the earlier experiment (116 frames, 56 pairs): 117 frames, 57 pairs, identical with 16 MiB and 4 KiB chunks; the extra frame is a sequence-0 image the experiment skipped (no `08` field), the experiment's "1086 / …217.574699" for the first image is sequence 0 / …216.490409 (= its record header's first timestamp), the other 115 timestamps are identical; 3 unpaired and 2 stream-less frames only because their partners/record lie beyond 64 MiB. Full file: 14,590 SPS matches, 14,590 decoded, 0 rejected, all streams assigned (2,918 camera records, 14,590 declared messages = images found, so no camera image lacks the SPS), 7,295 pairs, 0 unpaired; `unchangedDuringScan` true.

### Lab 13Q — Selective XBAG camera extraction

Constraints (from the brief):
- `frames.csv` only; no rescan.
- Both cameras for every event.
- FFmpeg to full-resolution JPEG with configurable quality.
- Channel IDs kept in filenames and metadata.
- Scanner pose interpolation: XYZ linear, SLERP in xyzw order. Extrinsics stay explicitly unknown.
- Events outside the pose range excluded by default and reported.
- Graceful FFmpeg and incomplete-frame handling.
- Output outside Git.
- `.xbin`, `.las` and `poses.csv` unchanged.
- Three validation pairs (beginning, middle, end) before about one pair every 10 s.
- No calibration, training, stitching or UI.

Requirements: `scripts/xgrids/extract_frames.py` as in section 5.12, plus:
- `scripts/xgrids/README.md` and the `docs/xgrids/` notes;
- `tests/xgrids/` (synthetic XBAG generator and 13 unittest cases for both scripts);
- `.gitignore` entries for `*.xbin`, `/reconstruction/`, `*.splat` and `*.ksplat`. `*.ply` is deliberately not ignored, so a tiny fixture can be committed.

Accept: `python3 -m unittest discover tests/xgrids` passes.

Validation run, sequences 53 / 3674 / 7294: 6/6 `ok`. Each image was checked in a separate script:
- the manifest links it to the right `frames.csv` row;
- `ffprobe` reports MJPEG 4000 × 3000 and a full decode is clean;
- PSNR against a fresh decode of the original H.264 bytes is 48.5–50.6 dB;
- thumbnails aren't blank, and those of the two cameras differ;
- the pose matches \(q_0 (q_0^{-1} q_1)^t\) to 5·10⁻⁷ m and 4·10⁻¹⁰.

Damaged-frame test, on a throwaway synthetic XBAG holding a real frame truncated, and one with 20 KB zeroed: both give `decoded-with-errors`, the run continues and exits with code 2.

Interval run: 484/484 `ok`, events 9.59–10.39 s apart, PSNR 48.2–51.7 dB, the same pose agreement, and identical SHA-256 values on rerun.

Not done: the images haven't been checked by eye in this lab, because they may show people. The user should look at the validation set.

### Lab 13R — Camera calibration workspace, phase 1

Constraints (from the brief):
- The LiDAR viewer's rendering and navigation are unchanged; the workspace is a separate page.
- The manifest and the selected images come from a configurable local data source, not bundled into Next.js and not in Git.
- Show the ch14 + ch18 fisheye images side by side, with timestamp, sequence, interpolated scanner position and quaternion, and a navigable marker in the LiDAR scene.
- Provisional orientation controls, clearly separated from verified calibration. Intrinsics and extrinsics stay unknown. The scanner orientation is never taken as a camera orientation.
- Data preparation stays in `scripts/xgrids/`. The design leaves room for verified intrinsics/extrinsics, 2D–3D correspondences, optimisation with reprojection errors, frustum/ray drawing and alignment diagnostics.
- No GPU training or new reconstruction techniques.

Requirements (sections 4 and 5.12):
- Backend `xgrids_runs.py` with the three `GET /xgrids…` endpoints (404 unknown run or file, 422 unreadable manifest). The manifest must have the required columns, and its integers must stay below 2⁵³ so they survive JSON → JS.
- `lib/xgrids.ts`, `lib/calibration.ts`, `components/calibration/*` and `app/camera-calibration/page.tsx`. `SpatialScene` gets the optional `lidarLayers` prop; `ScannerMarker` exports `ScannerBody`; `loadPoses` exports `parsePoses`.
- Frame check by SHA-256 of `poses.csv`; markers are hidden on a mismatch.
- Marker check against the dataset's own poses.
- Event selection by buttons, slider, sequence (nearest event, with a note that disappears once another control moves on) and clicking event dots.
- Image captions check the file name and the decoded size against the manifest.
- "Focus marker" and "Look along chNN" use serial view requests, as for Reset View.
- A link from the viewer's panel.

Accept:
- **Sequence 3665** (run `sequence-3665`): both captions ✓ for seq 3665, 4000 × 3000; marker check 0.001 mm. The early pose-test renders match it by PSNR (ch18 44.3 dB, ch14 45.3 dB, ≈ 14 dB swapped).
- **Several interval events:** captions ✓ and marker check ≤ 0.002 mm; Go to 3665 in `interval-10s` shows 3667 with a note.
- **Against the point cloud:** all 242 events are inside the LAS bounds, median 1.28 m above the floor.
- **`map.las`:** the frame mismatch is shown, with no markers and no viewer position.
- **Backend:** traversal, unknown run, hidden name, manifest and another run's image all give 404.
- **Main page** unchanged (loads 500K, link present); `tsc` and `next build` clean.

### Lab 13S — Manual visual extrinsics hypothesis test

Constraints (from the brief):
- Extend the calibration viewer so you can test whether one consistent pair of channel offsets (relative to the scanner pose, never equal to it) points each camera where its fisheye centre looks, across many events.
- Starting hypothesis: ch14 yaw −90°, ch18 yaw +90°, pitch and roll 0.
- Test set: seeds 2497, 2527 and 3037; 5–10 courtyard events; at least 2 indoor events.
- Call it a manual visual extrinsics hypothesis test, not calibration.

Requirements (sections 4 and 5.12):
- **Scene:** a direction helper per channel (origin, centre ray, translucent cone, label, orange/purple), an optional labelled scanner gizmo, and adjustable cone length and half-angle.
- **Panel:** yaw/pitch/roll as slider + number per channel, with the direction in words; reset, mirror both ways and swap; named presets; test-set chips and ◀/▶; per-event verdicts and notes saved with the offsets; JSON export.
- **Images:** a centre cross-hair.
- **Storage:** presets and notes are read from localStorage after mounting, because the page is prerendered.
- **Convention change:** the 13R provisional sliders were yaw + = left and pitch + = down. Lab 13S defines yaw + = right and pitch + = up, so that −90° = left as in the brief.

Accept:
- `tsx`: yaw −90° gives "left 90°" with forward (0, 1, 0); pitch +30° gives up 30°; roll +90° turns image-up to the right.
- In the browser: the 14 chips appear; number inputs update the helpers and words live; mirror, swap, reset and preset save/load work; a verdict colours its chip; a note records the offsets; ◀/▶ step through the test set.
- **Numerical comparison across the 14 events:** ch14 best at yaw −90° and ch18 at +100°, level, roll 0°. The opposite and forward/backward assignments score far lower.

### Lab 13U — Image ↔ LiDAR correspondence lab

Constraints (from the brief):
- Don't rebuild the app or modify the XGRIDS extraction pipeline; `provisional-camera-directions.json` stays the unchanged reference.
- No nonlinear calibration, Gaussian training or automatic LiDAR-to-image registration.
- Never call the camera calibrated because an error number exists. Compute an error only from a valid projection. The default model parameters are assumptions, not manufacturer intrinsics. Label a raw nearest-point pick approximate. Never save viewer coordinates as LAS.
- No images, raw scans or large derived data in Git.

Requirements (sections 4 and 5.12; details in `docs/xgrids/correspondences.md`):
- **Mode:** "Image ↔ LiDAR correspondences" next to the direction test on `/camera-calibration`. Choose an event (chips 3877, 2497, 3037, 4718 or any) and ch14/ch18.
- **Image:** the full 4000 × 3000 JPEG with zoom about the cursor, pan, Fit/100 %/400 %, Large/Small layouts, hover coordinates, original-pixel clicks (0.01 px), numbered markers, and a file-name/size check before picking.
- **LiDAR:** an armed pick mode (a drag still orbits). Screen-space candidates within 8 px, front surface only, nearest point (approximate), optional ray ∩ PCA-plane refinement with explicit refusals. The pending markers preview the pick before saving. "Look along this pixel's ray" and "Show" camera moves help navigation.
- **Records:** dataset id + `poses.csv` SHA-256, run, sequence, channel, image file, exact µs timestamp, size, (u, v), LAS XYZ + method + detail + budget, scanner pose, feature, quality, notes, `calibrationStatus: "provisional"`, unique id, created/updated. Edit (including replacing the pixel or LiDAR point) and delete (with confirmation). localStorage after mount.
- **Overlay (optional):** projected LiDAR (≤ 20 m, ≤ 400k points, red near → blue far), usable circle, principal point. Rotation = the current direction offsets. Editable f/cx/cy/radius marked "assumed".
- **Errors:** observed vs predicted per record (× and residual line), and per channel and overall count/mean/median/RMS plus an invalid count.
- **Export/import:** JSON with schema + version, dataset identity, conventions, the model and offsets used, per-record diagnostics; import validates each record and skips existing ids.

Accept:
- Unit checks outside the repo: TS projection = Python reference (600 points, 0 validity mismatches, < 10⁻⁶ px); inverse to 10⁻⁶°; eigen-solver = numpy; synthetic wall exact, noisy wall to 0.5 mm, corner refused; validation/export/parse/merge round trip.
- Three features through the UI (two events, both channels' code paths, event switching), with every saved LAS point equal to a preview point + offset and every prediction reproduced in Python to 0.1 px (Basel: 14.8, 104.3, 180.3 px).
- Show, Edit, Delete (cancel keeps), Export → Delete → Import restores and skips duplicates; wrong schema rejected.
- Direction mode, helpers and the camera-pair panel unchanged; `tsc` and `next build` clean.

### Lab 13V — Image-to-LiDAR camera calibration optimization (experimental)

Constraints (from the brief):
- Never call the result a verified or precise calibration. Fit only from valid projections; the old model's parameters are not manufacturer intrinsics.
- Don't treat the scanner direction as the optical axis. Never optimise all unknowns at once. Never train on the validation event.
- Don't edit the input export; keep results outside Git. Don't apply estimates to the main viewer or overwrite the provisional presets.
- No XBAG processing, GPU work, Gaussian training, full-frame extraction or LiDAR-to-image texturing.

Requirements (sections 4 and 5.12; details in `docs/xgrids/calibration-experiments.md`):
- **Input:** a Lab 13U export.
  - Check its schema and version, its dataset id and pose-file hash (format, plus the expected values when given), every record, and that ids are unique.
  - Optionally cross-check each record against its run manifest.
  - Hash the file's exact text.
- **Audit before fitting:**
  - per camera: counts, events, distances, image quadrants and radius rings, pick methods, duplicates;
  - flags with reasons, *exclude* (wrong-side > 110° off-axis, < 0.2 m, unknown channel) or *review* (< 3 m with the 5 cm lever-arm effect in px, may-move keywords, image edge, quality, duplicate, and with the cloud: sparse LiDAR and occluded);
  - the user can override each flag; nothing is deleted.
- **Solver** (Python + SciPy, separate from React): Stage A fits the rotation, starting from ±90° with the lens fixed. Stage B adds f, starting from Stage A, with cx/cy fixed and no distortion terms. Both use a robust loss with bounds.
  - Diagnostics: 1σ and correlation from a central-difference Jacobian, condition number, parameters at bounds, and the solver's status.
- **Validation and sensitivity:**
  - leave one event out, with skipped folds reported;
  - outliers listed and kept;
  - shifts with a ±5 cm lever arm and with other losses, four starting points, a strict subset, and a refit without outliers;
  - identifiability limits label each parameter "estimated (experimental)" or "poorly constrained";
  - the recommendation goes by the held-out median, never by training error.
- **CLI:** `scripts/xgrids/calibrate_cameras.py` writes `audit-<sha8>.json` and `experiment-<id>.json` with mode "x", and refuses an output folder inside the repo. Optional `--image-check RUN`: NCC of LiDAR renders vs photos on up to 24 events not used for fitting.
- **Backend:** stateless `POST /xgrids/calibration/audit` and `/xgrids/calibration/experiments`:
  - body = the export text, at most 5 MB (413 when larger);
  - query: datasetId, posesSha256, exclude, include, sourceName;
  - 422 on an identity or run mismatch, 400 on bad id lists, 503 without SciPy;
  - one fit at a time.
- **UI:** a third mode, "Calibration optimization". It shows:
  - the source (this browser's records, or a file);
  - the audit list with flags and use checkboxes, and a clearly labelled run button;
  - per camera, the provisional / Stage A / Stage B parameters with status, and the training and held-out errors;
  - diagnostics, per-point errors, warnings and limitations, and the image check (from CLI experiments);
  - a parameter-set switch for the image markers (○ measured, × projected, residual line) and the LiDAR overlay;
  - experiment JSON export and import (schema, dataset and pose hash checked).

  The image viewer is display-only here; presets, offsets and the Lab 13U projection are untouched.

Accept:
- `backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py` passes (20 tests, synthetic data). With `SPATIAL_LAB_CORRESPONDENCES` set, the real export's recorded predictions are reproduced.
- The real Basel export gives the same experiment id from the CLI and from the UI (`x_652068cf70da`).
- In the UI: the audit shows #11 excluded; Stage B is recommended for both cameras; the image markers and overlay follow the chosen set; experiment import refuses a wrong schema and a wrong dataset; all three modes still work.
- `tsc` and `next build` clean.

### Lab 13W — Correspondence quality and calibration dataset preparation

Constraints (from the brief):
- No rebuild of the app, no Gaussian training, no change to the extraction pipeline.
- Keep LAS coordinates, timestamps and axis conventions; all values stay experimental or provisional.
- Don't fit a lever arm, distortion or time offset; don't overwrite earlier experiment outputs.
- Flag suspicious matches; never delete them automatically; keep record ids.
- Don't push the user to pick unreliable features to reach a count.
- Don't call the expanded real-world dataset complete until the user has collected and verified the new matches.

Requirements (sections 4 and 5.12; details in `docs/xgrids/correspondences.md` § Review and coverage):
- **Record fields** (optional, schema still v1, validated in `lib/correspondences.ts` and `camera_calibration.record_problem`):
  - `excludedFromFit {reason, at}`;
  - `reviewStatus` (unreviewed / verified / needs-fix);
  - `scene`;
  - `history` (≤ 100 `{at, action, previous}`).

  `withChange` keeps `id` and `created`.
- **Review list** (`CorrespondenceReview.tsx` `ReviewList`, replaces Lab 13U's list):
  - shows event, channel, pixel, LAS, method, distance and height from the scanner, image region (thirds of the usable radius), angle from the axis, error under the reference set, flags, quality, scene, notes, review status, and whether the match is in fits;
  - actions: Show, Edit (also replace pixel / LiDAR with history), Exclude with a reason / Restore, Delete;
  - filters: all / to review / excluded / this event.
- **Reference set** (`chooseReference`): a loaded experiment's Stage B for this dataset and pose hash; else the built-in `BASELINE_STAGE_B` (Basel export only; the latest experimental baseline `x_c69aede71834`); else the provisional rotations with the assumed lens. Always named in the panel.
- **Flags** (`reviewRecords`) mirror the backend audit:
  - *exclude*: user-excluded, wrong-side, too-close;
  - *warn*: the Lab 13V list (#1, #5, #11, #16 by id, until verified or excluded), needs-fix, close-range, may-move, quality, large-error (> max(3 × the channel median, 40 px)), no-projection, duplicate;
  - *info*: image edge.

  Reliable = in fits with no warning.
- **Coverage** (`coverage`, `CoveragePanel`):
  - per camera: reliable / verified / events against 15–25 (≥ 5 events);
  - regions, eight directions (middle and outer rings), distance bins, height, scenes;
  - an SVG of the fisheye frame with shaded cells and clickable dots (red ring = the Lab 13V list);
  - guidance that names gaps but never asks for unsure picks;
  - a "dataset not complete" note.
- **Collection:** a scene select in the new-match form; an optional grey overlay of the camera's matches from other events.
- **Backend:**
  - audit flags `user-excluded` (exclude by default; `--include` forces the record back in) and `needs-fix`;
  - audit rows carry `imageRegion`, `reviewStatus` and `scene`;
  - unknown ids in exclude/include are refused (400 from the endpoint; error from the CLI); `MODULE_VERSION` "13W.1".
- **Experiments:** rerun 13V's input as the baseline (same numbers, new id), without #1/#5/#16, and ≥ 3 m only, into `experiments/13w/<name>/`. `scripts/xgrids/compare_experiments.py` compares parameters ± σ, training and held-out errors, fold ranges, identifiability, image check, change vs the baseline in σ, and held-out error on shared records.

Accept:
- 22 calibration tests pass.
- In the UI, the 19 Basel records show #1, #5 and #16 flagged with Lab 13V errors (245, 95, 67 px) and #11 excluded as wrong-side. Coverage reads ch14 3 reliable and ch18 4.
- Exclude then restore keeps the id and logs both steps; loading an experiment switches the reference.
- `tsc` and `next build` clean.

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
| After pulling new backend code the panel says the backend has no properties support / 5M is missing for old datasets | `uvicorn` was started without `--reload` and still runs the old code | restart the backend: new endpoints appear and missing budgets are backfilled at startup |
| Splat scene shows as a tiny blur far away | the viewer frames the full bounding box, which a few floaters stretch to ±200 units | robust 2nd–98th percentile box from the splat centres (`splat_bounds.py`) → `settings.cameras[0].initial` |
| Interior scenes look like fog from the start view | an outside view of a room sees the back of its walls and the floaters around it | start inside: free-space viewpoint from a 16³ occupancy grid; Inside/Outside switch |
| Viewer starts with an auto-moving camera | without authored animation it creates a rotate/figure-8 track and starts in `anim` mode | `noanim: true`, then `state.cameraMode = "orbit"` once loaded |
| A missing scene leaves a blank viewer | the viewer has no public load-error event | one-byte range request before creating it + `app.assets.on("error")` |
| Second Playwright tab reads the user's real backend | `page.route` applies to one page only | use `context.route` for redirects in multi-tab tests |
| Production check on another port says "backend not reachable" | CORS allows only :3000 by default | start the test backend with `SPATIAL_LAB_ALLOWED_ORIGINS` including the extra port |
| WebGL path untested in headless Chrome | `--disable-features=WebGPU` doesn't hide `navigator.gpu` | `addInitScript`: `Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined })` |
| Restarted test backend dies immediately | a `pkill -f uvicorn…` issued in parallel matched the new process too | stop, wait, then start (sequentially) |
| Killing a background `uvicorn` leaves it listening | the shell wrapper was killed, not the server | `lsof -ti tcp:8000 -sTCP:LISTEN \| xargs kill` |
| Gaussian #0 (and many others) looks like nothing in the inspector | real scenes contain huge faint floaters (#0: σ 2–3 m, α 0.016) and many nearly transparent Gaussians | expected; start from a random sample, show α beside each sampled Gaussian |
| Real Gaussians are "too close to the camera" / not drawn | mm-sized Gaussians need a camera closer than Lab 6's `MIN_DEPTH` (0.2) | magnify Gaussian and camera distance together (Σ2D is unchanged) and report real distances |
| Monte Carlo test of Σ2D fails by ~6% | (1) a JS LCG with `s * 1103515245` exceeds 2⁵³ and loses precision → biased samples; (2) at σ/distance ≈ 0.1 the linearised projection itself is ~6% off | use mulberry32 (`Math.imul`); test the linearisation at a larger distance (2% at 8×) |
| `tsx` test with top-level `await` fails ("not supported with the cjs output format"), then "Cannot find package 'three'" | `.ts` outside a module package runs as CommonJS; ESM ignores `NODE_PATH` | name it `.mts` and symlink the project's `node_modules` next to it |
| Colour picker shifts the colour | `THREE.Color.set("#hex")` converts sRGB → linear | parse hex manually and use `setRGB` with the values as is (Gaussian colours are display values) |
| A field read by index gives the wrong attribute | PLY property order differs between exporters (SuperSplat puts `rot_*` before `scale_*`, training adds `nx ny nz`) | always read properties by name (structured dtype from the header) |
| `curl` test sends no files (405 / empty upload) | zsh does not word-split an unquoted `$args` string | build an array and pass `"${args[@]}"` |
| iPhone photos refused (Lab 10A) | HEIC isn't decodable by Pillow without a plugin | `pillow-heif` (`register_heif_opener()`), 10A.1 |
| A cut-off HEIC is accepted with a garbage picture | libheif fills missing tiles instead of failing | check the HEIF box chain fits in the file before decoding (`heif_complete`) |
| COLMAP feature extraction crawls (~4 s/photo, one core busy) on an 8 GB Mac | default `first_octave -1` upsamples every image 2× and all threads run at once → memory pressure and swapping | `SiftExtraction.first_octave 0`, 4 threads, 1600 px copies: 192 photos in ~50 s |
| Cancel takes ~10 s / `pkill colmap` leaves it running | COLMAP ignores SIGTERM | kill it (SIGKILL); each run starts from a clean `work/poses/` |
| A pip lock for an old release pulls today's dependencies (tyro 1.0, pillow 12 for Nerfstudio 1.1.5) | the package only sets lower bounds (`tyro>=0.6.6`) | resolve with `uv pip compile --exclude-newer <release date>` for the target platform; `--only-binary :all:` + `--no-binary <pkg>` finds the source-only packages |
| Nerfstudio training hangs at "Would you like to downscale the images" | images > 1600 px make the COLMAP loader ask interactively | ship 1600 px images and pass `--downscale-factor 1` |
| A training script loses a finished training when evaluation fails | `set -e` aborts at the first failing step | record each step's state, keep going, report, `finish` retries; never delete the checkpoint |
| Checking Nerfstudio 1.1.5 code locally: `AttributeError: __class_getitem__` in tyro / `No module named 'pymeshlab'` | tyro 0.8 doesn't run on Python 3.13; pymeshlab is only required on non-ARM machines | use Python 3.10 (`uv python install 3.10`, `BUILD_NO_CUDA=1` for gsplat); stub `pymeshlab` for `ns-export --help` on Apple Silicon (the Linux lock has it) |
| Production test build talks to the real backend | `NEXT_PUBLIC_SPATIAL_API_URL` is inlined at **build** time, not read by `next start` | build with it set to the test backend, rebuild without it afterwards |
| Global mapper "places every photo" | it also poses photos with 0–3 matched points | use the incremental mapper; report unplaced photos |
| Two COLMAP runs write the same database | a killed shell's `&&` chain kept going to the next step | one run per clean folder; check `pgrep colmap` before starting |
| HEIC portrait photo reported as landscape / swapped twice | pillow-heif already rotated it and resets EXIF orientation to 1 | don't swap sides for HEIF; record `info["original_orientation"]` |
| Re-uploaded copies flagged only as "near-duplicate" | the duplicate loop stopped at the first earlier photo matching in any way | look for an exact SHA-256 match among all earlier photos first, then the closest dHash |
| Thumbnails "not loaded" in a headless check | `loading="lazy"` images below the fold load only when scrolled to | scroll the grid and wait before counting |
| (Preventive) `RangeError: start offset of Float32Array should be a multiple of 4` (interleaved preview) | 15-byte records leave floats unaligned | read through a `DataView` and de-interleave into planar arrays |
| XBAG frame indexed with sequence 1086 and a wrong timestamp, another frame missing | protobuf omits fields equal to 0 (sequence 0); a loose backwards search picked up a neighbouring message's varints or found nothing | parse the whole message structure from its `0a` start to the SPS, accept a missing sequence as 0, reject candidates with zero or several possible starts |
| A damaged H.264 frame decoded "cleanly" (exit 0, no message) | at `-loglevel error`, FFmpeg conceals damaged slices and reports them only as the warning "corrupt decoded frame" | run FFmpeg at `-loglevel warning`, where a clean frame prints nothing; any message → `decoded-with-errors` |
| "SLERP" was really normalised lerp for almost every pose step | a `dot > 0.9995` shortcut (under about 3.6°) covers nearly all 100 ms steps (median 1.2°); error up to 3·10⁻⁷ | angle from `2·atan2(‖q0 − q1‖, ‖q0 + q1‖)` (precise for small angles); lerp only below 10⁻⁶ rad; test against the closed form for a 0.5° step |
| (Preventive) Grid and axes jump while another Basel budget loads | the metadata (= offset) was stored with the loaded points, which are cleared on a budget switch | keep the dataset's preview metadata separately (`previewFrame`) and check each new budget's `coordinateCenter` against it |
| Basel House grid/axes float far above the building | its offset is the bounding-box centre (Z = 32 m), so dataset (0,0,0) is in the air | place the helpers at the LAS origin (−offset); never shift the points |
| Basel full-cloud view shows a tiny building | outliers stretch the full box to 225 × 208 × 99 m | default to the scan-area view; Frame Entire Cloud stays available |
| Cursor's embedded browser screenshots don't change after a click | the hidden tab pauses `requestAnimationFrame` (0 FPS) | take a second screenshot, or check state through the DOM/numbers instead of pixels |
| A test screenshot captured private photographs (Lab 13R) | the blur style was injected but not yet applied when the screenshot ran | before any screenshot of a page with real photos: set the blur (`filter: … !important`) or hide the images, and confirm with `getComputedStyle` first |
| Cursor's embedded browser screenshot shows only the top-left of the page | `Emulation.setDeviceMetricsOverride` renders a larger page, but the screenshot keeps the tab's real size | clear the override and work at the native viewport (hide panels if needed) |
| Typing a value and pressing Enter in the embedded browser submits the old value | fast typing + Enter fires the submit before React stores the input's new state | click the button afterwards, or set the value with the native setter + `input` event, then submit |
| Direction scores flat in the open courtyard (Lab 13S analysis) | sky and similar façades on every side make an image look alike at many yaws | judge one fixed offset over many events (mean of per-event z-scores); weight indoor events, whose structure is distinctive |
| (Preventive) Hydration mismatch from saved presets/notes | the page is prerendered without `localStorage` | read it in a `useEffect` after mounting, never in a `useState` initialiser |
| "This page couldn't load" on the :3011 test build (Lab 13U) | `next start` was launched in the same batch as `next build`, so it served a half-written `.next` (404 chunks) | start the test servers only after the build has finished |
| Plane refinement accepted a building corner (Lab 13U) | a fixed 10 mm rms limit; a corner at 6 cm gives about 0.19 × radius ≈ 11 mm | limit `max(4 mm, 0.11 × radius)`, measured from the preview's planar noise (median about 6 mm at 5 cm) |
| Image viewer zoom reset while hovering (Lab 13U) | the footer text wrapped, the viewer resized, and a resize re-fitted the image | fit only on load and on a layout switch; footer `nowrap` |
| Close features don't match between image and LiDAR (event 3877) | at 0.5 m an unknown lever arm of 10 cm shifts the direction by about 11°, and the LiDAR there is sparse | use features ≥ 3 m away (lever-arm effect ≲ 2°) |
| Hard to find a small feature in the 3D view | the 3D view is a pinhole perspective, the image a fisheye | "Look along this pixel's ray" (target at the LiDAR surface range); for validation, find the LAS point offline and project it with the scene camera (fov 60°, check against a saved `#n` label) |
| Fitting the rotation alone made held-out errors worse (Lab 13V) | the assumed lens (f = 750) was wrong: every pixel's angle from the centre was 1.2–1.3 × the point's angle from the axis, and a rotation can't fix a scale error | look at the pattern of residuals before fitting; free f (Stage B) after the rotation, and judge by held-out error |
| A "perfect" correspondence 172° behind the camera (Lab 13V) | the LiDAR pick landed on a façade across the courtyard (scanner's other side) | audit off-axis angle vs pixel angle before fitting; exclude, don't delete |
| NumPy import fails with `IndexError` in a scratch script's code | a scratch file named `inspect.py` in the working folder shadowed the standard `inspect` module | never name scratch files after standard modules |
| Photo-vs-LiDAR image check takes > 20 min (Lab 13V) | 242 events × 3 parameter sets, each selecting points from 5M again | select the points near the scanner once per image and cap at 24 evenly spaced events |
| A "≥ 3 m only" experiment came out identical to the baseline (Lab 13W) | zsh doesn't word-split `$IDS`, so `--exclude $IDS` passed one argument holding 11 ids, which matched nothing | the CLI and endpoint now refuse unknown ids; pass ids as an array (`"${IDS[@]}"`) |
| CLI crash `NoneType.__format__` after a fit with no held-out folds (Lab 13W) | the summary printed `None` medians with `:.1f` | print missing values as "—"; small subsets legitimately have no held-out error |
| Lower training error after removing hard points looked like progress (Lab 13W) | removing the worst points always lowers training error | compare held-out error on the records both experiments share, and the photo check (`compare_experiments.py`) |
| (Preventive) Calibration markers in the wrong place for another dataset | a run's scanner positions are LAS coordinates of *its* recording | place them only when the run's `posesSha256` equals the dataset's `poses.csv` hash; hide markers and viewer position otherwise |

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
- **Budget backfill** (Lab 7C): copy a real dataset's `metadata.json` + `converted/` into a temp store and *hard-link* its `source/*` (read-only use); start a test backend on another port with that `SPATIAL_LAB_DATA_DIR`; checksum the existing budgets before/after (must be unchanged); compare each new budget byte-for-byte with a fresh `write_bin` using the stored offset; check that old-budget points are members of the offset-subtracted full cloud (same frame); a copy with a tampered `offset` must end with `budgetJob.status = failed` and no file. A fresh import of map.las must give 500K/1M/2M/5M byte-identical to `public/data`.
- **Catalog** (Lab 7C): `curl` every endpoint incl. errors (blank/81-char names, unknown/malformed ids, `../` dataset ids, unknown dataset, unassign of a dataset not in the capture); after deleting a capture/property the dataset folders must still exist. In Playwright, answer `window.prompt`/`confirm` with `page.on("dialog")`; locate the pickers by label text anchored at the start (`/^Dataset/`), since "Unassigned datasets" also contains "dataset".
- **Backend without copying big files** (Lab 7A): create a dataset folder whose `source/pointcloud.las` is a *symlink* to the original, write `new_metadata()`, call `converter.convert_dataset(id)` directly; use `SPATIAL_LAB_DATA_DIR=/tmp/...` so tests don't touch the real store. Patch `storage.BUDGETS` (e.g. a 10M budget; `planned_budgets` reads it) to exercise the "All (N)" path with real data. `cmp` the budgets against `public/data`.
- **API checks** with `curl -F`: wrong extension, fake content, empty name, invalid ids (`..%2F`), delete.
- **Importer**: unit-test `planImport`/`describePlan` with `npx tsx` (Node's `File`, `webkitRelativePath` set via `Object.defineProperty`): complete folder, two LAS files, several pose candidates, user resolution, two files on one role, unknown CSV + unsupported formats, no LAS, only system files. In the browser, `setInputFiles(<folder path>)` on the folder input; placeholder files are enough for the preview, and uploading a placeholder `.las` must return the backend's "LASF signature" error. End to end: a folder with a hard link to `map.las` + `poses.csv` + `project.json` → 5,242,880 points, same offset, poses aligned, 0% pixel diff vs the built-in dataset.
- **Sparse imports** (7A.2), against a backend with `SPATIAL_LAB_DATA_DIR=/tmp/...` on a spare port (never the user's running backend on 8000 — it writes to the real store; in Playwright, `page.route` can redirect `:8000` to the test port): `map.las` + empty `poses.csv`/`control_points.csv` + whitespace/BOM `gnss.csv` → 201, three skip warnings, `projectInferred` with CRS unknown, conversion ready, poses none; empty `project.json` and `{}` → inferred metadata; full set → no warnings, poses aligned (unchanged); empty LAS → 400; invalid non-empty JSON → 400.
- **GPU leak check**: `page.addInitScript` wrapping `createBuffer/deleteBuffer/bufferData/createTexture/createProgram` on both WebGL prototypes to count live objects and bytes, grouped by `ctx.canvas` size (to separate the r3f-perf chart canvas from the scene). Compare the same state before and after N round trips.
- **Projected-footprint measurement** (Lab 6): weight only pixels with the Gaussian's hue (`(G−B)/(R−B) ≈ 0.47` for the orange), and keep only the half of the screen away from the axis lines (the footprint is centrally symmetric) — otherwise axes blended into the faint tail bias the moments. Compare to a *simulated measurement* of the predicted Σ2D (same opacity, 8-bit rounding, threshold and 3σ cut), not to raw Σ2D: truncation and thresholding make the measured σ ~6% smaller.
- **Compositing** (Lab 7B): unit-test `compositing.ts` against `gaussianMath.ts` with `npx tsx` (run with `NODE_PATH=<repo>/node_modules` so `three` resolves). In the browser, average the 2×2 pixels around the canvas centre and compare with the panel's predicted probe colour (the canvas uses `linear`, so screenshot values are the shader's values); count draw calls per frame by wrapping `draw*` on `WebGL2RenderingContext.prototype` (only the scene canvas, width > 400); orbit with `page.mouse` drags (≈ viewport height / 2 px of horizontal drag = 180°); exclude the panel and the Perf overlay from pause/reset image diffs (both change while the scene doesn't).
- **Splat scenes** (Lab 8): import real scenes with `curl -F files=@…` into a test backend (folder uploads: one `-F files=@path -F paths=path` pair per file); cross-check `robust_bounds` between the PLY and SOG versions of the same scene (identical to 4 decimals → the SOG decoder is right). In Playwright, use real GPU flags (`--use-angle=metal --enable-unsafe-webgpu`; SwiftShader is too slow for millions of splats); count WebGPU devices by wrapping `adapter.requestDevice` / `device.destroy` and WebGL contexts by wrapping `getContext` + `isContextLost()`; orbit/zoom/reset with image diffs (scene clip without the panel); folder import via `setInputFiles(<dir>)` on the folder input.
- **Gaussian Inspector** (Lab 9): `curl` the three endpoints incl. errors; decode-check with an independent decoder (the same scene's SOG package, matched by nearest position); `npx tsx` script (`.mts`, `node_modules` symlinked) importing `lib/gaussian/inspector.ts`, `sphericalHarmonics.ts`, `gaussianMath.ts` with real records from the test backend: SH orthonormality (Fibonacci sphere), degree-0 = base, Euler round trip, preview Σ3D = FΣFᵀ, magnification invariance, Monte Carlo Σ2D (mulberry32), view direction mapping. In Playwright: turn the ellipsoid/outline off, compare the centre 2×2 pixel with `colour·α + bg·(1 − α)` from the panel (bg = 0.0103), orbit by dragging and compare again; set range inputs with the native value setter + `input` event.
- **Training photos** (Lab 10A): build fixtures outside the repo (crops of real renders, plus a byte copy, a re-encode, a blurred copy, a tiny PNG, a JPEG renamed `.png`, an EXIF-orientation-6 JPEG, a truncated JPEG, random bytes as `.jpg`, a `.txt`, text named `.heic`; HEIC copies via `sips -s format heic`, plus a truncated one with `head -c`); `curl -F files=@…` (zsh array) into a test backend; check every warning kind, removal, size/pixel limits and that `source/` + `thumbs/` match `project.json`. In Playwright: create a project, `setInputFiles` on the photo input and the folder input, answer `confirm` via `page.on("dialog")`, scroll before counting lazy thumbnails.
- **Camera poses** (Lab 10B): copy a real project's folder (without `work/`) into a test store; `curl` start / double start / removal while running / cancel (check `pgrep colmap` afterwards) / full run with polling; compare the summary with a manual COLMAP run (`model_analyzer`); when comparing mappers, align camera centres with a similarity (Umeyama) and list photos with few matched points. In Playwright, poll the panel text for the stage changes (a full run is ~4 min), then the 3D view: click over the canvas until a camera is selected, "Look through this camera", screenshot next to the thumbnail.
- **Training package** (Lab 10C): on a test-store copy (project.json, thumbs, work/poses.json, work/poses/{images,sparse,model}): print the checks; build; unzip and `shasum -a 256 -c SHA256SUMS`; `cmp` the model files; decode every packaged image against COLMAP's copy; read the package with Nerfstudio's `colmap_parsing_utils.py` fetched from the release tag (pure Python + NumPy, no install) and replay the interval split; break things one at a time (remove a photo, hide one, resize one, hide poses.json). Preflight with Nerfstudio itself: a throwaway Python 3.10 venv with `nerfstudio==1.1.5 torch==2.1.2 gsplat==1.4.0` (`--exclude-newer 2024-11-12`, `BUILD_NO_CUDA=1`); run the dataparser (`get_dataparser_outputs("train"/"test")`) and `FullImageDatamanager(device="cpu", test_mode="test").fixed_indices_eval_dataloader` on the unzipped package and compare with the manifest by **basename** (manifest `file` includes `images/`); run the exact `ns-train` command until it stops at CUDA and inspect `config.yml`; `uv pip compile` the lock with itself as input. Test `train.sh` with stand-in commands on PATH (`FAKE_TRAIN=ok|crash|nockpt`, `FAKE_EVAL=fail`, a `flock` stub on macOS, `python` as a wrapper script — a symlink to a venv's python loses the venv). Playwright: block `127.0.0.1:8000`, build → download event → size, then remove a photo and check the outdated state.
- **Preview datasets** (Basel): numpy reads the `.bin` as a structured dtype (`<f4` ×3, `u1` ×3) for reference values; a temporary `.mts` in the repo root run with `npx tsx` imports `lib/loadPointCloud.ts`, `previewDataset.ts`, `worldFrame.ts`, `initialView.ts` (feed `fetch` from the file system) and prints the parsed points, scan-area fraction, view targets and the map.las regression; delete it afterwards.
- **XBAG indexer** (Lab 13P): run with `--max-bytes 67108864 --out /tmp/…` at the default chunk size and with `--chunk-mib 0.00390625` (4 KiB, forces many boundary crossings) and `cmp` the two `frames.csv`; compare with an independent decode by offset; in the full run check `rejectedCandidates` (0), `streamAssignment` (all assigned) and `cameraMessagesDeclared` = `decodedFrames`. `python3 -m unittest discover tests/xgrids` covers both XGRIDS scripts on synthetic data.
- **XBAG extraction** (Lab 13Q):
  1. Run `--dry-run`, then `--validation` (3 pairs) before any interval run.
  2. Check each image in a separate throwaway script:
     - the manifest row matches `frames.csv` by `sps_offset`;
     - `ffprobe` gives the size, and `ffmpeg -v error -i x.jpg -f null -` is silent;
     - PSNR of the JPEG against a fresh decode of the H.264 bytes is at least 45 dB;
     - grey 64 × 48 thumbnails aren't blank, and the two cameras differ;
     - the pose agrees with \(q_0 (q_0^{-1} q_1)^t\) via axis-angle. Compare component differences, not `acos(dot)`, which is ill-conditioned near 1.
  3. Test damaged frames by embedding real H.264 bytes, truncated or partly zeroed, in a throwaway file built with `tests/xgrids/synthetic_xbag.py`. Keep that file in `/tmp`, never in the repo.
  4. Don't look at real photographs unless the user asks: they may show people.
- **Calibration workspace** (Lab 13R):
  1. Test backend on :8001 with `SPATIAL_LAB_XGRIDS_DIR` pointing at the real runs (read-only) and a temporary `SPATIAL_LAB_DATA_DIR`. `curl` the three endpoints, including traversal (`..%2F`), unknown run, `.hidden`, `manifest.csv` as an image and another run's image (all 404); unset variable, missing folder and a malformed manifest copied to `/tmp`.
  2. Production build with `NEXT_PUBLIC_SPATIAL_API_URL=http://127.0.0.1:8001` on :3011; rebuild without it afterwards.
  3. In the browser, read the panel and captions with `Runtime.evaluate` (frame check, marker check, captions ✓, `naturalWidth`/`naturalHeight`). Blur or hide the images before every screenshot (see section 8).
  4. Check the marker against the cloud with numpy: nearest point and height above the floor beneath for every event. Confirm a known pair by PSNR against earlier, independently made renders.
- **Direction test** (Lab 13S):
  1. Check the offset convention with an `npx tsx` script importing `lib/calibration.ts`.
  2. In the browser, drive the inputs with the native value setter and read the "→ left 90°, level" texts.
  3. For an objective check, render the coloured LiDAR through an equidistant fisheye (160 × 120, z-buffer nearest point, distance-thinned points) at each candidate offset. Compare it with the grey image by NCC inside the image circle, and pick one offset per channel by the mean per-event z-score over the test set.
  4. Keep these scripts and thumbnails in `/tmp`.
- **Correspondences** (Lab 13U):
  1. Compile `lib/fisheyeProjection.ts`, `pointPicking.ts` and `correspondences.ts` with a strict temporary `tsconfig` in `/tmp` (paths for `@/lib`, `three` symlinked); run with `node --experimental-require-module`. Compare against a Python reference that uses the Lab 13S rotation helpers on real manifest poses.
  2. Use the same :8001 / :3011 test setup as Lab 13R, built first and started afterwards.
  3. In the browser: zoom the image with synthetic `WheelEvent`s, click with screenshot coordinates, read the pick result and the records via `Runtime.evaluate`/localStorage. Fill inputs with the native setter. Capture the export by wrapping `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`; import by assigning a `DataTransfer` file to the input; answer `window.confirm` by overriding it.
  4. Verify each saved record in Python: the LAS point is a preview point + `coordinateCenter` (0 mm), the pose equals the manifest row, and the projection reproduces the app's predicted pixel and statistics.
  5. Image crops for placing clicks stay in `/tmp`; don't embed photos showing people in reports.
- **Calibration experiments** (Lab 13V):
  1. `backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py -v`, synthetic data with known parameters. Also run it with `SPATIAL_LAB_CORRESPONDENCES=<real export>` to reproduce the app's predictions.
  2. Copy the export read-only (chmod 444) to `<recording>/reconstruction/xgrids/calibration/inputs/`. Run the CLI with `--poses`, `--runs-dir`, the 5M cloud and `--image-check interval-10s`. Read the audit before the fits.
  3. Independent checks, on data the solver never saw: earlier validation records from another export, and the image check's NCC.
  4. Test backend :8001 (with `SPATIAL_LAB_XGRIDS_DIR`) and a :3011 build, as for Lab 13U. Use `curl --data-binary @export.json` for the endpoints, including a wrong `datasetId` (422), a body over 5 MB (413) and a bad id list (400).
  5. In the browser, load files by assigning a `DataTransfer` file to the input. To get the file text into the page without uploading it anywhere, serve a /tmp copy from a throwaway local HTTP server with CORS for :3011.
  6. Check that the UI's experiment id equals the CLI's.
- **Correspondence review** (Lab 13W):
  1. Put the real export's records into the :3011 test origin's localStorage (`spatial-lab.correspondences.v1`) via a throwaway CORS file server, then reload.
  2. Check the review list against the experiment: the Lab 13V errors for #1/#5/#16, #11 excluded as wrong-side, and the coverage counts.
  3. Override `window.prompt`/`window.confirm`, then Exclude → Restore. The stored record must keep its `id`/`created` and log both actions.
  4. Import an experiment in the optimization mode and confirm that the review's reference label switches to it.
  5. Rerun the CLI for each subset into a new folder (never over earlier outputs) and compare them with `compare_experiments.py`. Judge by held-out error on shared records and the photo check, not training error.
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

Explicitly out of scope so far (each would be its own lab): cross-capture alignment (Lab 7C organises captures per property; registration into a property frame via `alignment`/`frame`, using control points/GNSS/CRS, is not built), meshes and photographs as capture representations (splat scenes exist since Lab 8, section 5.7), splat ↔ LiDAR registration, importing SuperSplat `settings.json` (authored cameras/annotations), splat editing/cropping, background import jobs for very large splat files, LAZ/E57 import, LiDAR intensity visualisation, pose animation, clipping/cropping, measurement tools, annotations/hotspots, full Gaussian splatting (Lab 6 projects one Gaussian; Lab 7B composites up to 1,000 with CPU projection, centre sorting and instanced quads; still missing: projection and sorting on the GPU for millions of Gaussians, tile-based rasterisation, spherical-harmonic colour for many Gaussians in our own renderer (Lab 9 evaluates it for one; Lab 8 views real trained scenes with the official viewer), training), running the cloud training and importing its PLY with provenance (Lab 10C stage 2; `output/` reserved), metric scale/gravity for photo reconstructions (e.g. from LiDAR), XGRIDS camera calibration (fisheye intrinsics and camera-to-scanner extrinsics; Lab 13Q only gives scanner poses at the image times, Lab 13R only inspects them, Lab 13S only narrows the viewing directions, Lab 13U only collects 2D–3D correspondences with provisional error diagnostics, and Lab 13V only makes experimental estimates of the rotations and one focal parameter (principal point, lever arm, distortion and timing still unknown); Lab 13W adds review and coverage tools, but the expanded, hand-verified correspondence set (15–25 reliable per camera) is not collected yet, see `docs/xgrids/calibration-notes.md`; next steps in `docs/xgrids/calibration-workspace.md`: channel identity, intrinsics, 2D–3D correspondences, extrinsics, reprojection errors, frustums/rays, alignment diagnostics) and decoding of the non-camera XBAG channels, video frame extraction, linking training projects to a property/capture, RAW/video import, editing/saving trained Gaussians (Lab 9 experiments are preview-only), inspecting a Gaussian among its neighbours, ordinary meshes, WebXR, LOD/octrees, workers.

## 12. Prompt templates

**Rebuild the whole app:**

> Build "Spatial Lab" exactly as specified in `docs/SPATIAL_LAB_REBUILD_GUIDE.md`. Follow the principles in section 2, the versions and config in section 3, the architecture in section 4, and implement Labs 1 through 10C stage 1 in order (section 7). The built-in dataset is in `public/data/` (`pointcloud-500k.bin`, `pointcloud-1m.bin`, `pointcloud-2m.bin`, `pointcloud-5m.bin`, `poses.csv`); its offset is in section 5.2. Start the backend as in section 3.1. For Labs 8 and 9, use a downloaded SuperSplat scene (e.g. Ceramic Studio; its PLY download for Lab 9) as the test scene. After each lab run the validation playbook (section 9) and report results. Do not generate fake data.

**Variant for another purpose:**

> Using `docs/SPATIAL_LAB_REBUILD_GUIDE.md` as the reference, build a variant for **[purpose]**. Keep sections 2, 5 and 6 unchanged. Apply the adaptations for [purpose] from section 10. Omit the learning panels and shader experiment selector unless needed. Validate with section 9.

**Add a new lab:**

> Extend Spatial Lab with **[lab]**. Preserve all features listed in section 7. Follow the principles in section 2 and the pipeline rules in section 6 (especially the uniform-update rule and shared world frame). Validate with section 9, then update `docs/SPATIAL_LAB_REBUILD_GUIDE.md` (lab spec, pitfalls, changelog).

**New dataset:**

> Start the backend (section 3.1) and import `[file.las]` (+ `poses.csv`) through the Properties panel ("Import…"). Check the metadata: offset, bounds and point count from the full cloud, budgets, pose status. If poses are `suspect`, read the reason and diagnose the frames instead of adjusting. (Offline alternative: `scripts/convert_las.py` per budget, confirm identical offsets, and add a dataset record like `BUILTIN_DATASET`.)

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
| 7C | 5M point budget (`BUDGETS`, built-in `pointcloud-5m.bin`, startup backfill of missing budgets from stored LAS with offset/count verification, `budgetJob`, load size/time in the panel); Properties → Captures → representations in `spatial-data/catalog.json` (references only, one capture per dataset, no file deletion except Delete files, `alignment`/`frame`/`environment` reserved); catalog API; Datasets panel reorganised as "Properties"; no migration needed (missing catalog = all unassigned) |
| 8 | Separate `/gaussian-viewer` page with the official SuperSplat Viewer (`@playcanvas/supersplat-viewer` 1.37.0 + `playcanvas` 2.23.0, `createViewer` in a div, destroyed per scene); backend splat store `spatial-data/splats/` (`splats.py`: PLY/compressed PLY/SOG/SOG folder/SOG LOD/zip detection and validation, safe extraction, whitelist file endpoint; `splat_bounds.py`: robust bounds, free inside viewpoint; `pillow` added); catalog representation kind `gaussian-splat`; LiDAR panel counts splats; importer hints point `.ply/.sog` to Lab 8; SplatTransform conversion documented |
| 8.1 | `/gaussian-viewer` tells "backend not running" (fetch rejects) apart from "backend too old" (`/splats` 404 → restart it after `pip install -r requirements.txt`) |
| 9 | Separate `/gaussian-inspector` page: backend `gaussian_records.py` (memory-mapped read-only PLY records by name, decoding exp/sigmoid/normalise/SH-DC, channel-major f_rest, validity checks, SplitMix64 samples, 20k-sample statistics incl. 1/255 quantisation) + 3 `GET /splats/{id}/gaussians…` endpoints; `lib/gaussian/inspector.ts` + `sphericalHarmonics.ts` (reference/PlayCanvas SH); `InspectorScene`/`InspectorPanel` reusing Lab 6's projection, quad and reset (quad gains optional `colorForCamera`); 180° Z frame, uniform magnification; links from the LiDAR panel and Lab 8; sections 5.8 and 6.10 |
| 10A | Separate `/gaussian-training` page: backend `training.py` (store `spatial-data/training/`, Pillow content validation, size/pixel/disk/count limits, EXIF orientation + camera facts without GPS, 320 px thumbnails, checks: resolution, Laplacian-variance blur, SHA-256 duplicates, dHash near-duplicates, dimensions/orientation; planned stages; reserved association/jobs) + `training_env.py` (read-only environment verdict) + 8 `/training…` endpoints; `lib/training.ts`, `TrainingPanel`, `PhotoGrid`; link from the LiDAR panel; section 5.9 |
| 10A.1 | HEIC/HEIF (iPhone) photos accepted: `pillow-heif` 1.8.1 added to `requirements.txt`, stored as `.heic`, truncation check on the HEIF box chain, original orientation recorded; preprocessing stage notes HEIC → JPG for Lab 10B; frontend accepts `.heic/.heif` |
| 10A.2 | `/gaussian-training` tells a backend started before Lab 10A (`/training` 404/405 → "restart it") apart from other errors, instead of a bare "Not Found" |
| 10B.1 | Camera pose estimation: COLMAP 4.2.1 via Homebrew (user-approved); `training_poses.py` job in its own worker (preprocess 1600 px → SIFT CPU first octave 0 → exhaustive/sequential matching → incremental mapper), log-based progress, cancel (SIGKILL), restart recovery, 409 guards, summary + preview; 3 `/training/{id}/poses…` endpoints; stage statuses; `training_env.find_tool` (Homebrew fallback); panel section, placed/not-placed cards and filter, `PoseScene` 3D view (`lib/poseView.ts`); section 5.10 |
| 10C.1 | Cloud training package: `training_package.py` (COLMAP binary reader, 11 checks of the shipped files, lossless EXIF/XMP removal, size estimate, zip + manifest + SHA256SUMS) + 3 `/training/{id}/package…` endpoints with 409 guards; `backend/cloud_training/` (Runpod/any-GPU README, `setup_env.sh`, `train.sh quick|quality`, Nerfstudio 1.1.5 lock resolved as of its release date); panel section + "Held out for evaluation" cards; versions verified against PyPI/GitHub/ghcr/Runpod docs; section 5.11 |
| 10C.2 | Preflight before renting: held-out split and eval-render order verified with Nerfstudio 1.1.5's own dataparser/datamanager on the built zip; CLI dry run (`ns-train` → config.yml, `ns-export`/`ns-eval` options, PLY name, transforms location); lock re-resolves to itself, wheels and Runpod image verified. `train.sh`: `smoke` preset (300), per-step status (`run.env`), checkpoint always kept, `incomplete` training still exported/evaluated, `finish <result>` retry, optional report fields + `problems`, INDEX.txt from the run's config, `flock`, `TORCH_HOME` on the volume. `setup_env.sh`: free-space + gcc checks, no pip cache, `pip check`. README: presets/folders, storage table, encrypted volume, failure handling. Section 5.11 |
| 10C.3 | `train.sh` checkpoint detection: latest checkpoint chosen by numeric step (only `step-<digits>.ckpt`), completion = exit 0 and an exact filename match with Nerfstudio's `step-%09d.ckpt` for step N−1 (replaces a grep regex with an unescaped dot); tested on 12 filename/exit-code cases; room1 package rebuilt |
| Basel | Basel House preview as a second built-in dataset: interleaved 15-byte loader path (`DataView`), `lib/previewDataset.ts` (metadata validation + count check), `BUILTIN_DATASETS`, documented LAS → dataset → world chain and helpers in `worldFrame.ts`, data-checked up axis in the panel, Focus on Scan Area (trajectory bounds) / Frame Entire Cloud / Reset View via `viewRequest`, helpers at the LAS origin for previews, backend `BUILTIN_DATASET_IDS`; `public/datasets/**/*.bin` gitignored; sections 4, 5.1.1, 5.5, 6.6, 7, 8, 9 |
| Basel.1 | Basel House 5M budget (5,097,774 points) next to 1M: `preview.files` per budget key; preview metadata kept across budget switches (`previewFrame`), a budget with a different `coordinateCenter` is refused; checked: same centre and first point in both files, 67.6% in the scan area for both, camera unchanged 1M ↔ 5M ↔ 1M, Standard/Shader (RGB, Height), geometry count constant; sections 4, 5.1.1, 7, 8 |
| Basel.2 | Basel House scanner trajectory: `preview.posesUrl` → `public/datasets/basel-house/poses.csv` (copy of `project_data/poses.csv`, gitignored), pose status from `validate_poses` run offline (aligned, median 0.53 m); `Trajectory` draws the path and a new green start sphere on top of the cloud, skips per-pose dots above 2,000 poses (map.las's 208 unchanged); "Show scanner path" label mentions the start sphere; sections 4, 5.1.1, 7 |
| 13P | `scripts/xgrids/index_xbin.py`: chunked, read-only indexer of the H.264 camera frames in an XGRIDS `.xbin` (SPS heuristic, strict protobuf metadata decode, XBAG record headers → camera channel, sequence + ≤ 5 ms pairing, pose coverage) → `frames.csv` + `index-summary.json`; Basel House: 14,590 frames, 7,295 pairs, 0 rejected; sections 4, 5.12, 7, 8, 9 |
| 13Q | `scripts/xgrids/extract_frames.py`: selective ch14 + ch18 pair extraction from `frames.csv` (metadata re-checked, exact `h264_bytes` from `sps_offset`, FFmpeg at `-loglevel warning` → JPEG `-q:v`, JPEG SOF/EOI/SHA-256 checks, per-image statuses, exit 2 on incomplete events), scanner pose per image (linear XYZ + exact SLERP xyzw; extrinsics `unknown`), out-of-pose-range events excluded and reported, output refused inside the repo; Basel: validation 3 pairs and 242 pairs every 10 s, all 484 `ok`; `docs/xgrids/` (xbag-format, investigation-log, calibration-notes), `scripts/xgrids/README.md`, `tests/xgrids/` synthetic XBAG unittest suite (13 tests); `.gitignore`: `*.xbin`, `/reconstruction/`, `*.splat`, `*.ksplat` | 4, 5.12, 7, 8, 9, 11 |
| 13R | Separate `/camera-calibration` page (phase 1, inspection only): backend `xgrids_runs.py` + `GET /xgrids/runs`, `/xgrids/runs/{run}`, `/xgrids/runs/{run}/images/{file}` from `SPATIAL_LAB_XGRIDS_DIR` (manifest-listed files only); `lib/xgrids.ts`, `lib/calibration.ts` (intrinsics/extrinsics `unknown`), `components/calibration/` (panel, image pair with name/size checks, event dots, scanner marker, dashed provisional camera arrows, Focus marker / Look along); `SpatialScene.lidarLayers`, `ScannerBody`, `parsePoses`; SHA-256 frame check of `poses.csv` + marker cross-check; viewer link; validated on sequence 3665 (run `sequence-3665`, PSNR match to the early renders) and interval events; `docs/xgrids/calibration-workspace.md`; sections 3.1, 4, 5.12, 7, 8, 9, 11 |
| 13S | Manual visual extrinsics hypothesis test on `/camera-calibration`. Per-channel direction helpers: origin, dashed ray, translucent cone with adjustable length and half-angle, up tick, label. Labelled scanner X/Y/Z gizmo. Yaw/pitch/roll per channel as slider + number (new convention: yaw + = right, pitch + = up, roll + = clockwise; defaults ch14 −90°, ch18 +90°), reset/mirror/swap, localStorage presets, Basel test set (3 seeds, 8 courtyard, 3 indoor) with chips and ◀/▶, per-event verdicts and notes, JSON export, image centre cross-hairs (`DirectionTestSection.tsx`, `lib/directionTest.ts`). Result: ch14 ≈ −90°, ch18 ≈ +100°, level, roll 0, across the set; sections 4, 5.12, 7, 8, 9, 11 |
| 13S.1 | `docs/xgrids/provisional-camera-directions.json`: export of the provisional offsets, with R_offset = Rz(−yaw)·Ry(−pitch)·Rx(roll) (checked against `provisionalRotation`), quaternions, frame conventions incl. the OpenCV conversion, the test method and observations |
| 13U | Image ↔ LiDAR correspondence mode on `/camera-calibration`: zoomable full-resolution image viewer with original-pixel picking (`CorrespondenceViewer`), armed screen-space LiDAR picking with front-surface filter, approximate nearest point and optional ray ∩ PCA-plane refinement with refusals (`lib/pointPicking.ts`, `CorrespondenceLayers`), LAS conversion in float64, provisional records with edit/delete in localStorage, JSON export/import with schema v1 and validation (`lib/correspondences.ts`), optional assumed equidistant overlay with per-record errors and mean/median/RMS (`lib/fisheyeProjection.ts`), "look along this pixel's ray" and "Show" camera moves; validated with 3 Basel features (14.8 / 104.3 / 180.3 px under the assumed model); `docs/xgrids/correspondences.md`; sections 4, 5.12, 7, 8, 9, 11 |
| 13V | Experimental camera calibration: `backend/camera_calibration.py` (export validation + run cross-check, audit flags, Stage A rotation / Stage B rotation + f with SciPy robust least squares, leave-one-event-out, sensitivity, identifiability limits, deterministic experiment JSON v1, photo-vs-LiDAR NCC check), stateless `POST /xgrids/calibration/audit` + `/experiments`, `scripts/xgrids/calibrate_cameras.py`, `tests/xgrids/test_camera_calibration.py` (20 tests), `scipy 1.18.1`; third mode "Calibration optimization" on `/camera-calibration` (`CalibrationOptimizationSection`, `useCalibrationOptimization`, `lib/calibrationExperiment.ts`; display-only viewer, presets untouched); Basel: f ≈ 927 / 955 px/rad, held-out median 80 → 28 px (ch14) and 66 → 35 px (ch18), better on 42 of 48 unseen photos; principal point, lever arm and distortion still unknown; `docs/xgrids/calibration-experiments.md`; sections 3.1, 4, 5.12, 7, 8, 9, 11 |
| 13V.1 | Docs only: hardware reference photographs of the K1 (Livox MID-360, two opposing wide-angle imaging modules) recorded as supporting evidence for the ±90° directions; zero lever arm stated as temporary; future measured/estimated camera-to-scanner translation required; no translations, channel assignment or intrinsics inferred from photos; `calibration-notes.md`, `calibration-experiments.md`, section 5.12 |
| 13W | Correspondence review and dataset preparation: optional record fields `excludedFromFit` / `reviewStatus` / `scene` / `history` (frontend and backend validation, ids kept), `lib/correspondenceReview.ts` (Lab 13V Stage B reference, flags mirroring the audit, Lab 13V review list #1/#5/#11/#16, reliable-only coverage), `CorrespondenceReview.tsx` (review list with Exclude/Restore, review status, scene, corrections with history, filters; per-camera SVG coverage diagram, 15–25 target, guidance, "not complete" note), scene select and other-event coverage markers; backend `user-excluded` / `needs-fix` flags, `imageRegion`, unknown exclude/include ids refused, CLI prints missing values; `scripts/xgrids/compare_experiments.py`; Basel: without #1/#5/#16 ch14 Stage B moves < 1 σ and its roll/f σ shrink about 3×, but held-out and photo checks don't improve; the ≥ 3 m subset is too small to fit or validate; 22 calibration tests; sections 4, 5.12, 7, 8, 9, 11 |
| 13W.1 | Latest experimental baseline from the user's reviewed export (#1/#5/#16 corrected, #11 deleted, one match added, others re-picked; all validated): Stage B `x_c69aede71834`, held-out medians 18 / 16 px (13V: 28 / 35), f ≈ 961 for both cameras, shifts < 1 σ, photo check unchanged; pointer file `baseline-latest-2026-10-15.json` outside the repo, 13V kept; `BASELINE_STAGE_B` replaces `LAB_13V_STAGE_B` as the built-in review reference; Lab 13V flags clear on corrected records; dataset still not complete; sections 4, 5.12 |
