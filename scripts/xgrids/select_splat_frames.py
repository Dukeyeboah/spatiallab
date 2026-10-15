#!/usr/bin/env python3
"""
Lab 14A: choose the capture events for a Gaussian splatting dataset (no decoding).

    backend/.venv/bin/python scripts/xgrids/select_splat_frames.py --from-min 7.5 --to-min 18 \
        --interval 5 --anchors CORRESPONDENCES.json --out SELECTION.json

Selection, inside the time window [from, to] (minutes after the first pose):
1. Eligible events: complete ch14 + ch18 pairs inside the pose range whose
   bracketing pose samples are ≤ 200 ms apart (the same rule as extract_frames.py).
2. Slots: one per `--interval` seconds. In each slot the event within
   ±`--search` s of the slot time with the LOWEST scanner turn rate is taken
   (less motion blur, less sensitivity to an unknown camera time offset).
3. Anchors: events used by the correspondence export are always kept, so the
   dataset can be checked against hand-picked image ↔ LiDAR matches.
4. Near-duplicates: a slot event is dropped when, since the last kept event,
   the scanner moved < `--min-move` m AND turned < `--min-turn` degrees.
The comparison table prints the same statistics for other intervals.
The output JSON lists the sequences in the form extract_frames.py --sequences takes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_frames as ef  # noqa: E402
from index_xbin import utc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
TURN_RATE_HALF_WINDOW_US = 100_000


def quaternion_angle_deg(q0, q1) -> float:
    dot = abs(sum(a * b for a, b in zip(q0, q1)))
    return math.degrees(2 * math.acos(min(1.0, dot)))


def turn_rate_deg_s(poses: ef.Poses, t: int) -> float:
    a = ef.interpolate_pose(poses, max(poses.times_us[0], t - TURN_RATE_HALF_WINDOW_US))
    b = ef.interpolate_pose(poses, min(poses.times_us[-1], t + TURN_RATE_HALF_WINDOW_US))
    return quaternion_angle_deg(a.quaternion, b.quaternion) / (2 * TURN_RATE_HALF_WINDOW_US / 1e6)


def eligible_events(events: list[ef.Event], poses: ef.Poses, max_gap_us: int = 200_000) -> list[ef.Event]:
    out = []
    for event in events:
        ps = [ef.interpolate_pose(poses, f.timestamp_us) for f in event.frames.values()]
        if all(p is not None and p.after_us - p.before_us <= max_gap_us for p in ps):
            out.append(event)
    return out


def select(events: list[ef.Event], poses: ef.Poses, start_us: int, end_us: int, interval_s: float, search_s: float,
           min_move_m: float, min_turn_deg: float, anchors: set[int]) -> tuple[list[dict], list[dict]]:
    """Kept events (dicts, in time order) and dropped near-duplicates."""
    window = [e for e in events if start_us <= e.time_us <= end_us]
    times = np.array([e.time_us for e in window])
    rates = {e.pair_id: turn_rate_deg_s(poses, e.time_us) for e in window}
    picks: dict[int, str] = {k: "anchor" for k, e in enumerate(window) if e.sequence in anchors}
    anchor_times = times[sorted(picks)] if picks else np.array([], dtype=times.dtype)
    slot = start_us
    while slot <= end_us:
        near = np.nonzero(np.abs(times - slot) <= search_s * 1e6)[0]
        # An anchor inside the slot's search window takes the slot's place.
        if len(near) and not (np.abs(anchor_times - slot) <= search_s * 1e6).any():
            best = min(near, key=lambda k: (rates[window[k].pair_id], abs(times[k] - slot)))
            picks.setdefault(int(best), "slot")
        slot += int(round(interval_s * 1e6))

    kept, dropped, last = [], [], None
    for k in sorted(picks):
        e = window[k]
        pose = ef.interpolate_pose(poses, e.time_us)
        row = {"sequence": e.sequence, "pairId": e.pair_id, "timeUs": e.time_us, "utc": utc(e.time_us),
               "frames": {ch: f.timestamp_us for ch, f in sorted(e.frames.items())},
               "pairDtUs": abs(e.frames["ch14"].timestamp_us - e.frames["ch18"].timestamp_us),
               "position": [round(c, 4) for c in pose.position], "turnRateDegS": round(rates[e.pair_id], 2),
               "reason": picks[k]}
        if last is not None:
            row["stepM"] = round(math.dist(pose.position, last[0]), 3)
            row["stepDeg"] = round(quaternion_angle_deg(pose.quaternion, last[1]), 2)
            if picks[k] == "slot" and row["stepM"] < min_move_m and row["stepDeg"] < min_turn_deg:
                dropped.append({**row, "dropped": f"moved {row['stepM']} m, turned {row['stepDeg']}° since the last kept event"})
                continue
        kept.append(row)
        last = (pose.position, pose.quaternion)
    return kept, dropped


def stats(kept: list[dict]) -> dict:
    steps = np.array([r["stepM"] for r in kept if "stepM" in r])
    turns = np.array([r["stepDeg"] for r in kept if "stepDeg" in r])
    if not len(steps):
        return {"events": len(kept), "images": 2 * len(kept)}
    return {"events": len(kept), "images": 2 * len(kept),
            "stepMedianM": round(float(np.median(steps)), 2), "stepP90M": round(float(np.percentile(steps, 90)), 2),
            "stepsOver2m": int((steps > 2).sum()), "turnMedianDeg": round(float(np.median(turns)), 1),
            "pathM": round(float(steps.sum()), 1),
            "turnRateMedianDegS": round(float(np.median([r["turnRateDegS"] for r in kept])), 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    rec = Path.home() / "Downloads/BM_Heritage_Basel_House_2026-07-15-101012"
    parser.add_argument("--frames", type=Path, default=rec / "reconstruction/xgrids/metadata/frames.csv")
    parser.add_argument("--poses", type=Path, default=rec / "project_data/poses.csv")
    parser.add_argument("--from-min", type=float, required=True, help="window start, minutes after the first pose")
    parser.add_argument("--to-min", type=float, required=True, help="window end, minutes after the first pose")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds per slot (default 5)")
    parser.add_argument("--search", type=float, default=1.0, help="± seconds around each slot to look for the steadiest event")
    parser.add_argument("--min-move", type=float, default=0.3, help="metres; with --min-turn defines a near-duplicate")
    parser.add_argument("--min-turn", type=float, default=10.0, help="degrees")
    parser.add_argument("--anchors", type=Path, help="correspondence export whose events are always kept")
    parser.add_argument("--compare", default="2,3,5,10", help="intervals (s) to compare")
    parser.add_argument("--out", type=Path, help="selection JSON (outside the repository; never overwritten)")
    args = parser.parse_args()
    if args.out:
        out = args.out.resolve()
        if out.is_relative_to(REPO_ROOT):
            parser.error("--out must be outside the repository")
        if out.exists():
            parser.error(f"{out} exists; selections are never overwritten")

    events, _ = ef.read_index(args.frames)
    poses = ef.read_poses(args.poses)
    events = eligible_events(events, poses)
    start_us = poses.times_us[0] + int(args.from_min * 60e6)
    end_us = poses.times_us[0] + int(args.to_min * 60e6)
    anchors = set()
    if args.anchors:
        anchors = {r["sequence"] for r in json.loads(args.anchors.read_text())["correspondences"]}
        anchors = {s for s in anchors if any(e.sequence == s and start_us <= e.time_us <= end_us for e in events)}

    print(f"Window {args.from_min:g}–{args.to_min:g} min ({utc(start_us)} → {utc(end_us)}); "
          f"{sum(start_us <= e.time_us <= end_us for e in events)} eligible events; anchors {sorted(anchors)}")
    comparison = {}
    print(f"{'interval':>8} {'events':>6} {'images':>6} {'step med':>8} {'step p90':>8} {'>2 m':>5} {'turn med':>8} {'dropped':>7}")
    for value in sorted({float(x) for x in args.compare.split(",")} | {args.interval}):
        kept, dropped = select(events, poses, start_us, end_us, value, min(args.search, value / 2), args.min_move, args.min_turn, set())
        s = stats(kept) | {"droppedNearDuplicates": len(dropped)}
        comparison[f"{value:g}s"] = s
        print(f"{value:>7g}s {s['events']:>6} {s['images']:>6} {s.get('stepMedianM', 0):>7}m {s.get('stepP90M', 0):>7}m "
              f"{s.get('stepsOver2m', 0):>5} {s.get('turnMedianDeg', 0):>7}° {len(dropped):>7}")

    kept, dropped = select(events, poses, start_us, end_us, args.interval, args.search, args.min_move, args.min_turn, anchors)
    summary = stats(kept)
    print(f"Selected: {summary['events']} events ({summary['images']} images), {sum(r['reason'] == 'anchor' for r in kept)} anchors, "
          f"{len(dropped)} near-duplicates dropped; path {summary.get('pathM')} m")
    if args.out:
        result = {
            "schema": "spatial-lab/xgrids-splat-selection", "version": 1,
            "source": {"frames": str(args.frames), "framesSha256": hashlib.sha256(args.frames.read_bytes()).hexdigest(),
                       "poses": str(args.poses), "posesSha256": hashlib.sha256(args.poses.read_bytes()).hexdigest(),
                       "anchors": str(args.anchors) if args.anchors else None},
            "parameters": {"fromMin": args.from_min, "toMin": args.to_min, "intervalS": args.interval, "searchS": args.search,
                           "minMoveM": args.min_move, "minTurnDeg": args.min_turn, "maxPoseGapMs": 200,
                           "turnRateWindowMs": 2 * TURN_RATE_HALF_WINDOW_US / 1000},
            "window": {"startUs": start_us, "endUs": end_us, "startUtc": utc(start_us), "endUtc": utc(end_us)},
            "summary": summary, "comparison": comparison,
            "events": kept, "droppedNearDuplicates": dropped,
            "sequences": ",".join(str(r["sequence"]) for r in kept),
        }
        with open(args.out, "x") as f:
            json.dump(result, f, indent=2)
            f.write("\n")
        print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
