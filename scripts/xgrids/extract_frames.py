#!/usr/bin/env python3
"""
Decode a selected subset of the synchronised camera pairs of an XGRIDS .xbin
recording to JPEG, using the frames.csv written by index_xbin.py (no rescan).

    python3 scripts/xgrids/extract_frames.py /path/to/rec.xbin --validation     # 3 pairs: start, middle, end
    python3 scripts/xgrids/extract_frames.py /path/to/rec.xbin                  # one pair every 10 s
    python3 scripts/xgrids/extract_frames.py rec.xbin --interval 5 --quality 3
    python3 scripts/xgrids/extract_frames.py rec.xbin --sequences 0,3647,7294
    python3 scripts/xgrids/extract_frames.py rec.xbin --dry-run                 # selection report only

Default output: <xbin folder>/reconstruction/xgrids/images/<run name>/
    seq00120_ch14_t1784110252490409.jpg ...   full-resolution JPEGs, both cameras per capture event
    manifest.csv                              one row per image (see MANIFEST_COLUMNS)
    extraction-summary.json                   parameters, selection, exclusions, statuses

How an image is produced
------------------------
1. frames.csv gives each frame's SPS offset and the declared length of its
   H.264 bytes (protobuf field 5). Before decoding, the frame's metadata is
   decoded again from the .xbin with the indexer's strict decoder and must
   match the CSV (sequence, timestamp, offsets, length); otherwise the image
   is skipped as an index mismatch.
2. Exactly those bytes are read (os.pread, read-only). In our recording each
   is a self-contained Annex B stream: SPS, PPS, SEI, SEI, one IDR slice.
3. FFmpeg decodes the bytes from stdin and writes one JPEG (`-q:v`, 2 = best).
   Any FFmpeg warning or error marks the image "decoded-with-errors" (a
   truncated or damaged frame that FFmpeg concealed; the JPEG is kept for
   inspection); no output marks it "failed". The run continues.
4. The JPEG is checked: SOI/EOI markers, dimensions from its SOF marker equal
   the size declared in the recording, SHA-256 recorded.

Scanner pose per image
----------------------
poses.csv rows are `timestamp, x, y, z, qx, qy, qz, qw` (scalar last). For
each image timestamp the two adjacent pose samples are interpolated: linear
for XYZ, quaternion SLERP (shortest arc) for orientation. This is the pose of
the scanner's pose reference frame, NOT of either optical camera: the
camera-to-scanner extrinsics are unknown and recorded as such. Events outside
the pose time range are excluded by default and reported separately.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from index_xbin import SPS_SIGNATURE, Malformed, decode_frame, utc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
CAMERA_STREAMS = ("ch14", "ch18")
FFMPEG_TIMEOUT_S = 120
# Disk-space guard: a 4000 × 3000 JPEG at -q:v 2 is ~2–4 MB; assume 6 MB.
ESTIMATED_JPEG_BYTES = 6 * 1024 * 1024
QUATERNION_NORM_TOLERANCE = 0.01

MANIFEST_COLUMNS = [
    "image_file", "event_index", "pair_id", "sequence", "camera_channel", "timestamp_us", "timestamp_utc",
    "sps_offset", "message_offset", "h264_bytes", "nal_unit_types",
    "decoder_status", "decoder_message", "jpeg_bytes", "jpeg_sha256", "width", "height",
    "pose_status", "pose_before_us", "pose_after_us", "pose_alpha",
    "scanner_x", "scanner_y", "scanner_z", "scanner_qx", "scanner_qy", "scanner_qz", "scanner_qw",
    "camera_extrinsics",
]


# ---------------------------------------------------------------------------
# frames.csv → capture events


@dataclass
class IndexedFrame:
    sequence: int
    timestamp_us: int
    sps_offset: int
    message_offset: int
    h264_bytes: int
    width: int
    height: int
    stream: str
    pair_id: Optional[int]


@dataclass
class Event:
    """One synchronised capture: exactly one frame per camera stream."""
    pair_id: int
    frames: dict[str, IndexedFrame]

    @property
    def time_us(self) -> int:
        return min(f.timestamp_us for f in self.frames.values())

    @property
    def sequence(self) -> int:
        return next(iter(self.frames.values())).sequence


def read_index(path: Path) -> tuple[list[Event], Counter]:
    """Complete ch14 + ch18 pairs from frames.csv, and counts of what was left out."""
    left_out = Counter()
    groups: dict[int, list[IndexedFrame]] = defaultdict(list)
    with open(path, newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        missing = {"sequence", "timestamp_us", "sps_offset", "message_offset", "h264_bytes", "width", "height",
                   "camera_stream", "pair_status", "pair_id"} - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"error: {path} lacks columns {sorted(missing)}; was it written by index_xbin.py?")
        for row in reader:
            if row["pair_status"] != "paired":
                left_out[f"frame {row['pair_status']}"] += 1
                continue
            try:
                frame = IndexedFrame(
                    sequence=int(row["sequence"]), timestamp_us=int(row["timestamp_us"]),
                    sps_offset=int(row["sps_offset"]), message_offset=int(row["message_offset"]),
                    h264_bytes=int(row["h264_bytes"]), width=int(row["width"]), height=int(row["height"]),
                    stream=row["camera_stream"], pair_id=int(row["pair_id"]),
                )
            except ValueError as error:
                raise SystemExit(f"error: {path} line {reader.line_num}: {error}") from None
            groups[frame.pair_id].append(frame)  # type: ignore[index]

    events = []
    for pair_id, members in groups.items():
        streams = sorted(f.stream for f in members)
        if streams != sorted(CAMERA_STREAMS):
            left_out[f"pair without exactly one {' + '.join(CAMERA_STREAMS)} frame"] += 1
            continue
        events.append(Event(pair_id, {f.stream: f for f in members}))
    events.sort(key=lambda e: e.time_us)
    return events, left_out


# ---------------------------------------------------------------------------
# Poses


@dataclass
class Poses:
    times_us: list[int]
    positions: list[tuple[float, float, float]]
    quaternions: list[tuple[float, float, float, float]]  # x, y, z, w


def read_poses(path: Path) -> Poses:
    times, positions, quaternions = [], [], []
    with open(path, encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            if len(parts) != 8:
                raise SystemExit(f"error: {path}:{line_number}: expected 8 columns (t, x, y, z, qx, qy, qz, qw), got {len(parts)}")
            try:
                t = int((Decimal(parts[0]) * 1_000_000).to_integral_value())
                x, y, z, qx, qy, qz, qw = (float(p) for p in parts[1:])
            except (InvalidOperation, ValueError):
                raise SystemExit(f"error: {path}:{line_number}: not numeric: {line!r}") from None
            if times and t <= times[-1]:
                raise SystemExit(f"error: {path}:{line_number}: timestamps must increase strictly")
            norm = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
            if abs(norm - 1) > QUATERNION_NORM_TOLERANCE:
                raise SystemExit(f"error: {path}:{line_number}: |q| = {norm:.4f}; columns are probably not qx, qy, qz, qw")
            times.append(t)
            positions.append((x, y, z))
            quaternions.append((qx / norm, qy / norm, qz / norm, qw / norm))
    if len(times) < 2:
        raise SystemExit(f"error: {path} needs at least two poses")
    return Poses(times, positions, quaternions)


def slerp(q0: tuple[float, ...], q1: tuple[float, ...], alpha: float) -> tuple[float, float, float, float]:
    """Spherical linear interpolation of unit quaternions (any component order, same for both), shortest arc."""
    if sum(a * b for a, b in zip(q0, q1)) < 0:  # q and −q are the same rotation; take the short way round
        q1 = tuple(-c for c in q1)
    # Angle between the quaternions; atan2 stays accurate for the tiny angles of
    # 100 ms pose steps, where acos(dot) loses precision.
    theta = 2 * math.atan2(math.dist(q0, q1), math.hypot(*(a + b for a, b in zip(q0, q1))))
    if theta < 1e-6:  # identical to ~1e-12 after normalising; avoids dividing by sin(θ) ≈ 0
        out = [a + alpha * (b - a) for a, b in zip(q0, q1)]
    else:
        s0 = math.sin((1 - alpha) * theta) / math.sin(theta)
        s1 = math.sin(alpha * theta) / math.sin(theta)
        out = [s0 * a + s1 * b for a, b in zip(q0, q1)]
    norm = math.sqrt(sum(c * c for c in out))
    return tuple(c / norm for c in out)  # type: ignore[return-value]


@dataclass
class ScannerPose:
    before_us: int
    after_us: int
    alpha: float
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]  # x, y, z, w


def interpolate_pose(poses: Poses, t: int) -> Optional[ScannerPose]:
    """Scanner pose at t (µs) between the adjacent samples, or None outside the pose range."""
    times = poses.times_us
    if not times[0] <= t <= times[-1]:
        return None
    k = min(bisect.bisect_right(times, t) - 1, len(times) - 2)
    t0, t1 = times[k], times[k + 1]
    alpha = (t - t0) / (t1 - t0)
    p0, p1 = poses.positions[k], poses.positions[k + 1]
    position = tuple(a + alpha * (b - a) for a, b in zip(p0, p1))
    return ScannerPose(t0, t1, alpha, position, slerp(poses.quaternions[k], poses.quaternions[k + 1], alpha))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Selection


def sample_by_interval(events: list[Event], interval_us: int) -> list[Event]:
    """The first event at or after each grid time t0, t0 + Δ, t0 + 2Δ, … (t0 = first event); each event once."""
    times = [e.time_us for e in events]
    chosen = []
    target = times[0]
    while True:
        k = bisect.bisect_left(times, target)
        if k == len(times):
            return chosen
        chosen.append(events[k])
        while target <= times[k]:
            target += interval_us


# ---------------------------------------------------------------------------
# Decoding and checks


def nal_unit_types(data: bytes) -> list[int]:
    types = []
    i = data.find(b"\x00\x00\x01")
    while i != -1 and i + 3 < len(data):
        types.append(data[i + 3] & 0x1F)
        i = data.find(b"\x00\x00\x01", i + 3)
    return types


def jpeg_size(data: bytes) -> tuple[int, int]:
    """(width, height) from the SOF marker; raises ValueError for a damaged or truncated JPEG."""
    if data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        raise ValueError("missing JPEG start/end marker")
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            raise ValueError(f"bad JPEG marker at {i}")
        marker = data[i + 1]
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            return width, height
        i += 2 + length
    raise ValueError("no SOF marker")


@dataclass
class Decoded:
    status: str  # ok | decoded-with-errors | failed | read-error | index-mismatch | dimension-mismatch
    message: str = ""
    nal_types: str = ""
    jpeg_bytes: Optional[int] = None
    sha256: str = ""
    width: Optional[int] = None
    height: Optional[int] = None


def decode_image(fd: int, file_size: int, frame: IndexedFrame, target: Path, quality: int) -> Decoded:
    try:
        check = decode_frame(fd, frame.sps_offset, file_size)
    except Malformed as error:
        return Decoded("index-mismatch", f"metadata no longer decodes at this offset: {error}")
    expected = (frame.sequence, frame.timestamp_us, frame.message_offset, frame.h264_bytes)
    found = (check.sequence, check.timestamp_us, check.message_offset, check.h264_bytes)
    if found != expected:
        return Decoded("index-mismatch", f"recording has {found}, frames.csv {expected}")

    data = os.pread(fd, frame.h264_bytes, frame.sps_offset)
    nal_types = nal_unit_types(data)
    nal_text = ",".join(map(str, nal_types))
    if len(data) != frame.h264_bytes:
        return Decoded("read-error", f"read {len(data)} of {frame.h264_bytes} bytes", nal_text)
    if not data.startswith(SPS_SIGNATURE):
        return Decoded("read-error", "bytes do not start with the SPS signature", nal_text)

    partial = target.with_name(target.name + ".partial")
    command = [
        # "warning", not "error": a frame with damaged slice data is only reported as
        # "corrupt decoded frame" (a warning) while FFmpeg conceals it and exits 0.
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "warning",
        "-f", "h264", "-i", "pipe:0",
        "-frames:v", "1", "-c:v", "mjpeg", "-q:v", str(quality), "-f", "mjpeg", "-y", str(partial),
    ]
    try:
        result = subprocess.run(command, input=data, capture_output=True, timeout=FFMPEG_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        partial.unlink(missing_ok=True)
        return Decoded("failed", f"FFmpeg timed out after {FFMPEG_TIMEOUT_S} s", nal_text)
    errors = " | ".join(result.stderr.decode("utf-8", "replace").split("\n")).strip(" |")
    if result.returncode != 0 or not partial.is_file() or partial.stat().st_size == 0:
        partial.unlink(missing_ok=True)
        return Decoded("failed", f"FFmpeg exit {result.returncode}: {errors or 'no output'}"[:500], nal_text)

    jpeg = partial.read_bytes()
    try:
        width, height = jpeg_size(jpeg)
    except ValueError as error:
        partial.unlink(missing_ok=True)
        return Decoded("failed", f"FFmpeg wrote an invalid JPEG: {error}", nal_text)
    partial.replace(target)
    decoded = Decoded("ok", errors[:500], nal_text, len(jpeg), hashlib.sha256(jpeg).hexdigest(), width, height)
    if (width, height) != (frame.width, frame.height):
        decoded.status = "dimension-mismatch"
        decoded.message = f"JPEG is {width}×{height}, recording declares {frame.width}×{frame.height}"
    elif errors:
        decoded.status = "decoded-with-errors"
    elif 5 not in nal_types:
        decoded.message = "no IDR slice; decoded anyway"
    return decoded


def ffmpeg_version() -> str:
    try:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=10).stdout
        return out.split("\n", 1)[0]
    except (OSError, subprocess.TimeoutExpired):
        return ""


# ---------------------------------------------------------------------------
# CLI


def file_state(path: Path) -> tuple[int, int]:
    s = path.stat()
    return s.st_size, s.st_mtime_ns


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def fmt(value: Optional[float], digits: int = 6) -> str:
    return "" if value is None else f"{value:.{digits}f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("xbin", type=Path, help="the .xbin recording (read only)")
    parser.add_argument("--frames", type=Path, help="frames.csv from index_xbin.py (default: <xbin folder>/reconstruction/xgrids/metadata/frames.csv)")
    parser.add_argument("--poses", type=Path, help="poses.csv (default: <xbin folder>/project_data/poses.csv)")
    pick = parser.add_mutually_exclusive_group()
    pick.add_argument("--interval", type=float, default=10.0, help="seconds between selected capture events (default 10)")
    pick.add_argument("--validation", action="store_true", help="only the first, middle and last eligible events")
    pick.add_argument("--sequences", help="comma-separated sequence numbers to extract")
    parser.add_argument("--quality", type=int, default=2, help="FFmpeg JPEG quality -q:v, 2 (best, largest) … 31 (default 2)")
    parser.add_argument("--include-outside-poses", action="store_true", help="also extract events outside the pose time range (pose columns left empty)")
    parser.add_argument("--max-pose-gap-ms", type=float, default=200, help="exclude events whose adjacent pose samples are further apart (default 200)")
    parser.add_argument("--out", type=Path, help="output folder (default: <xbin folder>/reconstruction/xgrids/images/<run name>)")
    parser.add_argument("--run-name", help="output subfolder name (default: validation, sequences or interval-<N>s)")
    parser.add_argument("--dry-run", action="store_true", help="report the selection without decoding anything")
    args = parser.parse_args()

    if not args.xbin.is_file():
        raise SystemExit(f"error: {args.xbin} is not a file")
    if not 2 <= args.quality <= 31:
        raise SystemExit("error: --quality must be between 2 and 31")
    if not args.validation and not args.sequences and args.interval <= 0:
        raise SystemExit("error: --interval must be positive")
    frames_path = args.frames or args.xbin.parent / "reconstruction" / "xgrids" / "metadata" / "frames.csv"
    poses_path = args.poses or args.xbin.parent / "project_data" / "poses.csv"
    for label, path in (("frames.csv", frames_path), ("poses.csv", poses_path)):
        if not path.is_file():
            raise SystemExit(f"error: {label} not found at {path}")
    run_name = args.run_name or ("validation" if args.validation else "sequences" if args.sequences else f"interval-{args.interval:g}s")
    out = (args.out or args.xbin.parent / "reconstruction" / "xgrids" / "images" / run_name).resolve()
    if out.is_relative_to(REPO_ROOT) and not out.is_relative_to(REPO_ROOT / "reconstruction"):
        raise SystemExit(f"error: {out} is inside the Git repository; write generated images outside tracked folders")
    if not args.dry_run and not shutil.which("ffmpeg"):
        raise SystemExit("error: ffmpeg not found on PATH (macOS: brew install ffmpeg)")

    # The index must describe this recording: same size, and every frame is re-checked before decoding.
    summary_path = frames_path.parent / "index-summary.json"
    source_state = file_state(args.xbin)
    poses_state = file_state(poses_path)
    if summary_path.is_file():
        indexed = json.loads(summary_path.read_text(encoding="utf-8")).get("source", {})
        if indexed.get("bytes") not in (None, source_state[0]):
            raise SystemExit(f"error: {frames_path} indexes a {indexed['bytes']:,}-byte file, {args.xbin} has {source_state[0]:,} bytes")
        if indexed.get("modifiedNs") not in (None, source_state[1]):
            print("warning: the recording's modification time differs from when it was indexed; frames are re-checked", file=sys.stderr)

    events, left_out = read_index(frames_path)
    if not events:
        raise SystemExit(f"error: no complete {' + '.join(CAMERA_STREAMS)} pairs in {frames_path}")
    poses = read_poses(poses_path)
    max_gap_us = int(args.max_pose_gap_ms * 1000)

    # Eligibility: both images inside the pose range, with adjacent pose samples close enough.
    eligible, outside, gap_excluded = [], [], []
    for event in events:
        frame_poses = {s: interpolate_pose(poses, f.timestamp_us) for s, f in event.frames.items()}
        if any(p is None for p in frame_poses.values()):
            outside.append(event)
        elif any(p.after_us - p.before_us > max_gap_us for p in frame_poses.values()):  # type: ignore[union-attr]
            gap_excluded.append(event)
        else:
            eligible.append(event)
    candidates = eligible + outside if args.include_outside_poses else eligible
    candidates.sort(key=lambda e: e.time_us)
    if not candidates:
        raise SystemExit("error: no eligible capture events (none inside the pose time range)")

    if args.validation:
        selected = [candidates[0], candidates[len(candidates) // 2], candidates[-1]]
        mode = "validation (first, middle, last eligible event)"
    elif args.sequences:
        wanted = [int(s) for s in args.sequences.split(",") if s.strip()]
        by_sequence = defaultdict(list)
        for event in candidates:
            by_sequence[event.sequence].append(event)
        missing = [s for s in wanted if s not in by_sequence]
        if missing:
            raise SystemExit(f"error: sequences {missing} are not eligible complete pairs (outside poses, pose gap, or not paired)")
        selected = sorted({id(e): e for s in wanted for e in by_sequence[s]}.values(), key=lambda e: e.time_us)
        mode = f"sequences {wanted}"
    else:
        selected = sample_by_interval(candidates, int(round(args.interval * 1_000_000)))
        mode = f"one event every {args.interval:g} s"

    def describe(group: list[Event]) -> Optional[dict]:
        if not group:
            return None
        return {
            "events": len(group), "images": 2 * len(group),
            "sequences": [group[0].sequence, group[-1].sequence] if len(group) > 1 else [group[0].sequence],
            "firstUtc": utc(group[0].time_us), "lastUtc": utc(group[-1].time_us),
        }

    print(f"Capture events: {len(events):,} complete pairs in {frames_path.name}; eligible {len(eligible):,}")
    print(f"Excluded, outside pose range ({utc(poses.times_us[0])} → {utc(poses.times_us[-1])}): "
          f"{describe(outside) or 'none'}{'  [included: --include-outside-poses]' if args.include_outside_poses else ''}")
    print(f"Excluded, pose samples > {args.max_pose_gap_ms:g} ms apart: {describe(gap_excluded) or 'none'}")
    if left_out:
        print(f"Not complete pairs in frames.csv: {dict(left_out)}")
    print(f"Selected ({mode}): {len(selected):,} events = {2 * len(selected):,} images → {out}")

    if args.dry_run:
        for event in selected:
            print(f"  seq {event.sequence:5d}  {utc(event.time_us)}")
        return

    needed = 2 * len(selected) * ESTIMATED_JPEG_BYTES
    out.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(out).free
    if needed + (1 << 30) > free:
        raise SystemExit(f"error: about {needed / 1e9:.1f} GB needed, only {free / 1e9:.1f} GB free at {out}")

    rows = []
    statuses = Counter()
    complete_events = 0
    started = time.monotonic()
    with open(args.xbin, "rb") as stream:
        fd = stream.fileno()
        file_size = source_state[0]
        for index, event in enumerate(selected):
            event_ok = True
            for channel in CAMERA_STREAMS:
                frame = event.frames[channel]
                name = f"seq{frame.sequence:05d}_{channel}_t{frame.timestamp_us}.jpg"
                decoded = decode_image(fd, file_size, frame, out / name, args.quality)
                pose = interpolate_pose(poses, frame.timestamp_us)
                statuses[decoded.status] += 1
                event_ok &= decoded.status == "ok"
                rows.append([
                    name if decoded.jpeg_bytes else "", index, event.pair_id, frame.sequence, channel,
                    frame.timestamp_us, utc(frame.timestamp_us), frame.sps_offset, frame.message_offset,
                    frame.h264_bytes, decoded.nal_types, decoded.status, decoded.message,
                    decoded.jpeg_bytes or "", decoded.sha256, decoded.width or "", decoded.height or "",
                    "interpolated" if pose else "outside pose range",
                    pose.before_us if pose else "", pose.after_us if pose else "", fmt(pose.alpha if pose else None),
                    *(fmt(c) for c in (pose.position if pose else (None,) * 3)),
                    *(fmt(c, 9) for c in (pose.quaternion if pose else (None,) * 4)),
                    "unknown",
                ])
                if decoded.status != "ok":
                    print(f"  ! seq {frame.sequence} {channel}: {decoded.status}: {decoded.message}", file=sys.stderr)
            complete_events += event_ok
            print(f"  [{index + 1}/{len(selected)}] seq {event.sequence:5d}  {utc(event.time_us)}  "
                  f"{'ok' if event_ok else 'INCOMPLETE'}", file=sys.stderr, flush=True)

    with open(out / "manifest.csv", "w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(MANIFEST_COLUMNS)
        writer.writerows(rows)

    unchanged = file_state(args.xbin) == source_state and file_state(poses_path) == poses_state
    summary = {
        "source": {"xbin": str(args.xbin.resolve()), "bytes": source_state[0], "modifiedNs": source_state[1],
                   "frames": str(frames_path.resolve()), "framesSha256": sha256_file(frames_path),
                   "poses": str(poses_path.resolve()), "posesSha256": sha256_file(poses_path),
                   "unchangedDuringExtraction": unchanged},
        "parameters": {"mode": mode, "intervalSeconds": None if args.validation or args.sequences else args.interval,
                       "jpegQuality": args.quality, "includeOutsidePoses": args.include_outside_poses,
                       "maxPoseGapMs": args.max_pose_gap_ms, "ffmpeg": ffmpeg_version()},
        "captureEvents": len(events),
        "notCompletePairs": dict(left_out),
        "eligibleEvents": len(eligible),
        "excludedOutsidePoseRange": describe(outside),
        "excludedPoseGap": describe(gap_excluded),
        "poseRange": {"firstUs": poses.times_us[0], "lastUs": poses.times_us[-1],
                      "firstUtc": utc(poses.times_us[0]), "lastUtc": utc(poses.times_us[-1]), "count": len(poses.times_us)},
        "selectedEvents": len(selected),
        "completeEvents": complete_events,
        "imageStatus": dict(statuses),
        "seconds": round(time.monotonic() - started, 1),
        "notes": [
            "scanner_* columns are the scanner pose from poses.csv interpolated at each image timestamp (XYZ linear, "
            "quaternion SLERP, qx qy qz qw scalar last), in the poses.csv frame. They are NOT optical camera poses: "
            "camera-to-scanner extrinsics are unknown (camera_extrinsics = unknown).",
            "camera_channel is the XBAG channel id (ch14, ch18); which physical camera each is has not been established.",
            "Images are the recording's H.264 intra frames decoded by FFmpeg and re-encoded as JPEG (lossy, -q:v jpegQuality); "
            "the original H.264 bytes stay in the .xbin.",
        ],
    }
    with open(out / "extraction-summary.json", "w", encoding="utf-8") as stream:
        json.dump(summary, stream, indent=2)
        stream.write("\n")

    print(f"Images: {dict(statuses)}; complete events {complete_events}/{len(selected)}; {summary['seconds']} s")
    print(f"Wrote {out / 'manifest.csv'} and {out / 'extraction-summary.json'}")
    if not unchanged:
        print("warning: the recording or poses.csv changed during extraction", file=sys.stderr)
    if complete_events != len(selected):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
