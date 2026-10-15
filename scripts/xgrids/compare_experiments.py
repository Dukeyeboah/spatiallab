#!/usr/bin/env python3
"""
Lab 13W: compare calibration experiments (spatial-lab/xgrids-calibration-experiment v1).
The first file is the baseline. Standard library only.

    python3 scripts/xgrids/compare_experiments.py BASELINE.json OTHER.json ... [--out report.json]

Per camera and stage it prints the parameters (± 1σ), training and held-out
errors, the range of each parameter over the leave-one-event-out folds, the
identifiability status, the photo-vs-LiDAR image check when present, and the
change from the baseline in units of the baseline's 1σ. Held-out errors are
also compared on the records the two experiments share, because medians over
different point sets are not comparable. --out (outside the repository,
never overwritten) writes the same as JSON.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PARAMS = ("yawDeg", "pitchDeg", "rollDeg", "focalPx")


def load(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "spatial-lab/xgrids-calibration-experiment" or data.get("version") != 1:
        raise SystemExit(f"{path}: not a calibration experiment v1 file")
    return data


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def stage_summary(camera: dict, stage: str) -> dict | None:
    result = camera["stages"].get(stage)
    if not result or not result.get("ok"):
        return {"ok": False, "reason": (result or {}).get("reason", "not run")}
    parameters = {**result["orientation"], "focalPx": result["model"]["focalPx"]}
    return {
        "ok": True,
        "parameters": parameters,
        "std": result["std"],
        "training": result["training"]["stats"],
        "heldOut": result["validation"]["heldOutStats"],
        "heldOutPerRecord": {i: p["errorPx"] for i, p in result["validation"]["heldOut"].items() if p["valid"]},
        "folds": {"ok": result["validation"]["foldsOk"], "skipped": result["validation"]["foldsSkipped"]},
        "foldRange": {k: v["range"] for k, v in result["validation"]["parameterSpread"].items()},
        "identifiability": {k: v["status"] for k, v in result["identifiability"].items()},
        "outliers": result["training"]["outliers"],
    }


def compare(experiments: list[tuple[str, dict]]) -> dict:
    base_name, base = experiments[0]
    report = {"baseline": base_name, "experiments": []}
    for name, x in experiments:
        entry = {"file": name, "experimentId": x["experimentId"], "sourceSha256": x["source"]["sha256"],
                 "excluded": [e["id"] for e in x["source"]["excluded"]], "cameras": {}}
        image = x.get("independentChecks", {}).get("imageAgreement", {}).get("summary", {})
        for channel, camera in x["cameras"].items():
            cam = {"records": len(camera["records"]), "events": len(camera["events"]),
                   "provisional": camera["provisional"]["stats"], "recommended": camera["comparison"]["recommended"],
                   "stages": {s: stage_summary(camera, s) for s in ("A", "B")}, "imageCheck": image.get(channel)}
            base_camera = base["cameras"].get(channel)
            if base_camera:
                for s, summary in cam["stages"].items():
                    reference = stage_summary(base_camera, s)
                    if not (summary and summary["ok"] and reference and reference["ok"]):
                        continue
                    summary["changeVsBaseline"] = {
                        k: {"delta": summary["parameters"][k] - reference["parameters"][k],
                            "inBaselineSigma": (summary["parameters"][k] - reference["parameters"][k]) / reference["std"][k]
                            if reference["std"].get(k) else None}
                        for k in reference["parameters"] if k in reference["std"]
                    }
                    common = sorted(set(summary["heldOutPerRecord"]) & set(reference["heldOutPerRecord"]))
                    summary["heldOutOnCommonRecords"] = {
                        "records": len(common),
                        "median": median(summary["heldOutPerRecord"][i] for i in common),
                        "baselineMedian": median(reference["heldOutPerRecord"][i] for i in common),
                    }
            entry["cameras"][channel] = cam
        report["experiments"].append(entry)
    return report


def fmt(v, digits=1):
    return "—" if v is None else f"{v:.{digits}f}"


def print_report(report: dict) -> None:
    for entry in report["experiments"]:
        print(f"\n== {entry['file']} ({entry['experimentId']}); excluded: {', '.join(entry['excluded']) or 'none'}")
        for channel, cam in entry["cameras"].items():
            p = cam["provisional"]
            print(f"  {channel}: {cam['records']} points in {cam['events']} events · provisional median {fmt(p['median'])} px · "
                  f"recommended {cam['recommended']}")
            for stage, s in cam["stages"].items():
                if not s["ok"]:
                    print(f"    Stage {stage}: not run ({s['reason']})")
                    continue
                params = ", ".join(f"{k[:-3] if k.endswith('Deg') else 'f'} {fmt(v, 2)}±{fmt(s['std'].get(k), 2)}"
                                   for k, v in s["parameters"].items() if k in s["std"])
                print(f"    Stage {stage}: {params}")
                print(f"      training median/RMS {fmt(s['training']['median'])}/{fmt(s['training']['rms'])} · held-out "
                      f"{fmt(s['heldOut']['median'])}/{fmt(s['heldOut']['rms'])} ({s['folds']['ok']} folds, {s['folds']['skipped']} skipped)")
                print(f"      fold ranges: " + ", ".join(f"{k} {fmt(v, 2)}" for k, v in s["foldRange"].items()))
                print(f"      status: " + ", ".join(f"{k} {v}" for k, v in s["identifiability"].items()))
                if s.get("changeVsBaseline"):
                    print("      vs baseline: " + ", ".join(
                        f"{k} {fmt(c['delta'], 2)} ({fmt(c['inBaselineSigma'], 1)}σ)" for k, c in s["changeVsBaseline"].items()))
                    c = s["heldOutOnCommonRecords"]
                    print(f"      held-out median on {c['records']} shared points: {fmt(c['median'])} px (baseline {fmt(c['baselineMedian'])})")
            if cam["imageCheck"]:
                means = ", ".join(f"{n} {fmt(v, 3)}" for n, v in cam["imageCheck"]["meanNcc"].items())
                print(f"    image check ({cam['imageCheck']['images']} photos): mean NCC {means}; best {cam['imageCheck']['bestCount']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("experiments", nargs="+", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    out = args.out.resolve() if args.out else None
    if out and out.is_relative_to(REPO_ROOT):
        parser.error("--out must be outside the repository")
    if out and out.exists():
        parser.error(f"{out} exists; previous reports are never overwritten")
    report = compare([(p.name, load(p)) for p in args.experiments])
    print_report(report)
    if out:
        with open(out, "x", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2)
            stream.write("\n")
        print(f"\nReport → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
