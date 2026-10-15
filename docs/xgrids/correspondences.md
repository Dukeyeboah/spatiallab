# Image ↔ LiDAR correspondences (Lab 13U)

A mode of `/camera-calibration` for collecting **manual 2D ↔ 3D correspondences**: one feature clicked in an original XGRIDS fisheye image and the same feature picked in the LiDAR scan. The records are the input for a later calibration lab (intrinsics, extrinsics, PnP). **Nothing here is a calibration.** The optional projection overlay and its pixel errors use an *assumed* lens model and the *provisional* Lab 13S rotations; they are diagnostics only.

Reference conventions: [provisional-camera-directions.json](provisional-camera-directions.json) (unchanged by this lab). Running the page: [calibration-workspace.md](calibration-workspace.md).

## Workflow

1. In the panel, set **Workspace mode → Image ↔ LiDAR correspondences**.
2. Choose an event: the suggested chips (3877, 2497, 3037, 4718), or any event via ◀ / ▶ / slider / "Sequence … Go". Choose **ch14** or **ch18**.
3. In the image viewer (right): wheel = zoom about the cursor, drag = pan, click = pick. Fit / 100 % / 400 % buttons; Large / Small layout. The footer shows the cursor's original pixel coordinates. A yellow cross-hair marks the pending pixel.
4. Optionally **"Look along this pixel's ray in 3D"**: the viewer camera moves to the scanner position at that image's time and looks along the pixel's provisional ray, with the orbit target at the LiDAR surface along the ray (10th-percentile range within 1.5°; 3 m if none). The ray uses the assumed model and provisional rotation, so the feature is *near* the centre, not exactly on it.
5. **"Pick in 3D"** arms LiDAR picking (cross-hair cursor; orbiting still works, a press that moves more than 4 px is a drag, not a pick). Click the feature. The preview shows the nearest point (white) and, when accepted, the ray ∩ plane point (green); the chosen one has a yellow halo. Choose which to keep.
6. Describe the feature, set quality (good / fair / poor), optional notes, **Save correspondence**. The button lists anything still missing.
7. Saved records: numbered markers in the image (cyan circles) and in 3D (cyan spheres, `#n` labels), only on the matching image and dataset. Each record has **Show** (switches to its event and channel, views its LiDAR point from the scanner), **Edit** (feature, quality, notes; replace the pixel or the LiDAR point with a new pending one), **Exclude / Restore** and **Delete** (with confirmation). Lab 13W added review details, flags and coverage: see [Review and coverage](#review-and-coverage-lab-13w).
8. **Export JSON** regularly. Records live in this browser's localStorage (`spatial-lab.correspondences.v1`); the exported file is the durable copy. **Import JSON** (≤ 5 MB) validates every record and skips ids already present.

**Good features:** sharp, point-like and the same in both data sources: building corners, window and door corners, roof eave ends, the corners of flat signs on walls. Prefer features **3 m or more** from the camera (see limits), spread across the whole image circle and both channels. Avoid moving or thin things (people, foliage, wires), sky edges, and anything the LiDAR barely sampled.

## LiDAR picking

`lib/pointPicking.ts`, in screen space on the loaded budget (1M or 5M preview):

1. All dataset points are projected with the current camera; candidates are those within **8 px** of the click (setting).
2. **Front surface only:** candidates deeper than `min + max(0.15 m, 2 % of min)` are dropped, so a click never reaches through a wall.
3. **Nearest point (always available, approximate):** the front candidate closest to the cursor. It is a real scan point, but not necessarily the clicked spot: up to the point spacing off, and on edges it may be on either side. Recorded as `method: "nearest-point"` with `detail: "approximate: …"`.
4. **Ray ∩ local plane (optional refinement):** a PCA plane through the points within **6 cm** (setting) of the nearest point, intersected with the click ray. Refused, with the reason shown, when:
   - fewer than 12 points are in the neighbourhood;
   - the fit is not planar: rms above `max(4 mm, 0.11 × radius)` (edges, corners, clutter). The Basel preview's planar noise is about 6 mm at 5 cm; an ideal corner gives about 0.19 × radius;
   - the surface is seen almost edge-on (|n · ray| < 0.15);
   - the intersection is more than 1.5 × radius from the nearest point.

   Recorded as `method: "ray-plane"` with the neighbour count, rms and shift.

Corners and edges, the best features, are exactly where the plane refinement refuses; the nearest point is then the honest answer, labelled approximate.

**Coordinates.** Points in the viewer are dataset coordinates (LAS − the dataset's `coordinateCenter`, stored as float32). A pick is converted back in float64: `LAS = dataset + coordinateCenter`. Only LAS coordinates are saved, never viewer or dataset coordinates. The record keeps the budget the pick was made on.

## Record schema (version 1)

Export file:

```json
{
  "schema": "spatial-lab/xgrids-correspondences",
  "version": 1,
  "exported": "ISO time",
  "calibrationStatus": "provisional",
  "dataset": { "id": "builtin-basel-house", "name": "…", "posesSha256": "ba621b73…" },
  "conventions": { "reference": "…", "pixel": "…", "lidar": "…", "scannerPose": "…", "camera": "…" },
  "projectionUsedForDiagnostics": {
    "model": { "model": "equidistant", "focalPx": 750, "cx": 1999.5, "cy": 1449.5, "validRadiusPx": 1400, "status": "assumed" },
    "offsets": { "ch14": { "yawDeg": -90, "pitchDeg": 0, "rollDeg": 0 }, "ch18": { "yawDeg": 90, "pitchDeg": 0, "rollDeg": 0 } },
    "note": "…",
    "perRecord": [{ "id": "c_…", "predicted": { "u": 0, "v": 0 }, "errorPx": 0, "invalidReason": null }],
    "stats": { "count": 0, "mean": null, "median": null, "rms": null }
  },
  "correspondences": [ /* records */ ]
}
```

Record (`Correspondence` in `lib/correspondences.ts`):

| Field | Meaning |
| --- | --- |
| `id` | `c_` + 12 hex characters, unique, kept on import |
| `datasetId`, `posesSha256` | the LiDAR dataset and the SHA-256 of its `poses.csv`, which identifies the LAS frame (Lab 13R frame check) |
| `runId`, `sequence`, `channel`, `imageFile` | the extraction run, XBAG sequence, `ch14`/`ch18` and the JPEG's file name |
| `timestampUs` | the image's exact timestamp, integer µs UTC |
| `imageWidth`, `imageHeight` | 4000 × 3000 as recorded; picking is disabled unless the loaded image has this size |
| `pixel {u, v}` | original image pixels, 0.01 px resolution |
| `lidar {las, method, detail, budget}` | LAS metres; `nearest-point` (approximate) or `ray-plane`; how it was obtained; `1m`/`5m` |
| `scannerPose {position, quaternion}` | the run's interpolated scanner pose at the image time (LAS, xyzw), copied for the next lab. **Not a camera pose.** |
| `feature`, `quality`, `notes` | description; `good` / `fair` / `poor`; free text |
| `calibrationStatus` | always `"provisional"` |
| `created`, `updated` | ISO times |
| `excludedFromFit` *(optional, Lab 13W)* | `{reason ≤ 500 chars, at}` or null: left out of calibration fits by default, record kept |
| `reviewStatus` *(optional, 13W)* | `unreviewed` (default) / `verified` / `needs-fix`: your own verdict after looking |
| `scene` *(optional, 13W)* | `courtyard` / `corridor` / `indoor` / `exterior` / `other` |
| `history` *(optional, 13W)* | ≤ 100 entries `{at, action: pixel / lidar / exclude / restore, previous}`; corrections keep the id and log the replaced value |

The optional fields are still schema version 1: older files load unchanged, and the backend (`camera_calibration.record_problem`) validates the same fields.

**Validation on import** (`invalidReason`): wrong `schema` or `version` rejects the file; each record needs a safe id, string fields (≤ 2000 characters), a channel matching `ch<digits>`, non-negative integer sequence/timestamp/size, a pixel inside `[−0.5, W − 0.5] × [−0.5, H − 0.5]`, a finite LAS triple, a known method, a finite pose and quaternion, a known quality and `calibrationStatus: "provisional"`. Invalid records are listed and not imported.

## Conventions

- **Pixels:** OpenCV. u right, v down, (0, 0) is the centre of the top-left pixel, so the image spans [−0.5, W − 0.5]. The viewer maps `screen = (pixel + 0.5) · scale + translation`; clicks are converted back exactly.
- **LiDAR:** original LAS coordinates, metres.
- **Scanner pose:** `v_LAS = R(q) · v_body`, q = (x, y, z, w); body X forward, Y left, Z up (as in Lab 13S).
- **Camera (provisional):** X = optical axis, Y = image left, Z = image up; `v_body = R_off · v_cam`, `R_off = Rz(−yaw) · Ry(−pitch) · Rx(roll)`, the offsets of the direction-hypothesis panel. Lever arm assumed 0.

## Provisional projection overlay

`lib/fisheyeProjection.ts`. Optional; off by default.

- **Model (assumed):** equidistant fisheye, r = f · θ, around (cx, cy):
  `u = cx + f·θ·(−y/s)`, `v = cy + f·θ·(−z/s)`, with (x, y, z) the point in the provisional camera frame, s = √(y² + z²), θ = angle from the optical axis.
- **Defaults:** f = 750 px/rad, (cx, cy) = (1999.5, 1449.5), usable radius 1400 px (θ ≤ 107°). Rough fits to the image circle, **not** manufacturer or calibrated intrinsics; all four are editable and every export records the values used.
- **Rotation:** the current direction-hypothesis offsets (start ch14 (−90°, 0, 0), ch18 (+90°, 0, 0)); "Use Lab 13S best" sets (−90°, +100°).
- **Camera centre:** the scanner position (lever arm unknown, assumed 0).
- **Overlay:** LiDAR points within 20 m, up to 400 000 samples, drawn far → near, coloured red (near) to blue (far); a dashed usable circle and the principal-point cross.
- **Invalid points are hidden, never clamped:** a point at the camera centre or outside the usable radius has no pixel and no error.
- **Errors:** for each saved record with a valid prediction, observed vs predicted pixel and the distance in px (a red × with a dashed residual line in the image). Per channel and overall: count, mean, median, RMS and the number of invalid predictions. Statistics only from valid projections.

A small error does not make anything calibrated: the model has no distortion terms, the camera centre ignores the lever arm and the rotation is a 10° hypothesis.

## Validation (Basel House, October 2026)

Run with the 5M preview, `interval-10s`, default model and offsets ch14 −90°, ch18 +90°.

| # | Event | Feature | Pixel | LAS (m) | Pick | Predicted | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2497 ch14 | left end of the long roof eave | (1987.61, 1307.82) | (−8.690, −17.026, 0.875) | nearest (plane refused: corner, rms 12 mm) | (2002.3, 1309.7) | 14.8 px |
| 2 | 2497 ch14 | gable apex of the red-walled building | (2599.35, 1062.06) | (−22.318, −18.396, 5.465) | nearest (1 point within 6 cm, ~20 m away) | (2511.1, 1117.5) | 104.3 px |
| 3 | 3037 ch18 | top-left corner of the white notice board | (2652.79, 1516.45) | (−18.237, −15.809, −0.249) | nearest (6 points within 6 cm) | (2481.3, 1460.9) | 180.3 px |

All: mean 99.8, median 104.3, RMS 120.5 px (ch14: 59.5 / 59.5 / 74.5; ch18: 180.3).

**Checks:**
- **Pixels are original coordinates:** clicks agree with the viewer's transform maths to within 0.5 px, and the image is checked to be the manifest's 4000 × 3000 before picking is enabled.
- **LAS coordinates:** independently, in Python, each saved LAS point equals a 5M preview point + `coordinateCenter` (0.000 mm), each `scannerPose` equals the manifest row for that image file, sequence, channel and timestamp.
- **Round trip:** the Python projection (Lab 13S rotation helpers, same model) reproduces every predicted pixel and error to 0.1 px, and the overall statistics exactly. Earlier unit checks: TypeScript vs Python projection on 600 random points, 0 validity mismatches, max 7.6 · 10⁻⁷ px; the inverse (pixel → ray) to 10⁻⁶°.
- **Feature 3 cross-check:** a LiDAR-RGB rendering through the same model, compared with the photograph, showed the notice board about (−145, −60) px from where the photo has it, matching the app's residual (−172, −55). The large error is the model and rotation, not the bookkeeping.
- **Event switching:** switching between 2497 and 3037 and between channels kept all records; image markers appear only on their own image (no markers on 3037 ch18 while only the two 2497 records existed; #1 and #2, not #3, on 2497 ch14 after "Show").
- **Edit, delete, import:** quality edit kept `created` and advanced `updated`; delete asks for confirmation (cancel keeps the record); exporting, deleting #2 and importing the export restored #2 and reported "Imported 1, skipped 2 already present"; a file with a wrong schema was rejected.
- **Unit checks** (`lib/pointPicking.ts`): eigen-decomposition equals numpy; a synthetic wall gives the plane point exactly (nearest 3.7 mm off); a noisy wall (5 mm) refines to 0.5 mm; a corner is refused.
- **Existing features:** the direction-hypothesis mode, its helpers and the camera-pair panel render as before when that mode is selected.

**Single-point hint (not a result):** with ch18 at +100° ("Lab 13S best"), feature 3's error grows to 307.5 px; at +90° it is 180.3 px. The one ch18 point leans toward a yaw below +90°; it needs many more correspondences before it means anything.

**Event 3877 is a poor test event.** Its ch14 view is dominated by a window about 0.5 m from the camera. The LiDAR there is sparse (no point within 1° of the clicked ray), and with an unknown lever arm of a few centimetres, parallax at 0.5 m reaches about 11° per 10 cm. Features ≥ 3 m away keep the lever-arm effect below about 2°.

## Limits

- **Provisional only.** The model, f, principal point and rotations are assumed; no record or error is a calibration result.
- **Lever arm unknown.** The projection puts the camera at the scanner position. Close features are affected most.
- **Nearest-point picks are approximate**, up to the local point spacing (centimetres at 5–20 m in the 5M preview). The full LAS is not loaded; picks are on the preview.
- **Timing:** the scanner pose is interpolated at the image timestamp; exposure timing and rolling shutter are unknown.
- **Storage is per browser.** Export to keep records; clearing site data deletes them.
- **No automatic registration**, no nonlinear calibration and no Gaussian training here (out of scope for Lab 13U).

## Using an export for calibration (Lab 13V)

An exported file is the input of the calibration experiments ([calibration-experiments.md](calibration-experiments.md)): load it in the *Calibration optimization* mode or pass it to `scripts/xgrids/calibrate_cameras.py`. The file is only read; its SHA-256 identifies it in every result. Keep a read-only copy outside Git (e.g. `<recording>/reconstruction/xgrids/calibration/inputs/`). The audit flags points that are behind the camera, closer than 3 m, on things that may move, near the image edge, or (with the point cloud) isolated or occluded; it never deletes them. Records you excluded during review (`excludedFromFit`) are left out by default (flag `user-excluded`); `--include ID` still forces one in.

## Review and coverage (Lab 13W)

The saved list in the correspondence mode is now a **review list** (`components/calibration/CorrespondenceReview.tsx`, logic in `lib/correspondenceReview.ts`).

**Reference parameters.** Errors and flags use, in order: the Stage B set of an experiment loaded in the *Calibration optimization* mode for this dataset and pose file; else the built-in latest experimental baseline (Stage B of experiment `x_c69aede71834`, which replaced Lab 13V's `x_652068cf70da` on 2026-10-15) for the Basel House export; else the provisional rotations with the assumed lens. The panel names the reference. All are experimental or assumed, never a verified calibration.

**Per match:** event and channel, pixel and LAS XYZ, pick method, distance from the scanner and height relative to it, image region (centre / middle / outer = thirds of the 1400 px usable radius; "outside" beyond it), angle from the camera axis, reference error, quality, scene, notes, your review status, and whether it is in fits.

**Flags** (nothing is deleted; the rules match the backend audit):

| Severity | Flag | Rule |
| --- | --- | --- |
| excluded from fits | user-excluded | you pressed *Exclude* (reason kept) |
| | wrong-side | LiDAR point > 110° from the reference camera axis |
| | too-close | < 0.2 m from the scanner |
| warning (in fits, not counted as reliable) | Lab 13V list | #1, #5, #11, #16 of the 2026-10-15 export, until marked *verified*, excluded, or corrected (a pixel or LiDAR change in the history) |
| | needs-fix | your review status |
| | close-range | < 3 m: a 5 cm lever arm moves the pixel by f·0.05/d |
| | may-move | vehicle, person, curtain, plant … in the feature or notes |
| | quality | fair or poor |
| | large-error | > max(3 × the channel's median, 40 px) under the reference |
| | no-projection, duplicate | no valid reference prediction; same LAS point within 2 cm or same image pixel within 5 px |
| info | image-edge | > 90 % of the usable radius (useful, but check it) |

**Reliable** = in fits with no warning. **Coverage** counts only reliable matches per camera against a 15–25 target. It shows events, image regions, eight image directions (middle and outer rings), distance bins (< 3, 3–4, 4–15, > 15 m), height (above / level / below the scanner, ±0.3 m) and scenes, and draws them over the fisheye frame (shaded cells hold reliable matches; dots green reliable, amber flagged, grey excluded, red ring = Lab 13V list; click a dot to show it). The guidance names the gaps and never asks for a match you're unsure of.

**Actions:** *Show* (switches to the event and channel and views the LiDAR point from the scanner), *Edit* (feature, quality, scene, review status, notes; replace the pixel with a new click in the same image or the LiDAR point with a new pick; the history keeps previous values), *Exclude* (asks for a reason) / *Restore*, *Delete* (confirms; prefer Exclude). Filters: all / to review / excluded / this event. *Mark this camera's matches from other events* draws grey circles on the image to show the spread. A scene selector sits next to quality in the new-match form.

The expanded real-world dataset is **not complete** until new matches have been collected and verified by hand; the panel says so.
