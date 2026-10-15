# XGRIDS camera calibration notes

What is and is not known about the camera geometry of the LixelKity K1 recording. **No verified calibration exists.** Lab 13V made first *experimental* estimates of the rotations and one focal parameter (below). The extracted images can't be used as posed photographs for Gaussian training until a validated calibration exists.

## Known

- **Images:**
  - two camera streams, XBAG channels `ch14` and `ch18`;
  - 4000 × 3000 each, 8-bit `yuv420p` H.264 intra frames;
  - one synchronised pair every 0.3 s; within a pair, channel 18 comes first, typically 17 µs earlier (at most 213 µs) ([xbag-format.md](xbag-format.md)).
- **Lens type:** the early experiments describe the images as fisheye. No lens model has been fitted.
- **`project.json`:** lists cameras `["left_main", "", "right_main", ""]`. The mapping to channels 14 and 18 is not established.
- **Scanner poses (`poses.csv`):**
  - columns `t, x, y, z, qx, qy, qz, qw` (scalar last), every 100 ms;
  - expressed in the LAS point cloud's frame (checked in Basel.2; see the rebuild guide, section 7, "Basel House");
  - they describe the scanner's SLAM reference frame (probably the LiDAR/IMU body), **not** either camera.
- **Pose interpolation:** `extract_frames.py` interpolates the scanner pose at each image timestamp (XYZ linear, quaternion SLERP).
  - Between samples the scanner moves up to 105 mm (median 32 mm) and turns up to 11.6° (median 1.2°).
  - Linear and SLERP interpolation assume smooth motion within those 100 ms.

## Hardware reference photographs (October 2026)

Photographs of the LixelKity K1 used for the Basel House capture show a **Livox MID-360** LiDAR and **two opposing imaging modules**. Each module has a prominent wide-angle lens and a smaller optical component next to it.

This is **hardware reference evidence, not a calibration measurement**:
- **Directions:** the opposing arrangement supports the provisional ≈ ±90° yaw hypotheses (Lab 13S) and the Lab 13V estimates (ch14 ≈ −88°, ch18 ≈ +89°).
- **Lever arm:** the lens centres are visibly away from the scanner pose reference point (the SLAM body frame, probably the LiDAR/IMU). The zero lever arm used in Labs 13U and 13V is therefore a **temporary assumption**, not a property of the device.
- **Not inferred from the photos:**
  - camera translations, which need measurement or estimation;
  - which module is ch14 and which is ch18;
  - lens intrinsics (focal parameter, principal point, distortion);
  - what the smaller optical components are.
- **Needed later:** a camera-to-scanner translation per camera, either measured (manufacturer drawings or a factory calibration file, or a careful physical measurement related to the pose reference point) or estimated (a validated lever-arm stage with more, farther and better-spread correspondences). Until then, points closer than about 3 m carry the largest unknown error (a 5 cm offset shifts a point at 1 m by about 2.9°, ≈ 47 px at f ≈ 940).

## Provisional (Lab 13S, manual visual extrinsics hypothesis test)

- **Directions:** relative to the scanner body (X forward, Y left, Z up), **ch14 looks left** and **ch18 looks right**, both roughly level. Best single offsets over 14 events: ch14 yaw −90°, ch18 yaw +100° (±10°), pitch 0° and roll 0° for both. Yaw + = right; see [calibration-workspace.md](calibration-workspace.md#direction-hypothesis-test-lab-13s) for conventions, method and caveats.
- **Not a calibration:** an assumed equidistant lens, no lever arm, a 10° search grid and one recording.

## Correspondences (Lab 13U)

- `/camera-calibration` has an **Image ↔ LiDAR correspondences** mode that stores manually picked pixel (original 4000 × 3000 coordinates) ↔ LAS point pairs, with the event, image, exact timestamp and scanner pose. See [correspondences.md](correspondences.md).
- Its projection overlay uses an **assumed** equidistant model (f = 750 px/rad, centre (1999.5, 1449.5)) and the provisional rotations. Its pixel errors are diagnostics, not calibration results. First three validation records: 14.8, 104.3 and 180.3 px.

## Experimental estimates (Lab 13V)

From 19 correspondences (9 usable per camera, 8 events), fitted with robust least squares and validated by leaving one event out. Full method and numbers: [calibration-experiments.md](calibration-experiments.md).

- **Focal parameter:** f ≈ 930–960 px/rad for both cameras (ch14 927 ± 41, ch18 955 ± 15), not the assumed 750. Held-out median errors fall from 80 → 28 px (ch14) and 66 → 35 px (ch18). On 24 photos per camera that no point came from, the LiDAR lines up better with the photo in 20/24 (ch14) and 22/24 (ch18).
- **Rotations** (yaw, pitch, roll): ch18 ≈ (+89.4°, +4.0°, +0.6°), each passing the identifiability limits; ch14 ≈ (−88.3°, +3.0°, −1.3°), with roll and f poorly constrained.
- **Still assumed or unknown:** principal point (image centre assumed), lever arm (0 assumed), distortion beyond equidistant, timing. Not identifiable from these points, most of which are closer than 3 m.
- Nothing in the app uses these values automatically; the Lab 13U presets are unchanged.
- **Lab 13W check:** refitting without the suspicious ch14 matches (#1, #5, #16) moves these values by under 1 σ but shrinks ch14's roll and f uncertainty about 3×. The estimates stand; the dataset is the limiting factor. An expanded, hand-verified set of 15–25 reliable matches per camera is being collected; until then the dataset is **not complete**.
- **Latest experimental baseline** (`x_c69aede71834`, the user's reviewed export of 2026-10-15). Details are in [calibration-experiments.md](calibration-experiments.md#latest-experimental-baseline-reviewed-export-experiment-x_c69aede71834-2026-10-15).
  - ch14 is about (−89.0°, +2.9°, +0.4°) with f 961 ± 8; ch18 is about (+89.4°, +4.3°, +0.8°) with f 962 ± 10. Every parameter passes the identifiability limits and moved by less than 1 σ from 13V.
  - Held-out median errors are 18 px (ch14) and 16 px (ch18); the photo check is unchanged.
  - It is still experimental: the lever arm is assumed zero, and the dataset is not complete.
- **Used by Lab 14A** ([splat-dataset.md](splat-dataset.md)): the first Gaussian splatting dataset takes this Stage B (rotations and f) as given.
  - **Lever arm:** 0, labelled as an assumption in its manifest.
  - **Consequence:** about 0.7° of inconsistency at 4 m for a 5 cm offset.
  - **Measured residual:** the correspondence residual seen in its perspective views is 0.74° (median).

## Unknown

- **Extrinsics:** camera-to-scanner translation (lever arm) for each camera; the rotation has only experimental estimates (above). The manifest says `camera_extrinsics = unknown`.
- **Intrinsics:** principal point and distortion for each camera; the focal parameter has only an experimental estimate (above).
- **Timing:**
  - whether image timestamps mark the start, middle or end of the exposure;
  - exposure time, and rolling-shutter readout, if any;
  - any offset between the camera clock and the pose clock.
- **Factory calibration:** whether the device stores one, and in which file. Not yet inspected: `project_data/log/lixel.zip`, `data.ulg`, and the undecoded XBAG channels.

## Inspection workspace (Lab 13R)

`/camera-calibration` shows each extracted pair next to the scanner pose in the LiDAR scene, with intrinsics and extrinsics marked unknown and only provisional, unsaved orientation sliders. See [calibration-workspace.md](calibration-workspace.md) for how to run it, what it checks and the planned calibration steps.

## Consequences

- **Not camera poses.** The `scanner_*` columns are the scanner pose at the image time, not camera poses. Using them as camera poses would put every image off by the unknown lever arm and rotation, and at 0.3 m/s also by any timing offset.
- **Required before training:** fisheye intrinsics, and the extrinsics for both cameras, by calibration or by structure-from-motion with a fisheye camera model. Then validation: reproject LiDAR points into the images.
