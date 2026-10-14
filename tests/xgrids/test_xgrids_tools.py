"""
Tests for scripts/xgrids/index_xbin.py and extract_frames.py on synthetic
XBAG-like data (no real scans or photographs).

    python3 -m unittest discover tests/xgrids -v
"""

from __future__ import annotations

import csv
import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parents[1] / "scripts" / "xgrids"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SCRIPTS))

import extract_frames as ex  # noqa: E402
from synthetic_xbag import BASE_US, Shot, SPS_SIGNATURE, camera_records, fake_h264, record, write_xbag  # noqa: E402

INTERVAL_US = 300_000
CH14_DELAY_US = 17


def shot_time(sequence: int, channel: int) -> int:
    t = BASE_US + sequence * INTERVAL_US
    if channel == 14:
        t += 6_000 if sequence == 12 else CH14_DELAY_US  # sequence 12: 6 ms apart → not a pair
    return t


def build_scenario(folder: Path) -> Path:
    """
    20 capture events (sequence 0–19, 0.3 s apart) on channels 18 and 14:
    - sequence 12's two frames are 6 ms apart (beyond the 5 ms pairing window);
    - a channel-1 record contains a decoy SPS signature that is not an image;
    - the channel-18 record with sequences 15–19 declares the wrong message count,
      so those frames get no camera stream.
    Poses cover 1.0–4.0 s after the first frame: x = seconds, rotation about Z
    growing 30° per second.
    """
    shots = lambda channel, sequences: [Shot(channel, s, shot_time(s, channel), fake_h264(seed=s)) for s in sequences]  # noqa: E731
    records = (
        camera_records(shots(18, range(0, 5))) + camera_records(shots(14, range(0, 5)))
        + camera_records(shots(18, range(5, 10))) + camera_records(shots(14, range(5, 10)))
        + [record(1, [b"\x01\x02\x03" + SPS_SIGNATURE + b"\x55" * 64], BASE_US, BASE_US)]
        + camera_records(shots(18, range(10, 15))) + camera_records(shots(14, range(10, 15)))
        + camera_records(shots(18, range(15, 20)), count_override={0: 4}) + camera_records(shots(14, range(15, 20)))
    )
    xbin = folder / "synthetic.xbin"
    write_xbag(xbin, records)
    (folder / "project_data").mkdir()
    with open(folder / "project_data" / "poses.csv", "w") as stream:
        for k in range(31):
            seconds = 1.0 + k / 10
            half = math.radians(30 * (seconds - 1.0)) / 2
            t = BASE_US + round(seconds * 1_000_000)
            stream.write(f"{t // 1_000_000}.{t % 1_000_000:06d},{seconds:.6f},0,0,0,0,{math.sin(half):.9f},{math.cos(half):.9f}\n")
    return xbin


def run(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / script), *args], capture_output=True, text=True)


def read_rows(path: Path) -> list[dict]:
    with open(path, newline="") as stream:
        return list(csv.DictReader(stream))


class IndexerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.xbin = build_scenario(cls.tmp)
        result = run("index_xbin.py", str(cls.xbin), "--quiet")
        assert result.returncode == 0, result.stderr
        cls.meta = cls.tmp / "reconstruction" / "xgrids" / "metadata"
        cls.rows = read_rows(cls.meta / "frames.csv")
        cls.summary = json.loads((cls.meta / "index-summary.json").read_text())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_counts(self):
        s = self.summary
        self.assertEqual(s["spsMatches"], 41)
        self.assertEqual(s["decodedFrames"], 40)
        self.assertEqual(s["rejectedCandidates"], 1)  # the decoy
        self.assertEqual(s["synchronizedPairs"], 19)
        self.assertEqual(s["unpairedFrames"], 2)

    def test_sequence_zero_and_exact_timestamps(self):
        first = self.rows[0]
        self.assertEqual((first["sequence"], first["timestamp_us"]), ("0", str(BASE_US)))
        self.assertEqual(first["timestamp_utc"], "2026-07-15T10:10:16.490409Z")
        for row in self.rows:
            channel = 14 if row["camera_stream"] == "ch14" else 18
            self.assertEqual(int(row["timestamp_us"]), shot_time(int(row["sequence"]), channel))

    def test_streams_only_from_matching_record_headers(self):
        unknown = [r for r in self.rows if not r["camera_stream"]]
        self.assertEqual(sorted(int(r["sequence"]) for r in unknown), [15, 16, 17, 18, 19])
        self.assertTrue(all("header says 4 messages" in r["stream_evidence"] for r in unknown))

    def test_pairing_window(self):
        statuses = {(r["sequence"], r["camera_stream"]): r["pair_status"] for r in self.rows}
        self.assertEqual(statuses[("12", "ch14")], "unpaired")
        self.assertEqual(statuses[("12", "ch18")], "unpaired")
        self.assertEqual(statuses[("11", "ch14")], "paired")

    def test_chunk_size_does_not_change_the_result(self):
        out = self.tmp / "tiny-chunks"
        result = run("index_xbin.py", str(self.xbin), "--quiet", "--out", str(out), "--chunk-mib", "0.0001")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((out / "frames.csv").read_bytes(), (self.meta / "frames.csv").read_bytes())

    def test_rejects_non_xbag_file(self):
        other = self.tmp / "not-xbag.xbin"
        other.write_bytes(b"PK\x03\x04" + bytes(100))
        result = run("index_xbin.py", str(other), "--quiet", "--out", str(self.tmp / "bad"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("XBAG signature", result.stderr)


class PoseMathTest(unittest.TestCase):
    def test_slerp_endpoints_midpoint_and_short_arc(self):
        identity = (0.0, 0.0, 0.0, 1.0)
        z90 = (0.0, 0.0, math.sin(math.pi / 4), math.cos(math.pi / 4))
        self.assertEqual(ex.slerp(identity, z90, 0.0), identity)
        for got, want in zip(ex.slerp(identity, z90, 1.0), z90):
            self.assertAlmostEqual(got, want, places=12)
        mid = ex.slerp(identity, z90, 0.5)
        self.assertAlmostEqual(2 * math.degrees(math.atan2(mid[2], mid[3])), 45.0, places=9)
        # −q is the same rotation: the result must not swing the long way round.
        flipped = ex.slerp(identity, tuple(-c for c in z90), 0.5)
        self.assertAlmostEqual(abs(2 * math.degrees(math.atan2(flipped[2], flipped[3]))), 45.0, places=9)

    def test_slerp_is_exact_for_small_steps(self):
        # Typical 100 ms pose step: 0.5° about an oblique axis; SLERP gives exactly 0.3 × 0.5°.
        axis = (1 / math.sqrt(3),) * 3
        rotation = lambda degrees: (*(c * math.sin(math.radians(degrees) / 2) for c in axis), math.cos(math.radians(degrees) / 2))  # noqa: E731
        for got, want in zip(ex.slerp(rotation(10.0), rotation(10.5), 0.3), rotation(10.15)):
            self.assertAlmostEqual(got, want, places=14)

    def test_component_order_is_xyzw(self):
        poses = ex.Poses([0, 1_000_000], [(0, 0, 0), (2, 4, 6)], [(0, 0, 0, 1), (1, 0, 0, 0)])  # 0° → 180° about X
        pose = ex.interpolate_pose(poses, 500_000)
        self.assertEqual(pose.position, (1.0, 2.0, 3.0))
        self.assertAlmostEqual(pose.quaternion[0], math.sin(math.pi / 4), places=12)  # x
        self.assertAlmostEqual(pose.quaternion[3], math.cos(math.pi / 4), places=12)  # w
        self.assertIsNone(ex.interpolate_pose(poses, -1))
        self.assertIsNone(ex.interpolate_pose(poses, 1_000_001))
        self.assertEqual(ex.interpolate_pose(poses, 1_000_000).quaternion, (1.0, 0.0, 0.0, 0.0))

    def test_sample_by_interval(self):
        events = [ex.Event(i, {"ch18": ex.IndexedFrame(i, i * 300_000, 0, 0, 0, 0, 0, "ch18", i)}) for i in range(100)]
        chosen = [e.sequence for e in ex.sample_by_interval(events, 3_000_000)]
        self.assertEqual(chosen, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
        self.assertEqual(len(ex.sample_by_interval(events, 1)), 100)  # never the same event twice


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
class ExtractorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.xbin = build_scenario(cls.tmp)
        assert run("index_xbin.py", str(cls.xbin), "--quiet").returncode == 0

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_selection_and_pose_range(self):
        result = run("extract_frames.py", str(self.xbin), "--dry-run", "--interval", "0.9")
        self.assertEqual(result.returncode, 0, result.stderr)
        # Complete ch14 + ch18 pairs: 0–14 without 12. Poses cover 1.0–4.0 s → sequences 4–13 eligible.
        self.assertIn("14 complete pairs", result.stdout)
        self.assertIn("eligible 9", result.stdout)
        self.assertIn("'events': 5", result.stdout)  # outside the pose range: 0–3 and 14
        self.assertIn("Not complete pairs in frames.csv: {'frame unpaired': 2, 'pair without exactly one ch14 + ch18 frame': 5}", result.stdout)
        self.assertIn("seq     4", result.stdout)
        self.assertIn("seq     7", result.stdout)

    def test_undecodable_frames_are_reported_not_fatal(self):
        result = run("extract_frames.py", str(self.xbin), "--validation")
        self.assertEqual(result.returncode, 2, result.stderr)  # incomplete events
        out = self.tmp / "reconstruction" / "xgrids" / "images" / "validation"
        rows = read_rows(out / "manifest.csv")
        self.assertEqual([(r["sequence"], r["camera_channel"]) for r in rows],
                         [("4", "ch14"), ("4", "ch18"), ("8", "ch14"), ("8", "ch18"), ("13", "ch14"), ("13", "ch18")])
        self.assertTrue(all(r["decoder_status"] == "failed" and not r["image_file"] for r in rows))
        self.assertEqual(list(out.glob("*.jpg")) + list(out.glob("*.partial")), [])
        self.assertTrue(all(r["camera_extrinsics"] == "unknown" for r in rows))
        # Sequence 8's ch14 frame: 2.4 s + 17 µs, between pose samples 2.4 and 2.5 s.
        row = rows[2]
        seconds = 2.4 + CH14_DELAY_US / 1e6
        self.assertEqual(row["pose_alpha"], f"{CH14_DELAY_US / 100_000:.6f}")
        self.assertAlmostEqual(float(row["scanner_x"]), seconds, places=6)
        angle = 2 * math.degrees(math.atan2(float(row["scanner_qz"]), float(row["scanner_qw"])))
        self.assertAlmostEqual(angle, 30 * (seconds - 1.0), places=5)
        summary = json.loads((out / "extraction-summary.json").read_text())
        self.assertEqual(summary["imageStatus"], {"failed": 6})
        self.assertTrue(summary["source"]["unchangedDuringExtraction"])

    def test_refuses_output_inside_the_repository(self):
        result = run("extract_frames.py", str(self.xbin), "--dry-run", "--out", str(SCRIPTS / "images"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("inside the Git repository", result.stderr)


if __name__ == "__main__":
    unittest.main()
