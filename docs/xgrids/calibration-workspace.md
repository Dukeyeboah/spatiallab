# Camera calibration workspace (Lab 13R, phase 1)

A separate page, `/camera-calibration` (Lab 13R, extended by the direction test of Lab 13S), for inspecting the XGRIDS camera pairs against the LiDAR scan. It shows one capture event at a time: both fisheye images, their exact timestamps, and the scanner pose at that moment as a marker in the point cloud. **It is not a calibration.** Camera intrinsics and extrinsics stay unknown (see [calibration-notes.md](calibration-notes.md)); the orientation sliders are a labelled experiment.

The main LiDAR viewer (`/`) is unchanged apart from a link to this page.

## Running it locally

The images are never part of the Next.js app or of Git. They stay in the extraction runs written by `scripts/xgrids/extract_frames.py` (Lab 13Q), and the local backend serves them.

1. Extract at least one run (see [scripts/xgrids/README.md](../../scripts/xgrids/README.md)). Runs live in `<recording>/reconstruction/xgrids/images/<run>/`, each with a `manifest.csv`.
2. Start (or **restart**) the backend with that images folder:

   ```bash
   cd backend
   SPATIAL_LAB_XGRIDS_DIR="$HOME/Downloads/BM_Heritage_Basel_House_2026-07-15-101012/reconstruction/xgrids/images" \
     .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
   ```

   A backend started before Lab 13R has no `/xgrids` endpoints; the page then says so.
3. Start the frontend (`npm run dev`) and open <http://localhost:3000/camera-calibration>, or follow "Lab 13R: Camera Calibration →" in the viewer's panel.

The LiDAR side uses the built-in Basel House preview and its `poses.csv` in `public/datasets/basel-house/` (gitignored, see the rebuild guide).

## Data flow

| Piece | Where | What it does |
| --- | --- | --- |
| `backend/xgrids_runs.py` | backend | Lists the runs in `SPATIAL_LAB_XGRIDS_DIR`, parses one run's `manifest.csv` strictly (required columns, integer timestamps below 2⁵³) and groups it into events. Returns file names and SHA-256 values, never absolute paths. |
| `GET /xgrids/runs` | backend | `{configured, rootExists, runs: [{id, mode, eventCount, imageStatus, source} or {id, error}]}` |
| `GET /xgrids/runs/{run}` | backend | The run's events: per channel the file, timestamp, decoder status, JPEG size/SHA-256, dimensions, the interpolated scanner pose and `extrinsics: "unknown"`. 404 for unknown runs, 422 for unreadable manifests. |
| `GET /xgrids/runs/{run}/images/{file}` | backend | One JPEG, only if it is listed in that run's manifest and lies inside that run's folder (no paths from the URL are trusted). |
| `lib/xgrids.ts` | frontend | Types and fetches for the above, `sha256Hex`, `positionAt` (the dataset's own poses at a time). |
| `lib/calibration.ts` | frontend | Calibration state per camera (`unknown` for both) and the provisional orientation maths. |
| `components/calibration/` | frontend | `CalibrationPanel` (left), `CameraPairPanel` (images), `CalibrationLayers` (marker, event dots, provisional arrows, camera moves) inside the LiDAR group of `SpatialScene`. |

## What the page shows

- **Run picker.** All runs found by the backend; `interval-10s` is preferred when present.
- **Frame check.** The run's `extraction-summary.json` records the SHA-256 of the `poses.csv` used for interpolation. The page hashes the dataset's own `poses.csv` and shows markers only if the two are identical. Then the run's `scanner_*` values are original LAS coordinates of this scan, and the viewer places them with the dataset's offset (LAS − `coordinateCenter`) and the documented Z-up → Y-up rotation, like every other layer. Choosing `map.las` shows the mismatch and hides the markers and the viewer position.
- **Event selection.** ◀ / ▶, a slider, a "Sequence … Go" field that jumps to the nearest extracted event (and says so when the exact sequence isn't in the run), or clicking an event dot in the scene.
- **Event facts.** Event n / N, sequence, each channel's UTC time and exact µs timestamp, and Δt (ch18 − ch14), typically −17 µs, meaning ch18 is first.
- **Scanner pose.** Interpolated at the earliest image of the pair (ch18): LAS position, position in the viewer, quaternion xyzw, and the interpolation fraction between the two bracketing pose samples.
- **Marker check.** The page interpolates the dataset's own poses at the same timestamp and shows the distance to the run's position (µm when below 1 mm). This independently confirms that the marker sits where the scanner was at the image time.
- **Marker.** The scanner body (red X forward, green Y left, blue Z up), a white halo, and all events of the run as small dots (the selected one white). Everything is drawn on top of the cloud, so it stays visible inside walls. The trajectory's green sphere marks where the scan started.
- **Images.** ch14 and ch18 side by side, as recorded (fisheye, not undistorted), Hide / Small / Large, each linking to the full-resolution JPEG. Each caption checks that the file name encodes this event's sequence, channel and timestamp and that the decoded size equals the manifest's (✓ or ⚠).
- **Calibration status.** Intrinsics and extrinsics for both channels: `unknown`.
- **Direction hypothesis test (Lab 13S).** Per-channel yaw / pitch / roll offsets with direction helpers, presets, a fixed test set and notes; see the next section. "Look along ch14/ch18" puts the viewer camera at the scanner and looks along that channel's helper, in a perspective view.

## Direction hypothesis test (Lab 13S)

A **manual visual extrinsics hypothesis test**: does one fixed pair of camera-to-scanner rotations make each channel's helper point where the centre of that channel's fisheye image looks, across many events? It is not calibration. There is no lens model, no lever arm and no timing offset, and the result is a direction to within about 10°.

**Offsets.** Per channel, in degrees, in the scanner's body frame (X forward, Y left, Z up), applied in this order:
- yaw about Z: + = right, −90 = left;
- pitch about the new Y: + = up;
- roll about the viewing axis: + = clockwise seen from behind the camera.

The body axes were checked against `poses.csv`: +X is the walking direction (78% of motion), +Z is up (0.98 along world up). The panel prints each result in words ("left 90°, level"). Defaults are the starting hypothesis ch14 = (−90, 0, 0) and ch18 = (+90, 0, 0); they are not a claim. The math is in `lib/calibration.ts`.

**In the scene**, per channel:
- an origin dot at the scanner position;
- a dashed centre ray;
- a translucent cone with adjustable length (0.5–10 m) and half-angle (5–85°). The cone only says "roughly this way"; the lens's real field of view (> 180°) is unknown;
- an image-up tick and a label (orange ch14, purple ch18);
- an optional labelled X forward / Y left / Z up gizmo at the scanner.

**In the panel:**
- Sliders and number inputs per angle.
- "Reset both to ±90°".
- "Mirror ch14 → ch18" and the reverse: opposite yaw and roll, same pitch.
- "Swap ch14 ↔ ch18", which tests the opposite channel interpretation.
- Named presets, kept in this browser's localStorage.
- The test set: chips and ◀/▶ over the Basel events below.
- Per-event notes: a verdict per channel (✓ centre matches / ≈ roughly / ✗ no / ?) and free text, saved with the offsets in use. Chips are coloured by verdict.
- "Export notes + presets (JSON)".

**In the images**, a green cross-hair marks each image's centre, the best clue to the optical axis; the fisheye circle is centred within a few per cent. The edges are distorted and partly blocked by the operator.

**Test set** (`lib/directionTest.ts`, all in `interval-10s`):
- seeds 2497, 2527 and 3037;
- courtyard 2466, 2557, 2646, 2706, 2766, 2827, 3007 and 3067 (no LiDAR point within ±1 m horizontally above the scanner);
- indoor 1335 (veranda), 4718 (upstairs corridor) and 7178 (ceiling about 2.2 m above the scanner).

### Result on Basel House (October 2026)

Machine-readable export (offsets, matrices, conventions, observations): [provisional-camera-directions.json](provisional-camera-directions.json).

**Method.** Besides inspecting the tool by eye, each test image was compared numerically with the coloured 5M LiDAR, rendered through an assumed equidistant fisheye. The settings:
- 160 × 120 px images; centre (80, 58); f = 30 px/rad, an assumption;
- yaw every 10° over the full circle, pitch −50 to +50°;
- per event, the grey-level correlation (NCC) is standardised as a z-score; one offset per channel is then chosen by the mean z-score over all 14 events.
- A finer check of yaw ±10°, pitch ±10° and roll −30…+30° was run on 5 events (the 3 indoor, 2497, 2706).

The throwaway scripts stayed outside the repository.

**Findings.**
- **Direction.** One fixed pair works across the test set, and the starting hypothesis is directionally right:
  - ch14 is best at yaw −90° (neighbours −80° and −100°), pitch 0°;
  - ch18 is best at yaw +100° (neighbours +90° and +110°), pitch 0°;
  - roll is best at 0° for both, falling off steadily by ±20°.
- **Alternatives score far lower.** Mean z-scores: the starting pair 1.48 (ch14 at −90°) and 1.40 (ch18 at +90°); ch14 looking right 0.11, ch18 looking left 0.30; forward or backward 0.17–0.89.
- **Best provisional offsets:** ch14 (−90°, 0°, 0°), ch18 (+100°, 0°, 0°), i.e. not exactly mirror-symmetric. The 10° difference is at the resolution of the test; treat ch18 as +90…+105°.
- **Per event**, about 9 of 14 peak within ±20° of these values for each channel. The exceptions are mostly open courtyard views (2766, 3007, 3067, and ch18 at 2527, 2557, 2827). There sky and symmetric façades make the score flat or pull it toward steep upward views. The indoor events are the clearest (z 2–3).
- **Qualitative check.** The operator appears at the left edge of ch14 and the right edge of ch18. For left- and right-looking cameras those edges both point backward, where the person carrying the scanner is. Forward- and backward-facing cameras would put the operator in the middle of one image.
- **By eye:**
  - 1335: ch18 faces the wall with the red-trimmed doorway (renderings at +90…+120°); ch14 looks out over the garden (−60…−90°);
  - 2497: ch14 has the veranda on its left and the garden on its right (−90…−120°); ch18 the mirror image (+90…+120°);
  - 4718: ch14 faces the near wall with a louvred window; ch18 looks out over a railing.

**Caveats.**
- The lens model and focal length are assumed.
- There is no lever arm (the cameras are a few centimetres from the pose origin).
- The image-centre estimate is approximate.
- The tested resolution is coarse (10° grid; 5° only in the fine check).
- The result comes from one recording.
- Which physical camera (`left_main` / `right_main`) each channel is remains unconfirmed, although "ch14 looks left" is consistent with `left_main`.
- This narrows the rotation part of the extrinsics; it does not determine it.

## Assumptions and limits

- The scanner pose is the SLAM pose from `poses.csv` (probably the LiDAR/IMU body), interpolated linearly in XYZ and by SLERP in orientation. **It is not a camera pose.** The camera-to-scanner rotation and offset are unknown, and so is which physical camera each channel is.
- The scanner orientation is never assumed to be a camera orientation; the direction helpers only show what a hypothesised offset would look like.
- The images are fisheye, while the "look along" view is a pinhole perspective. They can't be compared pixel by pixel until the intrinsics are known.
- Image timing (exposure start/middle/end, rolling shutter, clock offset) is unknown; see [calibration-notes.md](calibration-notes.md).
- The frame check proves the run and the dataset share one pose file. It doesn't prove anything about other recordings.

## Validation (Basel House, October 2026)

- **Sequence 3665**, the pair verified in the early experiments, isn't in `interval-10s` (events 3638 and 3667 are). It was extracted on its own as run `sequence-3665` (`--sequences 3665`, both images `ok`).
  - The early `xbin-investigation/pose-test/` renders match the new JPEGs: `view-A.png` ↔ ch18 at 44.3 dB PSNR and `view-B.png` ↔ ch14 at 45.3 dB, against about 14 dB for the swapped pairing. So the workspace shows the same synchronised pair, with the same channel assignment.
  - Timestamps: ch14 1784111443932793 µs, ch18 1784111443932777 µs (Δt −16 µs).
  - Scanner at ch18 time: LAS (0.981, −2.578, 0.391) m, viewer (23.646, −3.076, −31.641), quaternion (−0.1081, 0.0463, 0.8403, 0.5291); 80% between two pose samples.
  - Marker check 0.001 mm. In the 5M Basel preview the marker is 1.37 m above the floor directly below it and 0.49 m from the nearest point.
- **Other events** (interval-10s: sequences 53, 1008, 2497, 4988, 6008, 7238, 7269): every caption ✓ (sequence and channel from the file name, 4000 × 3000 decoded), marker check ≤ 0.002 mm, Δt −15 to −18 µs.
- **All 242 interval events against the point cloud:** all inside the LAS bounds; nearest scan point median 0.40 m (max 1.28 m); height above the floor beneath median 1.28 m (5–95%: 0.87–5.13 m; the high values are over stairwells and openings). That is what a handheld scanner carried through the house should look like.
- **Backend:** path traversal (`..%2F`), unknown runs, hidden names, `manifest.csv` as an image, and an image from another run all return 404; CORS only for the configured origins.
- The images were checked through file names, sizes and PSNR, not by eye in the screenshots (they may show people).

## Remaining calibration work

Planned additions, in order. The data model in `lib/calibration.ts` (`Intrinsics`, `Extrinsics`, `CameraCalibration`) is where verified values will go.

1. **Channel identity.** Which physical camera (`left_main` / `right_main` in `project.json`) is ch14 and which is ch18. The Lab 13S result (ch14 looks left) suggests ch14 = `left_main`; confirm it from device documentation or a capture with a known target.
2. **Intrinsics.** A fisheye model per camera (e.g. Kannala–Brandt or OpenCV fisheye): focal length, principal point, distortion. From a checkerboard capture, the device's factory files if they exist, or structure-from-motion with a fisheye model.
3. **2D–3D correspondences.** Pick image points and their LiDAR points for several events and store them with the event, channel and source.
4. **Extrinsics.** Solve camera-to-scanner rotation and lever arm (PnP per event, then one rigid transform shared by all events), with timing offset as an optional unknown. Start from the Lab 13S directions (ch14 ≈ (−90°, 0°, 0°), ch18 ≈ (+100°, 0°, 0°)).
5. **Reprojection diagnostics.** Project LiDAR points into the fisheye images, report per-point and per-event reprojection errors, and overlay them.
6. **Frustum and ray visualisation.** Draw the calibrated fisheye field of view and pixel rays in the scene in place of the provisional arrows.
7. **Alignment diagnostics.** Compare across events and both cameras before any images are used as posed photographs for Gaussian training.
