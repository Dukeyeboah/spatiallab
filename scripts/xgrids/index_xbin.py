#!/usr/bin/env python3
"""
Index the H.264 camera frames of an XGRIDS LixelKity K1 raw recording (.xbin,
container signature "XBAG") without extracting or decoding any image.

    python3 scripts/xgrids/index_xbin.py /path/to/2026-07-15-101012-003.xbin
    python3 scripts/xgrids/index_xbin.py rec.xbin --max-bytes 67108864   # first 64 MiB only

Writes <out>/frames.csv and <out>/index-summary.json (default out:
<xbin folder>/reconstruction/xgrids/metadata). Standard library only; the
recording is opened read-only and read sequentially in chunks.

What was reverse-engineered (from our own recording; provisional, not a spec;
full notes and what is verified: docs/xgrids/xbag-format.md)
----------------------------------------------------------------------------
Discovery heuristic: every camera image found so far starts with this SPS
(4000 × 3000 High profile). Images that start differently are not indexed.

    00 00 00 01 67 64 10 3c

Each image is one protobuf-encoded message that ends with the image bytes:

    0a <varint L>                  outer message, L bytes follow
       0a <varint n>               field 1: header (n bytes)
          08 <varint>              field 1: sequence number (absent when 0, proto3 default)
          10 <varint>              field 2: timestamp, ZigZag (sint64), microseconds since 1970 UTC
          18 <varint>              field 3: unknown (20000 in every frame seen)
       10 <varint>                 field 2: unknown (3)
       18 <varint>                 field 3: width  (4000)
       20 <varint>                 field 4: height (3000)
       2a <varint m>               field 5: H.264 Annex B bytes, starting with the SPS
       32 <varint k> ...           field 6: unknown small message after the image

Image messages are stored in batches. Each batch is preceded by a 48-byte
header (little-endian), and the batch's messages fill its payload exactly:

    u32 record length (= payload length + 52)   u16 1   u16 36
    u64 write time (µs)                         u32 payload length
    u32 message count                           u64 first message timestamp (µs)
    u64 last message timestamp (µs)             u32 channel id
    u32 payload length (again)

The channel id (14 and 18 in our recording) separates the two cameras. A
frame gets a camera stream only when its batch header agrees exactly with the
frames found inside it (count, first/last timestamp, contiguous messages).

Not assumed: that the bytes between two SPS signatures form one clean image
(the declared field-5 length is reported instead), that every XBAG record is
understood, or that a repeated sequence number always means the same capture.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import os
import struct
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import median
from typing import Optional

SPS_SIGNATURE = bytes.fromhex("00 00 00 01 67 64 10 3c")
CONTAINER_SIGNATURE = b"XBAG"
# Bytes 4..8 of a batch header: u16 1, u16 36.
BATCH_MARKER = bytes.fromhex("01 00 24 00")
BATCH_HEADER = struct.Struct("<IHHQIIQQII")  # 48 bytes, layout in the module docstring
BATCH_HEADER_EXTRA = 52  # record length - payload length

# Metadata sits right before the SPS: outer tag + length (≤ 6 bytes), header
# (≤ ~30 bytes), fields 2–4 and the field-5 tag + length. 96 bytes is ample.
LOOKBACK_BYTES = 96
MAX_TRAILER_BYTES = 256

# Plausibility limits for decoded values.
MIN_TIMESTAMP_US = int(datetime(2015, 1, 1, tzinfo=timezone.utc).timestamp()) * 1_000_000
MAX_TIMESTAMP_US = int(datetime(2040, 1, 1, tzinfo=timezone.utc).timestamp()) * 1_000_000
MAX_DIMENSION = 16384
MIN_IMAGE_BYTES = 1_000
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_BATCH_MESSAGES = 100_000

PAIR_WINDOW_US = 5_000  # 5 ms


class Malformed(ValueError):
    """A candidate that doesn't decode exactly as the observed layout."""


# ---------------------------------------------------------------------------
# Protobuf wire format (only the two wire types seen: 0 = varint, 2 = length-delimited)


def read_varint(buf: bytes, i: int, end: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        if i >= end:
            raise Malformed("truncated varint")
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7
        if shift >= 64:
            raise Malformed("varint longer than 10 bytes")


def zigzag_decode(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def parse_fields(buf: bytes, i: int, end: int) -> list[tuple[int, int, object, int]]:
    """All fields of buf[i:end] as (field number, wire type, value, value offset); must end exactly at end."""
    fields = []
    while i < end:
        key, i = read_varint(buf, i, end)
        number, wire_type = key >> 3, key & 7
        if number == 0:
            raise Malformed("field number 0")
        if wire_type == 0:
            value, i = read_varint(buf, i, end)
            fields.append((number, 0, value, i))
        elif wire_type == 2:
            length, i = read_varint(buf, i, end)
            if i + length > end:
                raise Malformed(f"field {number} overruns its message")
            fields.append((number, 2, buf[i : i + length], i))
            i += length
        else:
            raise Malformed(f"unexpected wire type {wire_type} (field {number})")
    if i != end:
        raise Malformed("message length mismatch")
    return fields


# ---------------------------------------------------------------------------
# One frame's metadata


@dataclass
class Frame:
    sps_offset: int
    message_offset: int  # the outer 0a tag
    message_end: int
    sequence: int
    timestamp_us: int
    width: int
    height: int
    h264_bytes: int
    stream: str = ""
    stream_evidence: str = ""
    pair_status: str = "unpaired"
    pair_id: Optional[int] = None
    partner_sps_offset: Optional[int] = None
    pair_dt_us: Optional[int] = None


def decode_header(raw: bytes) -> tuple[int, int]:
    """Header sub-message → (sequence, timestamp µs)."""
    sequence = 0
    timestamp = None
    seen = Counter()
    for number, wire_type, value, _ in parse_fields(raw, 0, len(raw)):
        seen[number] += 1
        if seen[number] > 1:
            raise Malformed(f"header field {number} repeated")
        if wire_type != 0 or number not in (1, 2, 3):
            raise Malformed(f"unexpected header field {number}")
        if number == 1:
            sequence = value
        elif number == 2:
            timestamp = zigzag_decode(value)
    if timestamp is None:
        raise Malformed("header has no timestamp")
    if not MIN_TIMESTAMP_US <= timestamp <= MAX_TIMESTAMP_US:
        raise Malformed(f"implausible timestamp {timestamp}")
    return sequence, timestamp


def decode_prefix(window: bytes, start: int) -> Optional[tuple[int, int, dict]]:
    """
    Tries the outer message starting at window[start]. Succeeds only if its
    fields 1–4 are followed by field 5 whose bytes start exactly at the end
    of the window (where the SPS is). Returns (outer length, field-5 length, fields).
    """
    end = len(window)
    if window[start] != 0x0A:
        return None
    try:
        outer_length, i = read_varint(window, start + 1, end)
        found: dict[int, object] = {}
        while i < end:
            key, i = read_varint(window, i, end)
            number, wire_type = key >> 3, key & 7
            if number in found:
                return None
            if number == 1 and wire_type == 2:
                length, i = read_varint(window, i, end)
                if i + length > end:
                    return None
                found[1] = window[i : i + length]
                i += length
            elif number in (2, 3, 4) and wire_type == 0:
                found[number], i = read_varint(window, i, end)
            elif number == 5 and wire_type == 2:
                length, i = read_varint(window, i, end)
                if i != end:
                    return None
                found[5] = length
                return outer_length, length, found
            else:
                return None
    except Malformed:
        return None
    return None


def decode_frame(fd: int, sps_offset: int, file_size: int) -> Frame:
    window_start = max(0, sps_offset - LOOKBACK_BYTES)
    window = os.pread(fd, sps_offset - window_start, window_start)

    candidates = []
    for start in range(len(window) - 1, -1, -1):
        decoded = decode_prefix(window, start)
        if decoded:
            candidates.append((start, decoded))
    if not candidates:
        raise Malformed("no protobuf image message ends at this SPS")
    if len(candidates) > 1:
        raise Malformed(f"ambiguous: {len(candidates)} possible message starts")

    start, (outer_length, image_bytes, found) = candidates[0]
    if set(found) != {1, 2, 3, 4, 5}:
        raise Malformed(f"fields {sorted(found)} instead of 1–5")
    sequence, timestamp = decode_header(found[1])  # type: ignore[arg-type]
    width, height = found[3], found[4]
    if not (0 < width <= MAX_DIMENSION and 0 < height <= MAX_DIMENSION):  # type: ignore[operator]
        raise Malformed(f"implausible size {width}×{height}")
    if not MIN_IMAGE_BYTES <= image_bytes <= MAX_IMAGE_BYTES:
        raise Malformed(f"implausible image length {image_bytes}")

    message_offset = window_start + start
    tag_and_length = len(b"\x0a") + _varint_size(outer_length)
    message_end = message_offset + tag_and_length + outer_length
    image_end = sps_offset + image_bytes
    if image_end > message_end:
        raise Malformed("image bytes overrun the outer message")
    if message_end > file_size:
        raise Malformed("message is cut off by the end of the file")

    # The rest of the outer message (after the image) must be exactly field 6.
    trailer_length = message_end - image_end
    if trailer_length > MAX_TRAILER_BYTES:
        raise Malformed(f"{trailer_length} unexplained bytes after the image")
    trailer = os.pread(fd, trailer_length, image_end)
    trailer_fields = parse_fields(trailer, 0, len(trailer))
    if [(number, wire_type) for number, wire_type, _, _ in trailer_fields] != [(6, 2)]:
        raise Malformed("bytes after the image are not a single field 6")

    return Frame(
        sps_offset=sps_offset,
        message_offset=message_offset,
        message_end=message_end,
        sequence=sequence,
        timestamp_us=timestamp,
        width=width,  # type: ignore[arg-type]
        height=height,  # type: ignore[arg-type]
        h264_bytes=image_bytes,
    )


def _varint_size(value: int) -> int:
    size = 1
    while value >= 0x80:
        value >>= 7
        size += 1
    return size


# ---------------------------------------------------------------------------
# XBAG batch headers


@dataclass
class Batch:
    header_offset: int
    payload_start: int
    payload_end: int
    channel: int
    count: int
    first_timestamp_us: int
    last_timestamp_us: int
    frames: list[Frame] = field(default_factory=list)


def decode_batch(fd: int, marker_offset: int, file_size: int) -> Optional[Batch]:
    header_offset = marker_offset - 4
    if header_offset < 0 or header_offset + BATCH_HEADER.size > file_size:
        return None
    raw = os.pread(fd, BATCH_HEADER.size, header_offset)
    if len(raw) != BATCH_HEADER.size:
        return None
    (record_length, one, header_length, write_time, payload_length, count,
     first_ts, last_ts, channel, payload_length_again) = BATCH_HEADER.unpack(raw)
    if (one, header_length) != (1, 36):
        return None
    if payload_length != payload_length_again or record_length != payload_length + BATCH_HEADER_EXTRA:
        return None
    if not 1 <= count <= MAX_BATCH_MESSAGES or not 0 <= channel < 1_000_000:
        return None
    if not (MIN_TIMESTAMP_US <= first_ts <= last_ts <= MAX_TIMESTAMP_US and MIN_TIMESTAMP_US <= write_time <= MAX_TIMESTAMP_US):
        return None
    payload_start = header_offset + BATCH_HEADER.size
    if payload_start + payload_length > file_size:
        return None
    return Batch(header_offset, payload_start, payload_start + payload_length, channel, count, first_ts, last_ts)


def verify_batch(batch: Batch) -> Optional[str]:
    """None if the batch header agrees exactly with its frames, otherwise why not."""
    frames = batch.frames
    if len(frames) != batch.count:
        return f"header says {batch.count} messages, {len(frames)} frames decoded"
    if frames[0].message_offset != batch.payload_start or frames[-1].message_end != batch.payload_end:
        return "frames don't fill the batch payload"
    for previous, current in zip(frames, frames[1:]):
        if previous.message_end != current.message_offset:
            return "gap or overlap between frame messages"
    if frames[0].timestamp_us != batch.first_timestamp_us or frames[-1].timestamp_us != batch.last_timestamp_us:
        return "first/last timestamps differ from the header"
    return None


# ---------------------------------------------------------------------------
# Scan


def scan(path: Path, chunk_bytes: int, max_bytes: Optional[int], quiet: bool):
    file_size = path.stat().st_size
    limit = min(file_size, max_bytes) if max_bytes else file_size
    frames: list[Frame] = []
    batches: list[Batch] = []
    batch_channels = Counter()
    rejected: list[dict] = []
    rejection_reasons = Counter()
    sps_matches = 0

    # Patterns can straddle two chunks: keep the last (longest pattern − 1)
    # bytes and accept a match only beyond the previous accepted one, so each
    # offset is indexed exactly once.
    overlap = max(len(SPS_SIGNATURE), len(BATCH_MARKER)) - 1
    last_accepted = {SPS_SIGNATURE: -1, BATCH_MARKER: -1}

    started = time.monotonic()
    last_report = 0.0
    with open(path, "rb") as stream:
        fd = stream.fileno()
        if os.pread(fd, 4, 0) != CONTAINER_SIGNATURE:
            raise SystemExit(f"error: {path} does not start with the XBAG signature; is this an XGRIDS .xbin?")

        tail = b""
        position = 0  # absolute offset of the next byte to read
        while position < limit:
            data = stream.read(min(chunk_bytes, limit - position))
            if not data:
                break
            buffer = tail + data
            base = position - len(tail)

            for pattern in (SPS_SIGNATURE, BATCH_MARKER):
                i = buffer.find(pattern)
                while i != -1:
                    offset = base + i
                    if offset > last_accepted[pattern] and offset < limit:
                        last_accepted[pattern] = offset
                        if pattern is SPS_SIGNATURE:
                            sps_matches += 1
                            try:
                                frames.append(decode_frame(fd, offset, file_size))
                            except Malformed as error:
                                rejection_reasons[_reason_kind(str(error))] += 1
                                if len(rejected) < 200:
                                    rejected.append({"spsOffset": offset, "reason": str(error)})
                        else:
                            batch = decode_batch(fd, offset, file_size)
                            if batch:
                                batches.append(batch)
                                batch_channels[batch.channel] += 1
                    i = buffer.find(pattern, i + 1)

            position += len(data)
            tail = buffer[-overlap:]

            now = time.monotonic()
            if not quiet and (now - last_report >= 2 or position >= limit):
                last_report = now
                elapsed = now - started
                rate = position / elapsed if elapsed > 0 else 0
                eta = (limit - position) / rate if rate else 0
                print(
                    f"  {100 * position / limit:5.1f}%  {position / 1e9:6.2f} / {limit / 1e9:.2f} GB"
                    f"  {rate / 1e9:4.2f} GB/s  ETA {eta:4.0f} s  "
                    f"SPS {sps_matches:,}  frames {len(frames):,}  rejected {sps_matches - len(frames):,}",
                    file=sys.stderr,
                    flush=True,
                )

    return {
        "file_size": file_size,
        "scanned_bytes": limit,
        "seconds": time.monotonic() - started,
        "sps_matches": sps_matches,
        "frames": frames,
        "batches": batches,
        "batch_channels": batch_channels,
        "rejected": rejected,
        "rejection_reasons": rejection_reasons,
    }


def _reason_kind(message: str) -> str:
    return message.split(":")[0].split(" (")[0]


# ---------------------------------------------------------------------------
# Camera streams and pairing


def assign_streams(frames: list[Frame], batches: list[Batch]) -> Counter:
    """Frame → channel of its batch, only for batches whose header matches its frames exactly."""
    outcomes = Counter()
    batches.sort(key=lambda b: b.payload_start)
    starts = [b.payload_start for b in batches]
    for frame in frames:
        k = bisect.bisect_right(starts, frame.message_offset) - 1
        if k >= 0 and frame.message_offset < batches[k].payload_end:
            batches[k].frames.append(frame)
        else:
            frame.stream_evidence = "not inside a recognised batch"
            outcomes["no batch"] += 1
    for batch in batches:
        if not batch.frames:
            continue
        problem = verify_batch(batch)
        for frame in batch.frames:
            if problem:
                frame.stream_evidence = f"batch at {batch.header_offset}: {problem}"
            else:
                frame.stream = f"ch{batch.channel}"
                frame.stream_evidence = f"batch at {batch.header_offset}"
        outcomes["batch mismatch" if problem else "assigned"] += len(batch.frames)
    return outcomes


def pair_frames(frames: list[Frame]) -> dict:
    """
    Pairs = same sequence number, |Δt| ≤ 5 ms, different camera streams when
    both are known. A frame with more than one possible partner is marked
    ambiguous instead of guessing. Repeated sequence numbers further apart in
    time (e.g. after a counter reset) are simply not paired.
    """
    by_sequence: dict[int, list[Frame]] = defaultdict(list)
    for frame in frames:
        by_sequence[frame.sequence].append(frame)

    pair_count = 0
    for group in by_sequence.values():
        candidates = []
        for a_index, a in enumerate(group):
            for b in group[a_index + 1 :]:
                dt = abs(a.timestamp_us - b.timestamp_us)
                if dt > PAIR_WINDOW_US:
                    continue
                if a.stream and b.stream and a.stream == b.stream:
                    continue
                candidates.append((a, b))
        options = Counter()
        for a, b in candidates:
            options[id(a)] += 1
            options[id(b)] += 1
        for a, b in candidates:
            if options[id(a)] > 1 or options[id(b)] > 1:
                a.pair_status = b.pair_status = "ambiguous"
                continue
            first, second = sorted((a, b), key=lambda f: (f.timestamp_us, f.sps_offset))
            for me, other in ((first, second), (second, first)):
                me.pair_status = "paired"
                me.pair_id = pair_count
                me.partner_sps_offset = other.sps_offset
                me.pair_dt_us = other.timestamp_us - me.timestamp_us
            pair_count += 1

    repeats = {seq: len(group) for seq, group in by_sequence.items() if len(group) > 2}
    return {"pairs": pair_count, "unique_sequences": len(by_sequence), "sequences_seen_more_than_twice": len(repeats)}


# ---------------------------------------------------------------------------
# Poses


def read_pose_times(path: Path) -> list[int]:
    """First column of a header-less poses.csv, as exact integer microseconds."""
    times = []
    with open(path, encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            line = line.strip()
            if not line:
                continue
            first = line.split(",", 1)[0]
            try:
                times.append(int((Decimal(first) * 1_000_000).to_integral_value()))
            except InvalidOperation:
                raise ValueError(f"{path}:{line_number}: timestamp {first!r} is not a number") from None
    if not times:
        raise ValueError(f"{path} has no rows")
    return sorted(times)


def pose_coverage(frames: list[Frame], pose_times: list[int]) -> dict:
    first_pose, last_pose = pose_times[0], pose_times[-1]
    inside = [f for f in frames if first_pose <= f.timestamp_us <= last_pose]
    gaps = []
    for frame in inside:
        k = bisect.bisect_left(pose_times, frame.timestamp_us)
        nearest = min(abs(pose_times[j] - frame.timestamp_us) for j in (k - 1, k) if 0 <= j < len(pose_times))
        gaps.append(nearest)
    frame_times = [f.timestamp_us for f in frames]
    overlap_start = max(first_pose, min(frame_times))
    overlap_end = min(last_pose, max(frame_times))
    return {
        "poseCount": len(pose_times),
        "firstPoseUs": first_pose,
        "lastPoseUs": last_pose,
        "firstPoseUtc": utc(first_pose),
        "lastPoseUtc": utc(last_pose),
        "framesBeforeFirstPose": sum(1 for t in frame_times if t < first_pose),
        "framesInsidePoseRange": len(inside),
        "framesAfterLastPose": sum(1 for t in frame_times if t > last_pose),
        "overlapSeconds": max(0, overlap_end - overlap_start) / 1e6,
        "nearestPoseGapUs": {"median": int(median(gaps)), "max": max(gaps)} if gaps else None,
    }


# ---------------------------------------------------------------------------
# Output


def utc(timestamp_us: int) -> str:
    """Exact ISO-8601 UTC string from integer microseconds (no float rounding)."""
    moment = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(microseconds=timestamp_us)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


CSV_COLUMNS = [
    "sequence", "timestamp_us", "timestamp_utc", "sps_offset", "camera_stream", "pair_status",
    "pair_id", "pair_dt_us", "partner_sps_offset", "message_offset", "h264_bytes", "width", "height",
    "stream_evidence",
]


def write_csv(path: Path, frames: list[Frame]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(CSV_COLUMNS)
        for f in frames:
            writer.writerow([
                f.sequence, f.timestamp_us, utc(f.timestamp_us), f.sps_offset, f.stream, f.pair_status,
                "" if f.pair_id is None else f.pair_id, "" if f.pair_dt_us is None else f.pair_dt_us,
                "" if f.partner_sps_offset is None else f.partner_sps_offset,
                f.message_offset, f.h264_bytes, f.width, f.height, f.stream_evidence,
            ])


def rate_summary(times: list[int]) -> Optional[dict]:
    times = sorted(times)
    if len(times) < 2:
        return None
    intervals = [b - a for a, b in zip(times, times[1:])]
    duration = times[-1] - times[0]
    return {
        "count": len(times),
        "medianIntervalUs": int(median(intervals)),
        "meanHz": round((len(times) - 1) / (duration / 1e6), 4) if duration else None,
        "longestGapSeconds": max(intervals) / 1e6,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("xbin", type=Path, help="the .xbin recording (read only)")
    parser.add_argument("--out", type=Path, help="output folder (default: <xbin folder>/reconstruction/xgrids/metadata)")
    parser.add_argument("--poses", type=Path, help="poses.csv for coverage (default: <xbin folder>/project_data/poses.csv if present)")
    parser.add_argument("--chunk-mib", type=float, default=16, help="read size in MiB (default 16)")
    parser.add_argument("--max-bytes", type=int, help="only index SPS signatures before this byte offset (validation runs)")
    parser.add_argument("--quiet", action="store_true", help="no progress lines")
    args = parser.parse_args()

    if not args.xbin.is_file():
        raise SystemExit(f"error: {args.xbin} is not a file")
    chunk_bytes = int(args.chunk_mib * 1024 * 1024)
    if chunk_bytes < 64:
        raise SystemExit("error: --chunk-mib is too small")
    out = args.out or args.xbin.parent / "reconstruction" / "xgrids" / "metadata"
    poses_path = args.poses or args.xbin.parent / "project_data" / "poses.csv"
    if args.poses and not poses_path.is_file():
        raise SystemExit(f"error: poses file {poses_path} not found")
    out.mkdir(parents=True, exist_ok=True)

    before = args.xbin.stat()
    print(f"Indexing {args.xbin} ({before.st_size:,} bytes) in {args.chunk_mib:g} MiB chunks", file=sys.stderr)
    result = scan(args.xbin, chunk_bytes, args.max_bytes, args.quiet)
    after = args.xbin.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        print("warning: the recording changed while it was being read", file=sys.stderr)

    frames: list[Frame] = sorted(result["frames"], key=lambda f: f.sps_offset)
    stream_outcomes = assign_streams(frames, result["batches"])
    pairing = pair_frames(frames)

    statuses = Counter(f.pair_status for f in frames)
    streams = Counter(f.stream or "unknown" for f in frames)
    times = [f.timestamp_us for f in frames]
    # One capture event = one pair (its earlier frame), or one frame that isn't part of a pair.
    pair_members: dict[int, list[Frame]] = defaultdict(list)
    for f in frames:
        if f.pair_id is not None:
            pair_members[f.pair_id].append(f)
    events = sorted(
        [f.timestamp_us for f in frames if f.pair_id is None]
        + [min(m.timestamp_us for m in members) for members in pair_members.values()]
    )
    pair_dts = [abs(members[0].pair_dt_us) for members in pair_members.values()]

    coverage = None
    if poses_path.is_file():
        try:
            coverage = pose_coverage(frames, read_pose_times(poses_path)) if frames else None
        except (OSError, ValueError) as error:
            print(f"warning: pose coverage skipped: {error}", file=sys.stderr)
    else:
        print(f"note: no poses file at {poses_path}; coverage skipped", file=sys.stderr)

    camera_batches = [b for b in result["batches"] if b.frames]
    summary = {
        "source": {
            "path": str(args.xbin.resolve()),
            "bytes": before.st_size,
            "modifiedNs": before.st_mtime_ns,
            "unchangedDuringScan": (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns),
        },
        "scan": {
            "scannedBytes": result["scanned_bytes"],
            "complete": result["scanned_bytes"] == result["file_size"],
            "chunkBytes": chunk_bytes,
            "seconds": round(result["seconds"], 1),
            "spsSignature": SPS_SIGNATURE.hex(" "),
        },
        "spsMatches": result["sps_matches"],
        "decodedFrames": len(frames),
        "rejectedCandidates": result["sps_matches"] - len(frames),
        "rejectionReasons": dict(result["rejection_reasons"]),
        "rejectedExamples": result["rejected"][:20],
        "cameraStreams": dict(streams),
        "streamAssignment": dict(stream_outcomes),
        "xbagBatches": {
            "recognised": len(result["batches"]),
            "byChannel": {str(k): v for k, v in sorted(result["batch_channels"].items())},
            "withCameraFrames": len(camera_batches),
            "cameraMessagesDeclared": sum(b.count for b in camera_batches),
        },
        "uniqueSequences": pairing["unique_sequences"],
        "sequencesSeenMoreThanTwice": pairing["sequences_seen_more_than_twice"],
        "uniqueTimestamps": len(set(times)),
        "captureEvents": len(events),
        "synchronizedPairs": pairing["pairs"],
        "pairStatus": dict(statuses),
        "unpairedFrames": statuses.get("unpaired", 0),
        "pairTimeDifferenceUs": {"min": min(pair_dts), "median": int(median(pair_dts)), "max": max(pair_dts)} if pair_dts else None,
        "firstTimestampUs": min(times) if times else None,
        "lastTimestampUs": max(times) if times else None,
        "firstTimestampUtc": utc(min(times)) if times else None,
        "lastTimestampUtc": utc(max(times)) if times else None,
        "durationSeconds": (max(times) - min(times)) / 1e6 if times else None,
        "captureEventRate": rate_summary(events),
        "perStreamRate": {name: rate_summary([f.timestamp_us for f in frames if (f.stream or "unknown") == name]) for name in streams},
        "poseCoverage": coverage,
        "notes": [
            "Discovery heuristic: frames are found by one SPS signature; images starting differently are not indexed.",
            "h264_bytes is the declared length of protobuf field 5, not the distance to the next SPS.",
            "camera_stream is the XBAG batch channel id, set only when the batch header matches its frames exactly; which physical camera it is has not been established.",
            "Batch header and field meanings are provisional (reverse-engineered from this recording).",
        ],
    }

    write_csv(out / "frames.csv", frames)
    with open(out / "index-summary.json", "w", encoding="utf-8") as stream:
        json.dump(summary, stream, indent=2)
        stream.write("\n")

    print_report(summary, out)


def print_report(s: dict, out: Path) -> None:
    lines = [
        "",
        f"SPS signature matches     {s['spsMatches']:,}",
        f"Decoded metadata records  {s['decodedFrames']:,}  (rejected {s['rejectedCandidates']:,}: {s['rejectionReasons'] or 'none'})",
        f"Camera streams            {s['cameraStreams']}",
        f"Unique sequences          {s['uniqueSequences']:,}   unique timestamps {s['uniqueTimestamps']:,}   capture events {s['captureEvents']:,}",
        f"Synchronized pairs        {s['synchronizedPairs']:,}   (Δt µs {s['pairTimeDifferenceUs']})",
        f"Pair status               {s['pairStatus']}",
        f"First / last timestamp    {s['firstTimestampUtc']}  →  {s['lastTimestampUtc']}  ({s['durationSeconds']} s)",
        f"Capture events            {s['captureEventRate']}",
    ]
    c = s["poseCoverage"]
    if c:
        lines.append(
            f"Poses ({c['poseCount']:,})            {c['firstPoseUtc']}  →  {c['lastPoseUtc']}; frames before/inside/after: "
            f"{c['framesBeforeFirstPose']:,} / {c['framesInsidePoseRange']:,} / {c['framesAfterLastPose']:,}; "
            f"overlap {c['overlapSeconds']:.1f} s; nearest pose gap µs {c['nearestPoseGapUs']}"
        )
    lines.append(f"Wrote {out / 'frames.csv'} and {out / 'index-summary.json'}")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
