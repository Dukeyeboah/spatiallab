"""
Tests for backend/camera_calibration.py (Lab 13V) on synthetic correspondences
with known camera parameters (no real scans or photographs). Needs SciPy:

    backend/.venv/bin/python -m unittest tests/xgrids/test_camera_calibration.py -v

Optional real-data check: set SPATIAL_LAB_CORRESPONDENCES to a Lab 13U export;
its recorded provisional predictions must be reproduced.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import unittest
from pathlib import Path

import numpy as np

try:
    import scipy  # noqa: F401
    from scipy.spatial.transform import Rotation
    HAVE_SCIPY = True
except ImportError:
    HAVE_SCIPY = False

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

if HAVE_SCIPY:
    import camera_calibration as cc

POSES_SHA = "ab" * 32
TRUE = {
    "ch14": {"yawDeg": -86.0, "pitchDeg": 4.0, "rollDeg": -3.0},
    "ch18": {"yawDeg": 97.0, "pitchDeg": -2.0, "rollDeg": 2.5},
}


def synthetic_export(focal=750.0, noise_px=0.5, events=8, per_camera=2, outliers=0, seed=7, truth=TRUE) -> str:
    """A Lab 13U export (same shape as lib/correspondences.ts buildExport) from known parameters."""
    rng = np.random.default_rng(seed)
    model = {**cc.PROVISIONAL_MODEL, "focalPx": focal}
    records = []
    for e in range(events):
        sequence = 1000 + 30 * e
        position = [float(x) for x in rng.uniform(-20, 20, 3) * [1, 1, 0.05]]
        heading = rng.uniform(-180, 180)
        q = Rotation.from_euler("ZYX", [heading, rng.uniform(-5, 5), rng.uniform(-5, 5)], degrees=True).as_quat()  # xyzw
        for channel in ("ch14", "ch18"):
            for k in range(per_camera):
                theta = math.radians(rng.uniform(5, 75))
                phi = rng.uniform(-math.pi, math.pi)
                direction = np.array([math.cos(theta), math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi)])
                distance = rng.uniform(4, 15)
                t = truth[channel]
                r_las_camera = cc.quaternion_matrix(q) @ cc.offset_matrix(t["yawDeg"], t["pitchDeg"], t["rollDeg"])
                las = np.asarray(position) + r_las_camera @ direction * distance
                u, v, _ = cc.project_camera(direction[None], model)
                u, v = float(u[0] + rng.normal(0, noise_px)), float(v[0] + rng.normal(0, noise_px))
                records.append({
                    "id": f"c_{sequence}{channel}{k}", "datasetId": "synthetic", "posesSha256": POSES_SHA, "runId": "interval-10s",
                    "sequence": sequence, "channel": channel, "imageFile": f"seq{sequence:05d}_{channel}_t1.jpg", "timestampUs": 1_784_111_000_000_000 + e,
                    "imageWidth": 4000, "imageHeight": 3000, "pixel": {"u": u, "v": v},
                    "lidar": {"las": [float(x) for x in las], "method": "nearest-point", "detail": "synthetic", "budget": "5m"},
                    "scannerPose": {"position": position, "quaternion": [float(x) for x in q]},
                    "feature": f"synthetic corner {k}", "quality": "good", "notes": "", "calibrationStatus": "provisional",
                    "created": "2026-10-15T00:00:00Z", "updated": "2026-10-15T00:00:00Z",
                })
    for i in range(outliers):
        for channel in ("ch14", "ch18"):
            r = [x for x in records if x["channel"] == channel][i * 3]
            r["pixel"]["u"] += 300.0
            r["notes"] = "deliberate outlier"
    return json.dumps({"schema": "spatial-lab/xgrids-correspondences", "version": 1, "exported": "2026-10-15T00:00:00Z",
                       "calibrationStatus": "provisional", "dataset": {"id": "synthetic", "name": "Synthetic", "posesSha256": POSES_SHA},
                       "conventions": {}, "projectionUsedForDiagnostics": {}, "correspondences": records})


@unittest.skipUnless(HAVE_SCIPY, "needs scipy (backend/.venv)")
class Conventions(unittest.TestCase):
    def test_quaternion_matches_scipy_xyzw(self):
        rng = np.random.default_rng(1)
        for _ in range(50):
            q = rng.normal(size=4)
            np.testing.assert_allclose(cc.quaternion_matrix(q), Rotation.from_quat(q / np.linalg.norm(q)).as_matrix(), atol=1e-12)

    def test_offset_matrix_matches_documented_values(self):
        doc = json.loads((REPO / "docs/xgrids/provisional-camera-directions.json").read_text())["best_provisional_offsets"]
        np.testing.assert_allclose(cc.offset_matrix(-90, 0, 0), doc["ch14"]["R_offset"], atol=1e-6)
        np.testing.assert_allclose(cc.offset_matrix(100, 0, 0), doc["ch18"]["R_offset"], atol=1e-6)
        for ch in ("ch14", "ch18"):
            o = doc[ch]
            q = Rotation.from_matrix(cc.offset_matrix(o["yaw"], o["pitch"], o["roll"])).as_quat()
            q = q if q @ o["quaternion_xyzw"] > 0 else -q  # q and −q are the same rotation
            np.testing.assert_allclose(q, o["quaternion_xyzw"], atol=1e-6)

    def test_offset_matrix_is_three_euler_zyx(self):
        # THREE.Euler(roll, −pitch, −yaw, "ZYX") = intrinsic Z(−yaw) · Y(−pitch) · X(roll).
        for yaw, pitch, roll in ((-90, 0, 0), (97, -12, 30), (13, 41, -77)):
            np.testing.assert_allclose(cc.offset_matrix(yaw, pitch, roll),
                                       Rotation.from_euler("ZYX", [-yaw, -pitch, roll], degrees=True).as_matrix(), atol=1e-12)

    def test_angle_meanings(self):
        np.testing.assert_allclose(cc.offset_matrix(-90, 0, 0)[:, 0], [0, 1, 0], atol=1e-12)  # yaw −90 = left
        self.assertGreater(cc.offset_matrix(0, 30, 0)[2, 0], 0.49)  # pitch + = up
        np.testing.assert_allclose(cc.offset_matrix(0, 0, 90)[:, 2], [0, -1, 0], atol=1e-12)  # roll +90: image up → right

    def test_projection_axes_and_inverse(self):
        m = cc.PROVISIONAL_MODEL
        u, v, theta = cc.project_camera(np.array([[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0], [1.0, 0.0, -1.0]]), m)
        np.testing.assert_allclose([u[0], v[0], theta[0]], [m["cx"], m["cy"], 0])
        np.testing.assert_allclose([u[1], v[1]], [m["cx"] - m["focalPx"] * math.pi / 2, m["cy"]])  # camera +Y = image left
        np.testing.assert_allclose([u[2], v[2]], [m["cx"], m["cy"] - m["focalPx"] * math.pi / 2])  # camera +Z = image up
        self.assertAlmostEqual(v[3], m["cy"] + m["focalPx"] * math.pi / 4)
        for pu, pv in ((2600.0, 900.0), (1000.0, 2500.0), (1999.5, 1449.5)):
            u2, v2, _ = cc.project_camera(cc.pixel_ray_camera(pu, pv, m)[None] * 7.0, m)
            np.testing.assert_allclose([u2[0], v2[0]], [pu, pv], atol=1e-9)

    def test_matches_frontend_projection(self):
        # Lab 13U validation record #1: the app (lib/fisheyeProjection.ts) predicted (2002.26, 1309.75), error 14.77 px.
        record = {"lidar": {"las": [-8.690000534057617, -17.0260009765625, 0.875]}, "pixel": {"u": 1987.61, "v": 1307.82},
                  "scannerPose": {"position": [-6.592325, -6.159064, -0.499709], "quaternion": [-0.054706382, -0.02614565, 0.99452589, 0.085099187]}}
        p = cc.predict_record(record, {"yawDeg": -90, "pitchDeg": 0, "rollDeg": 0}, cc.PROVISIONAL_MODEL)
        self.assertAlmostEqual(p["u"], 2002.26, places=2)
        self.assertAlmostEqual(p["v"], 1309.75, places=2)
        self.assertAlmostEqual(p["errorPx"], 14.77, places=2)

    def test_lever_arm_moves_centre_in_body_frame(self):
        q = Rotation.from_euler("Z", 90, degrees=True).as_quat()  # body X → LAS +Y
        v0 = cc.to_camera([[0, 5, 0]], [0, 0, 0], q, {"yawDeg": 0, "pitchDeg": 0, "rollDeg": 0})
        v1 = cc.to_camera([[0, 5, 0]], [0, 0, 0], q, {"yawDeg": 0, "pitchDeg": 0, "rollDeg": 0}, lever_arm_body=(1, 0, 0))
        np.testing.assert_allclose(v0[0], [5, 0, 0], atol=1e-12)
        np.testing.assert_allclose(v1[0], [4, 0, 0], atol=1e-12)


@unittest.skipUnless(HAVE_SCIPY, "needs scipy (backend/.venv)")
class InputValidation(unittest.TestCase):
    def test_accepts_synthetic_export(self):
        loaded = cc.load_correspondences(synthetic_export(), "synthetic", POSES_SHA)
        self.assertEqual(len(loaded["records"]), 32)
        self.assertEqual(loaded["rejected"], [])
        self.assertEqual(loaded["sourceSha256"], hashlib.sha256(synthetic_export().encode()).hexdigest())

    def test_rejects_wrong_identity(self):
        text = synthetic_export()
        with self.assertRaises(cc.CalibrationInputError):
            cc.load_correspondences(text, expected_dataset_id="builtin-basel-house")
        with self.assertRaises(cc.CalibrationInputError):
            cc.load_correspondences(text, expected_poses_sha256="cd" * 32)
        for change in ({"schema": "other"}, {"version": 2}, {"dataset": {"id": "x"}}):
            with self.assertRaises(cc.CalibrationInputError):
                cc.load_correspondences(json.dumps({**json.loads(text), **change}))

    def test_rejects_bad_records_individually(self):
        data = json.loads(synthetic_export())
        data["correspondences"][0]["posesSha256"] = "cd" * 32
        data["correspondences"][1]["pixel"]["u"] = 4100
        data["correspondences"][2]["id"] = data["correspondences"][3]["id"]
        data["correspondences"][4]["calibrationStatus"] = "calibrated"
        loaded = cc.load_correspondences(json.dumps(data))
        self.assertEqual(len(loaded["records"]), 28)
        self.assertEqual([r["reason"] for r in loaded["rejected"]],
                         ["belongs to another dataset or pose file", "pixel outside the image", "duplicate id", "calibrationStatus must be provisional"])

    def test_verify_against_runs(self):
        loaded = cc.load_correspondences(synthetic_export())
        events = {}
        for r in loaded["records"]:
            events.setdefault(r["sequence"], {"sequence": r["sequence"], "images": {}})["images"][r["channel"]] = {
                "file": r["imageFile"], "timestampUs": r["timestampUs"], "width": 4000, "height": 3000,
                "pose": {"position": r["scannerPose"]["position"], "quaternion": r["scannerPose"]["quaternion"]}}
        run = {"source": {"posesSha256": POSES_SHA}, "events": list(events.values())}
        self.assertEqual(cc.verify_against_runs(loaded["records"], lambda _: run), [])
        loaded["records"][0]["scannerPose"]["position"][0] += 0.01
        self.assertEqual(len(cc.verify_against_runs(loaded["records"], lambda _: run)), 1)
        self.assertTrue(all("different poses.csv" in p["reason"] for p in
                            cc.verify_against_runs(loaded["records"], lambda _: {**run, "source": {"posesSha256": "cd" * 32}})))


@unittest.skipUnless(HAVE_SCIPY, "needs scipy (backend/.venv)")
class Solver(unittest.TestCase):
    def records(self, channel, **kwargs):
        return [r for r in cc.load_correspondences(synthetic_export(**kwargs))["records"] if r["channel"] == channel]

    def test_stage_a_recovers_rotation(self):
        for channel in ("ch14", "ch18"):
            result = cc.fit(self.records(channel), "A", cc.PROVISIONAL_ORIENTATIONS[channel], cc.PROVISIONAL_MODEL, cc.SolverConfig())
            for name in ("yawDeg", "pitchDeg", "rollDeg"):
                self.assertAlmostEqual(result["orientation"][name], TRUE[channel][name], delta=0.1, msg=f"{channel} {name}")
            self.assertTrue(result["solver"]["success"])
            self.assertLess(result["std"]["yawDeg"], 0.1)

    def test_stage_b_recovers_focal(self):
        for channel in ("ch14", "ch18"):
            records = self.records(channel, focal=910.0)
            initial = cc.PROVISIONAL_ORIENTATIONS[channel]
            a = cc.fit(records, "A", initial, cc.PROVISIONAL_MODEL, cc.SolverConfig())
            b = cc.fit(records, "B", initial, cc.PROVISIONAL_MODEL, cc.SolverConfig(), start={**a["orientation"], "focalPx": 750.0})
            self.assertAlmostEqual(b["model"]["focalPx"], 910.0, delta=5.0)
            for name in ("yawDeg", "pitchDeg", "rollDeg"):
                self.assertAlmostEqual(b["orientation"][name], TRUE[channel][name], delta=0.3)
            self.assertLess(b["rmsResidualPx"], 2.0)
            self.assertGreater(a["rmsResidualPx"], 10 * b["rmsResidualPx"])  # the wrong f can't be absorbed by rotation

    def test_robust_to_gross_outliers(self):
        for channel in ("ch14", "ch18"):
            records = self.records(channel, outliers=2)
            result = cc.fit(records, "A", cc.PROVISIONAL_ORIENTATIONS[channel], cc.PROVISIONAL_MODEL, cc.SolverConfig(f_scale_px=5))
            for name in ("yawDeg", "pitchDeg", "rollDeg"):
                self.assertAlmostEqual(result["orientation"][name], TRUE[channel][name], delta=0.5)
            evaluation = cc.evaluate(records, result["orientation"], result["model"], cc.SolverConfig())
            planted = {r["id"] for r in records if r["notes"] == "deliberate outlier"}
            self.assertEqual(set(evaluation["outliers"]), planted)
            linear = cc.fit(records, "A", cc.PROVISIONAL_ORIENTATIONS[channel], cc.PROVISIONAL_MODEL, cc.SolverConfig(), loss="linear")
            self.assertGreater(abs(linear["orientation"]["yawDeg"] - TRUE[channel]["yawDeg"]), abs(result["orientation"]["yawDeg"] - TRUE[channel]["yawDeg"]))

    def test_leave_one_event_out_never_trains_on_held_out_event(self):
        records = self.records("ch14")
        cv = cc.leave_one_event_out(records, "A", cc.PROVISIONAL_ORIENTATIONS["ch14"], cc.PROVISIONAL_MODEL, cc.SolverConfig())
        by_id = {r["id"]: r for r in records}
        held = []
        for fold in cv["folds"]:
            self.assertTrue(fold["ok"])
            self.assertNotIn(fold["heldOutEvent"], fold["trainingEvents"])
            self.assertFalse(set(fold["trainingRecords"]) & set(fold["heldOutRecords"]))
            self.assertTrue(all(by_id[i]["sequence"] == fold["heldOutEvent"] for i in fold["heldOutRecords"]))
            held += fold["heldOutRecords"]
        self.assertEqual(sorted(held), sorted(by_id))
        self.assertLess(cv["heldOutStats"]["median"], 2.0)

    def test_insufficient_folds_are_reported(self):
        records = [r for r in self.records("ch14") if r["sequence"] in (1000, 1030)][:3]
        cv = cc.leave_one_event_out(records, "B", cc.PROVISIONAL_ORIENTATIONS["ch14"], cc.PROVISIONAL_MODEL, cc.SolverConfig())
        self.assertEqual(cv["foldsOk"], 0)
        self.assertTrue(all("training records" in f["reason"] for f in cv["folds"]))


@unittest.skipUnless(HAVE_SCIPY, "needs scipy (backend/.venv)")
class Experiment(unittest.TestCase):
    def run_once(self, text):
        loaded = cc.load_correspondences(text)
        return cc.run_experiment(loaded, cc.audit(loaded["records"]), source_name="synthetic.json", now="2026-10-15T00:00:00+00:00")

    def test_deterministic_and_round_trips(self):
        text = synthetic_export(focal=910.0)
        a, b = self.run_once(text), self.run_once(text)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        again = cc.load_experiment(json.dumps(a))
        self.assertEqual(again["experimentId"], a["experimentId"])
        stage_b = a["parameterSets"]["stageB"]["cameras"]["ch14"]
        self.assertEqual(set(stage_b["orientation"]), {"yawDeg", "pitchDeg", "rollDeg"})
        self.assertEqual(set(stage_b["model"]) >= {"focalPx", "cx", "cy", "validRadiusPx", "status"}, True)
        self.assertAlmostEqual(stage_b["model"]["focalPx"], 910, delta=5)
        self.assertEqual(a["cameras"]["ch14"]["comparison"]["recommended"], "B")
        with self.assertRaises(cc.CalibrationInputError):
            cc.load_experiment(json.dumps({**a, "schema": "x"}))

    def test_audit_flags(self):
        data = json.loads(synthetic_export())
        recs = data["correspondences"]
        recs[0]["lidar"]["las"] = [2 * p - x for p, x in zip(recs[0]["scannerPose"]["position"], recs[0]["lidar"]["las"])]  # mirrored: behind the lens
        recs[1]["feature"] = "rear lights on vehicle"
        p2, x2 = np.asarray(recs[2]["scannerPose"]["position"]), np.asarray(recs[2]["lidar"]["las"])
        recs[2]["lidar"]["las"] = list(p2 + (x2 - p2) / np.linalg.norm(x2 - p2) * 0.8)  # same direction, 0.8 m away
        recs[3]["lidar"]["las"] = list(recs[4]["lidar"]["las"])
        report = cc.audit(cc.load_correspondences(json.dumps(data))["records"])
        flags = {row["id"]: {f["code"] for f in row["flags"]} for row in report["records"]}
        self.assertIn("wrong-side", flags[recs[0]["id"]])
        self.assertEqual(report["excludedByDefault"], [recs[0]["id"]])
        self.assertIn("may-move", flags[recs[1]["id"]])
        self.assertIn("close-range", flags[recs[2]["id"]])
        self.assertIn("duplicate", flags[recs[3]["id"]])
        experiment = cc.run_experiment(cc.load_correspondences(json.dumps(data)), report, now="x")
        self.assertNotIn(recs[0]["id"], experiment["cameras"][recs[0]["channel"]]["records"])
        self.assertEqual(experiment["source"]["excluded"][0]["id"], recs[0]["id"])

    def test_image_agreement_prefers_true_parameters(self):
        rng = np.random.default_rng(3)
        cloud = rng.uniform(-12, 12, (60000, 3))
        cloud[:, 2] *= 0.4
        grey = (np.sin(cloud[:, 0] * 1.3) + np.cos(cloud[:, 1] * 0.9) + cloud[:, 2]) * 40 + 128
        truth_model = {**cc.PROVISIONAL_MODEL, "focalPx": 930.0}
        pose = {"position": [0.0, 0.0, 0.0], "quaternion": [0.0, 0.0, 0.0, 1.0]}
        photo = cc.render_cloud_grey(cloud, grey, pose["position"], pose["quaternion"], TRUE["ch14"], truth_model, 4000, 3000)
        photo = np.where(np.isnan(photo), 0.0, photo)
        run = {"id": "synthetic", "events": [
            {"sequence": 1, "images": {"ch14": {"file": "used.jpg", "width": 4000, "height": 3000, "pose": pose}}},
            {"sequence": 2, "images": {"ch14": {"file": "a.jpg", "width": 4000, "height": 3000, "pose": pose}}}]}
        sets = {"truth": {"cameras": {"ch14": {"orientation": TRUE["ch14"], "model": truth_model}}},
                "provisional": {"cameras": {"ch14": {"orientation": cc.PROVISIONAL_ORIENTATIONS["ch14"], "model": cc.PROVISIONAL_MODEL}}}}
        result = cc.image_agreement(sets, run, lambda file, w, h: photo, cloud, grey, skip_sequences=[1])
        self.assertEqual([r["sequence"] for r in result["images"]], [2])
        scores = result["images"][0]["ncc"]
        self.assertGreater(scores["truth"], 0.99)
        self.assertLess(scores["provisional"], scores["truth"] - 0.2)
        self.assertEqual(result["summary"]["ch14"]["bestCount"], {"provisional": 0, "truth": 1})


@unittest.skipUnless(HAVE_SCIPY and os.environ.get("SPATIAL_LAB_CORRESPONDENCES"), "set SPATIAL_LAB_CORRESPONDENCES to a Lab 13U export")
class RealExport(unittest.TestCase):
    def test_reproduces_recorded_provisional_predictions(self):
        text = Path(os.environ["SPATIAL_LAB_CORRESPONDENCES"]).read_text()
        data = json.loads(text)
        diagnostics = data["projectionUsedForDiagnostics"]
        model = {**cc.PROVISIONAL_MODEL, **{k: diagnostics["model"][k] for k in ("focalPx", "cx", "cy", "validRadiusPx")}}
        records = {r["id"]: r for r in cc.load_correspondences(text)["records"]}
        for item in diagnostics["perRecord"]:
            p = cc.predict_record(records[item["id"]], diagnostics["offsets"][records[item["id"]]["channel"]], model)
            self.assertEqual(p["valid"], item["predicted"] is not None)
            if p["valid"]:
                self.assertAlmostEqual(p["u"], item["predicted"]["u"], places=1)
                self.assertAlmostEqual(p["v"], item["predicted"]["v"], places=1)


if __name__ == "__main__":
    unittest.main()
