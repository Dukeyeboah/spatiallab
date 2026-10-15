# XGRIDS camera calibration notes

What is and is not known about the camera geometry of the LixelKity K1 recording. **No calibration has been done yet.** The extracted images can't be used as posed photographs for Gaussian training until it is.

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

## Provisional (Lab 13S, manual visual extrinsics hypothesis test)

- **Directions:** relative to the scanner body (X forward, Y left, Z up), **ch14 looks left** and **ch18 looks right**, both roughly level. Best single offsets over 14 events: ch14 yaw −90°, ch18 yaw +100° (±10°), pitch 0° and roll 0° for both. Yaw + = right; see [calibration-workspace.md](calibration-workspace.md#direction-hypothesis-test-lab-13s) for conventions, method and caveats.
- **Not a calibration:** an assumed equidistant lens, no lever arm, a 10° search grid and one recording.

## Correspondences (Lab 13U)

- `/camera-calibration` has an **Image ↔ LiDAR correspondences** mode that stores manually picked pixel (original 4000 × 3000 coordinates) ↔ LAS point pairs, with the event, image, exact timestamp and scanner pose. See [correspondences.md](correspondences.md).
- Its projection overlay uses an **assumed** equidistant model (f = 750 px/rad, centre (1999.5, 1449.5)) and the provisional rotations. Its pixel errors are diagnostics, not calibration results. First three validation records: 14.8, 104.3 and 180.3 px.

## Unknown

- **Extrinsics:** camera-to-scanner rotation and translation for each camera. The manifest says `camera_extrinsics = unknown`. Only the rough viewing directions are narrowed down (above).
- **Intrinsics:** the fisheye model and its parameters (focal length, principal point, distortion) for each camera.
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
