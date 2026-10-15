"""
Lab 14A: Gaussian splatting dataset geometry, COLMAP files, resampling and
frame selection, on synthetic data only (no scans or photographs).

    backend/.venv/bin/python -m unittest tests/xgrids/test_splat_dataset.py -v
"""

from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "xgrids"))

try:
    import scipy  # noqa: F401
    from PIL import Image
    HAVE_DEPS = True
except ImportError:  # the stdlib-only XBAG tests still run
    HAVE_DEPS = False

if HAVE_DEPS:
    import extract_frames as ef
    import prepare_splat_dataset as prep
    import select_splat_frames as sel
    import splat_colmap as colmap
    import splat_geometry as g

MODEL = {"model": "equidistant", "focalPx": 961.0, "cx": 1999.5, "cy": 1449.5, "validRadiusPx": 1400.0}
CH14 = {"yawDeg": -88.95, "pitchDeg": 2.89, "rollDeg": 0.37}
CH18 = {"yawDeg": 89.44, "pitchDeg": 4.33, "rollDeg": 0.77}


def random_quaternion(rng) -> np.ndarray:
    q = rng.normal(size=4)
    return q / np.linalg.norm(q)


@unittest.skipUnless(HAVE_DEPS, "needs NumPy, SciPy and Pillow (backend/.venv)")
class GeometryTests(unittest.TestCase):
    def test_fisheye_to_opencv_axes(self):
        self.assertAlmostEqual(np.linalg.det(g.R_F_CV), 1.0)
        np.testing.assert_allclose(g.R_F_CV @ [0, 0, 1], [1, 0, 0])     # cv forward = optical axis X_F
        np.testing.assert_allclose(g.R_F_CV @ [1, 0, 0], [0, -1, 0])    # cv right = −Y_F (image left)
        np.testing.assert_allclose(g.R_F_CV @ [0, 1, 0], [0, 0, -1])    # cv down = −Z_F (image up)

    def test_view_yaw_and_pitch_signs(self):
        right = g.PinholeView("t", 20, 0, 400, 300, 90)
        u, v, _ = g.cc.project_camera(g.view_rays_fisheye(right, [right.cx], [right.cy]), MODEL)
        self.assertGreater(u[0], MODEL["cx"] + 100)       # yaw + → towards image right
        self.assertAlmostEqual(v[0], MODEL["cy"], places=6)
        up = g.PinholeView("t", 0, 20, 400, 300, 90)
        u, v, _ = g.cc.project_camera(g.view_rays_fisheye(up, [up.cx], [up.cy]), MODEL)
        self.assertLess(v[0], MODEL["cy"] - 100)          # pitch + → towards image up
        self.assertAlmostEqual(math.hypot(u[0] - MODEL["cx"], v[0] - MODEL["cy"]), MODEL["focalPx"] * math.radians(20), places=6)

    def test_forward_side_follows_the_calibration(self):
        self.assertEqual(g.forward_sign(CH14), 1.0)       # ch14 looks left: scanner forward is on its image right
        self.assertEqual(g.forward_sign(CH18), -1.0)
        self.assertEqual(g.views_for_camera("forward12", CH14)[0].yaw_deg, 12.0)
        self.assertEqual(g.views_for_camera("forward12", CH18)[0].yaw_deg, -12.0)

    def test_pinhole_projection_matches_fisheye_projection(self):
        """A LiDAR point projected through the view camera lands where its fisheye pixel maps into the view."""
        rng = np.random.default_rng(1)
        for orientation in (CH14, CH18):
            view = g.views_for_camera("forward12", orientation)[0]
            for _ in range(50):
                q, p = random_quaternion(rng), rng.normal(size=3) * 10
                rotation, centre = g.camera_to_world(p, q, orientation, view)
                d_view = np.array([rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6), 1.0])
                point = centre + rotation @ (d_view * rng.uniform(1, 30))
                u, v, z = g.project_pinhole(point, rotation, centre, view.k_opencv())
                fu, fv, theta = g.cc.project_camera(g.cc.to_camera(point, p, q, orientation), MODEL)
                pu, pv, inside = g.fisheye_pixel_to_view(fu[0], fv[0], view, MODEL)
                self.assertTrue(inside)
                self.assertLess(math.hypot(u[0] - pu, v[0] - pv), 1e-6)

    def test_lever_arm_moves_the_centre_in_the_body_frame(self):
        view = g.LAYOUTS["centre"][0]
        q = np.array([0, 0, math.sin(math.pi / 4), math.cos(math.pi / 4)])   # body X → LAS +Y
        _, centre = g.camera_to_world([1, 2, 3], q, CH14, view, lever_arm_body=(0.1, 0, 0))
        np.testing.assert_allclose(centre, [1, 2.1, 3], atol=1e-12)

    def test_colmap_pose_round_trip(self):
        rng = np.random.default_rng(2)
        special = [np.diag([1.0, -1, -1]), np.diag([-1.0, 1, -1]), np.diag([-1.0, -1, 1])]   # 180° rotations
        for k in range(200):
            r = special[k] if k < 3 else g.qvec_to_rotmat(random_quaternion(rng))
            c = rng.normal(size=3)
            qvec, tvec = g.world_to_colmap(r, c)
            self.assertGreaterEqual(qvec[0], 0)
            r_w2c = g.qvec_to_rotmat(qvec)
            np.testing.assert_allclose(r_w2c, r.T, atol=1e-12)
            np.testing.assert_allclose(-r_w2c.T @ tvec, c, atol=1e-12)

    def test_colmap_principal_point_convention(self):
        view = g.PinholeView("c", 0, 0, 1600, 1200, 110)
        fx, fy, cx, cy = g.colmap_intrinsics(view)
        self.assertEqual((cx, cy), (800.0, 600.0))        # OpenCV (799.5, 599.5) + 0.5
        self.assertAlmostEqual(fx, 800 / math.tan(math.radians(55)))

    def test_layouts_stay_inside_the_usable_circle(self):
        for orientation in (CH14, CH18):
            for view in g.views_for_camera("forward12", orientation):
                self.assertTrue(g.view_source_map(view, MODEL)[2].all())
            wing = g.views_for_camera("forward12+wing", orientation)[1]
            self.assertFalse(g.view_source_map(wing, MODEL)[2].all())   # reaches the edge: masked


@unittest.skipUnless(HAVE_DEPS, "needs NumPy, SciPy and Pillow (backend/.venv)")
class ColmapFileTests(unittest.TestCase):
    def test_text_and_binary_round_trip(self):
        rng = np.random.default_rng(3)
        cameras = [colmap.Camera(1, 1600, 1200, (560.2, 560.2, 800.0, 600.0))]
        images = [colmap.Image(i + 1, tuple(g.rotmat_to_qvec(g.qvec_to_rotmat(random_quaternion(rng)))), tuple(rng.normal(size=3)), 1, f"im{i}.jpg")
                  for i in range(5)]
        xyz, rgb = rng.normal(size=(100, 3)) * 20, rng.integers(0, 256, size=(100, 3), dtype=np.uint8)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "sparse"
            colmap.write_model(folder, cameras, images, xyz, rgb)
            with self.assertRaises(FileExistsError):
                colmap.write_model(folder, cameras, images, xyz, rgb)
            for read_c, read_i, read_p, ext in ((colmap.read_cameras_bin, colmap.read_images_bin, colmap.read_points_bin, "bin"),
                                                (colmap.read_cameras_txt, colmap.read_images_txt, colmap.read_points_txt, "txt")):
                cams = read_c(folder / f"cameras.{ext}")
                ims = read_i(folder / f"images.{ext}")
                pts, cols = read_p(folder / f"points3D.{ext}")
                self.assertEqual((cams[1].width, cams[1].height), (1600, 1200))
                np.testing.assert_allclose(cams[1].params, cameras[0].params)
                self.assertEqual([ims[k].name for k in sorted(ims)], [im.name for im in images])
                for im in images:
                    np.testing.assert_allclose(ims[im.image_id].qvec, im.qvec, atol=1e-15)
                    np.testing.assert_allclose(ims[im.image_id].tvec, im.tvec, atol=1e-15)
                np.testing.assert_allclose(pts, xyz, atol=1e-12)
                np.testing.assert_array_equal(cols, rgb)
            colmap.write_ply(Path(tmp) / "p.ply", xyz, rgb)
            data = (Path(tmp) / "p.ply").read_bytes()
            self.assertIn(b"element vertex 100", data)
            self.assertEqual(len(data.split(b"end_header\n", 1)[1]), 100 * 15)


@unittest.skipUnless(HAVE_DEPS, "needs NumPy, SciPy and Pillow (backend/.venv)")
class ResampleTests(unittest.TestCase):
    def test_a_bright_dot_lands_where_the_geometry_says(self):
        view = g.PinholeView("c", 12, 0, 320, 240, 110)
        target_view_px = (250.0, 70.0)
        d_f = g.view_rays_fisheye(view, [target_view_px[0]], [target_view_px[1]])
        fu, fv, _ = g.cc.project_camera(d_f, MODEL)
        fisheye = np.zeros((3000, 4000, 3), np.uint8)
        y, x = int(round(fv[0])), int(round(fu[0]))
        fisheye[y - 6:y + 7, x - 6:x + 7] = 255
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "f.jpg", Path(tmp) / "v.jpg"
            Image.fromarray(fisheye).save(src, quality=100)
            info = prep.resample((src, dst, view, MODEL, 0.0, 100))
            self.assertEqual(info["maskedPixels"], 0)
            out = np.asarray(Image.open(dst).convert("L"), float)
        yy, xx = np.nonzero(out > 128)
        self.assertLess(math.hypot(xx.mean() - target_view_px[0], yy.mean() - target_view_px[1]), 1.5)

    def test_points_are_cropped_and_thinned(self):
        rng = np.random.default_rng(4)
        xyz = np.concatenate([rng.uniform(-1, 1, size=(5000, 3)), rng.uniform(50, 51, size=(100, 3))])
        rgb = np.full((len(xyz), 3), 100, np.uint8)
        out, colours, stats = prep.init_points(xyz, rgb, np.zeros((1, 3)), radius=5, voxel=0.5, max_points=10, min_neighbours=0)
        self.assertEqual(stats["withinRadius"], 5000)
        self.assertLessEqual(stats["voxels"], 64)
        self.assertEqual(len(out), 10)
        self.assertTrue((colours == 100).all())


@unittest.skipUnless(HAVE_DEPS, "needs NumPy, SciPy and Pillow (backend/.venv)")
class SelectionTests(unittest.TestCase):
    def setUp(self):
        # 60 s of poses at 10 Hz: still for 20 s, then walking 1 m/s along X.
        times = [1_000_000 + k * 100_000 for k in range(601)]
        positions = [(max(0.0, (t - 21_000_000) / 1e6), 0.0, 0.0) for t in times]
        self.poses = ef.Poses(times, positions, [(0.0, 0.0, 0.0, 1.0)] * len(times))
        self.events = []
        for k in range(170):   # ~3 pairs per second
            t = 1_000_000 + k * 333_333
            frames = {ch: ef.IndexedFrame(k, t + (19 if ch == "ch18" else 0), 0, 0, 1, 4000, 3000, ch, k) for ch in ("ch14", "ch18")}
            self.events.append(ef.Event(k, frames))

    def test_still_periods_are_thinned_and_anchors_kept(self):
        kept, dropped = sel.select(self.events, self.poses, 1_000_000, 57_000_000, 5, 1, 0.3, 10, anchors={90})
        still = [r for r in kept if r["position"][0] == 0]
        self.assertEqual(len(still), 1)                   # one event while the scanner stood still
        self.assertTrue(dropped)
        self.assertEqual([r for r in kept if r["sequence"] == 90][0]["reason"], "anchor")
        walking = [r for r in kept if r["position"][0] > 0]
        steps = [r["stepM"] for r in walking[1:]]
        self.assertTrue(all(3 <= s <= 7 for s in steps if s), steps)

    def test_anchor_replaces_its_slot(self):
        kept, _ = sel.select(self.events, self.poses, 21_000_000, 57_000_000, 5, 1, 0.0, 0.0, anchors={63})
        times = [r["timeUs"] for r in kept]
        self.assertTrue(all(b - a > 2_000_000 for a, b in zip(times, times[1:])), times)


if __name__ == "__main__":
    unittest.main()
