#!/usr/bin/env python3
"""
Lab 13V: audit Lab 13U image ↔ LiDAR correspondences and run an EXPERIMENTAL
camera calibration (rotation, then optionally one focal parameter) with
leave-one-event-out validation. Needs NumPy + SciPy (backend/.venv).

    backend/.venv/bin/python scripts/xgrids/calibrate_cameras.py CORRESPONDENCES.json --out DIR \\
        [--poses public/datasets/basel-house/poses.csv] [--runs-dir <recording>/reconstruction/xgrids/images] \\
        [--cloud-bin public/datasets/basel-house/basel-preview-5m.bin --cloud-metadata ...-5m-metadata.json] \\
        [--exclude ID ...] [--include ID ...] [--audit-only] [--image-check RUN]

Writes, never overwriting, into DIR (refused inside the repository):
    audit-<source sha8>.json              the correspondence audit (flags for review)
    experiment-<experiment id>.json       the experiment (schema spatial-lab/xgrids-calibration-experiment v1)
The input file is only read. The maths is backend/camera_calibration.py.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

import numpy as np  # noqa: E402

import camera_calibration as cc  # noqa: E402


def load_preview_cloud(bin_path: Path, metadata_path: Path) -> np.ndarray:
    """Interleaved preview format (float32 xyz + uint8 rgb, dataset coordinates) → LAS (float64)."""
    metadata = json.loads(metadata_path.read_text())
    raw = np.fromfile(bin_path, dtype=np.dtype([("p", "<f4", 3), ("rgb", "u1", 3)]))
    return raw["p"].astype(np.float64) + np.asarray(metadata["coordinateCenter"], dtype=np.float64)


def write_new(path: Path, value: dict) -> None:
    with open(path, "x", encoding="utf-8") as stream:  # "x": never overwrite
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("correspondences", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dataset-id", help="expected dataset id (default: the file's)")
    parser.add_argument("--poses", type=Path, help="the dataset's poses.csv; its SHA-256 must equal the file's posesSha256")
    parser.add_argument("--runs-dir", type=Path, help="extraction runs folder: records are checked against the run manifests")
    parser.add_argument("--cloud-bin", type=Path)
    parser.add_argument("--cloud-metadata", type=Path)
    parser.add_argument("--exclude", nargs="*", default=[], help="extra record ids to leave out of the fits")
    parser.add_argument("--include", nargs="*", default=[], help="record ids to fit despite an 'exclude' flag")
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--image-check", metavar="RUN",
                        help="also score every set by photo-vs-LiDAR correlation on this run's events not used for fitting "
                             "(needs --runs-dir and the cloud)")
    args = parser.parse_args()

    out = args.out.resolve()
    if out.is_relative_to(REPO_ROOT):
        parser.error("--out must be outside the repository (results are local data, not source)")
    out.mkdir(parents=True, exist_ok=True)

    text = args.correspondences.read_text(encoding="utf-8")
    poses_sha = hashlib.sha256(args.poses.read_bytes()).hexdigest() if args.poses else None
    try:
        loaded = cc.load_correspondences(text, args.dataset_id, poses_sha)
    except cc.CalibrationInputError as error:
        print(f"Refused: {error}", file=sys.stderr)
        return 2
    print(f"{args.correspondences.name}: sha256 {loaded['sourceSha256'][:16]}…, dataset {loaded['dataset']['id']}, "
          f"{len(loaded['records'])} records, {len(loaded['rejected'])} rejected" + (", pose-file hash verified" if poses_sha else ""))
    for item in loaded["rejected"]:
        print(f"  rejected #{item['index']} {item['id']}: {item['reason']}")
    unknown = sorted(set((args.exclude or []) + (args.include or [])) - {r["id"] for r in loaded["records"]})
    if unknown:
        parser.error(f"unknown record id(s) in --exclude/--include: {', '.join(unknown[:5])} (separate ids with spaces)")

    if args.runs_dir:
        os.environ["SPATIAL_LAB_XGRIDS_DIR"] = str(args.runs_dir)
        global xgrids_runs
        import xgrids_runs
        problems = cc.verify_against_runs(loaded["records"], xgrids_runs.read_run)
        print(f"Run manifests: {len(loaded['records']) - len(problems)} of {len(loaded['records'])} records match (pose hash, image, timestamp, pose)")
        for p in problems:
            print(f"  {p['id']}: {p['reason']}")
        if problems:
            print("Refused: records disagree with their extraction run.", file=sys.stderr)
            return 2

    cloud = load_preview_cloud(args.cloud_bin, args.cloud_metadata) if args.cloud_bin and args.cloud_metadata else None
    report = cc.audit(loaded["records"], cloud)
    report["source"] = {"file": args.correspondences.name, "sha256": loaded["sourceSha256"], "dataset": loaded["dataset"]}
    audit_path = out / f"audit-{loaded['sourceSha256'][:8]}.json"
    if not audit_path.exists():
        write_new(audit_path, cc._rounded(report))
    print(f"Audit → {audit_path}")
    for channel, info in report["channels"].items():
        print(f"  {channel}: {info['usable']}/{info['records']} usable, {info['events']} events, distance {info['distanceM']['min']:.1f}–{info['distanceM']['max']:.1f} m "
              f"(median {info['distanceM']['median']:.1f}), {info['closeRange']} closer than {cc.CLOSE_RANGE_M:g} m, rings {info['radialRings']}")
    for row in report["records"]:
        for flag in row["flags"]:
            print(f"  #{row['index']:<2} {row['sequence']} {row['channel']} [{flag['severity']}] {flag['code']}: {flag['reason']}")
    if args.audit_only:
        return 0

    experiment = cc.run_experiment(loaded, report, exclude_ids=args.exclude, include_ids=args.include, source_name=args.correspondences.name)
    if args.image_check:
        if not (args.runs_dir and cloud is not None):
            parser.error("--image-check needs --runs-dir, --cloud-bin and --cloud-metadata")
        from PIL import Image

        def photo_grey(filename: str, width: int, height: int) -> np.ndarray:
            with Image.open(xgrids_runs.image_path(args.image_check, filename)) as image:
                return np.asarray(image.convert("L").resize((width, height), Image.BILINEAR), dtype=np.float64)

        raw = np.fromfile(args.cloud_bin, dtype=np.dtype([("p", "<f4", 3), ("rgb", "u1", 3)]))
        print(f"Image check on run {args.image_check} (events used for fitting are skipped)…")
        experiment["independentChecks"] = {"imageAgreement": cc._rounded(cc.image_agreement(
            experiment["parameterSets"], xgrids_runs.read_run(args.image_check), photo_grey,
            cloud, raw["rgb"].astype(np.float64).mean(axis=1), skip_sequences=experiment["source"]["events"]))}
    path = out / f"experiment-{experiment['experimentId']}.json"
    if path.exists():
        print(f"Experiment {experiment['experimentId']} already exists (same inputs and settings): {path}")
    else:
        write_new(path, experiment)
        print(f"Experiment → {path}")
    def px(value) -> str:
        return "—" if value is None else f"{value:.1f}"

    for channel, camera in experiment["cameras"].items():
        print(f"\n{channel}: {len(camera['records'])} records in {len(camera['events'])} events")
        p = camera["provisional"]["stats"]
        print(f"  provisional            median {px(p['median'])}  mean {px(p['mean'])}  RMS {px(p['rms'])} px")
        for stage, result in camera["stages"].items():
            if not result.get("ok"):
                print(f"  Stage {stage}: not run ({result.get('reason')})")
                continue
            t, h = result["training"]["stats"], result["validation"]["heldOutStats"]
            o, m = result["orientation"], result["model"]
            print(f"  Stage {stage}: yaw {o['yawDeg']:.2f}° pitch {o['pitchDeg']:.2f}° roll {o['rollDeg']:.2f}° f {m['focalPx']:.1f}")
            print(f"    training median {px(t['median'])} RMS {px(t['rms'])} px · held-out median {px(h['median'])} RMS {px(h['rms'])} px "
                  f"({result['validation']['foldsOk']} folds, {result['validation']['foldsSkipped']} skipped)")
            for name, status in result["identifiability"].items():
                print(f"    {name}: {status['status']}" + (f" ({'; '.join(status['reasons'])})" if status["reasons"] else ""))
        print(f"  recommended: {camera['comparison']['recommended']}")
    for channel, info in experiment.get("independentChecks", {}).get("imageAgreement", {}).get("summary", {}).items():
        means = ", ".join(f"{n} {v:.3f}" for n, v in info["meanNcc"].items() if v is not None)
        print(f"Image check {channel} ({info['images']} photos not used for fitting): mean NCC {means}; best per photo {info['bestCount']}")
    for warning in experiment["warnings"]:
        print(f"Warning: {warning}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
