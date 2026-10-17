#!/usr/bin/env python3
"""
Lab 14E.5 — frozen Stage B vs Stage B + constrained k1 (local only).

Model A: Stage B x_c69aede71834, k1 = 0 (frozen pose + intrinsics).
Model B: same frozen Stage B, fit only k1 per camera (yaw/pitch/roll/f/cx/cy fixed).

Distortion (equidistant base):
  θ = angle from optical axis (rad)
  ρ = f · (θ + k1 · θ³)     # pixels from principal point
  k1 dimensionless; |k1| ≤ 0.15 in the fit
  usable: ρ ≤ validRadiusPx (1400); region NOT expanded for edge probes

Eligible for fitting / LOO pixel errors: not excludedFromFit, not rejected/held-out,
not needs-fix, and Stage B (k1=0) projects inside the usable circle.
#40/#41 (verified outside-usable): never in training; reported as edge probes only.
#24 remains excluded.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
import camera_calibration as cc  # noqa: E402

# Reuse projection helpers from 14E.3
sys.path.insert(0, str(REPO / "scripts" / "xgrids"))
from lab14e3_calibration_validation import (  # noqa: E402
    STAGE_B,
    CX,
    CY,
    predict,
    region,
    stats,
    distance_m,
    dist_bin,
)

EDGE_PROBE_IDS = {"c_5566b397d0fe", "c_933babbf4afa"}  # #40, #41
GLASS_NEEDS_FIX = {"c_b50667f52448"}
K1_BOUND = 0.15
GOAL_PX = 10.0

INPUT = Path(
    "/Users/duke/Downloads/BM_Heritage_Basel_House_2026-07-15-101012/reconstruction/training/"
    "lab14e5-fisheye-k1/correspondences-builtin-basel-house-2026-10-17-reviewed-14e5.json"
)
OUT_DIR = INPUT.parent


def is_fit_pool(r: dict) -> bool:
    if r.get("excludedFromFit"):
        return False
    st = r.get("reviewStatus") or "unreviewed"
    if st in ("rejected", "held-out", "needs-fix"):
        return False
    if r["id"] in EDGE_PROBE_IDS:
        return False  # never train on verified edge probes
    if r["id"] in GLASS_NEEDS_FIX:
        return False
    return True


def projectable(r: dict, k1: float = 0.0) -> bool:
    p = predict(r, STAGE_B[r["channel"]], k1=k1)
    return bool(p.get("valid") and p.get("errorPx") is not None)


def fit_k1_only(records: list[dict], channel: str) -> float | None:
    """Freeze Stage B camera; fit only k1."""
    mine = [r for r in records if r["channel"] == channel]
    if len(mine) < 4:
        return None
    cam = STAGE_B[channel]

    def fun(x):
        k1 = float(x[0])
        out = []
        for r in mine:
            p = predict(r, cam, k1=k1)
            if not p.get("valid"):
                out += [80.0, 80.0]
            else:
                out += [p["u"] - r["pixel"]["u"], p["v"] - r["pixel"]["v"]]
        return np.asarray(out, float)

    result = least_squares(fun, [0.0], bounds=([-K1_BOUND], [K1_BOUND]), method="trf", loss="soft_l1", f_scale=10, max_nfev=2000)
    return float(result.x[0])


def residuals(records, k1_by_ch: dict[str, float]):
    rows = []
    for r in records:
        ch = r["channel"]
        k1 = k1_by_ch.get(ch, 0.0)
        p = predict(r, STAGE_B[ch], k1=k1)
        d = distance_m(r)
        rad = math.hypot(r["pixel"]["u"] - CX, r["pixel"]["v"] - CY)
        rows.append({
            "id": r["id"],
            "sequence": r["sequence"],
            "channel": ch,
            "feature": r["feature"],
            "reviewStatus": r.get("reviewStatus") or "unreviewed",
            "excludedFromFit": bool(r.get("excludedFromFit")),
            "distanceM": d,
            "distanceBin": dist_bin(d),
            "radiusPx": rad,
            "region": region(r["pixel"]["u"], r["pixel"]["v"], STAGE_B[ch]["model"]),
            "thetaDeg": p.get("thetaDeg"),
            "errorPx": p.get("errorPx") if p.get("valid") else None,
            "valid": bool(p.get("valid")),
            "reason": p.get("reason"),
            "du": p.get("du"),
            "dv": p.get("dv"),
            "projected": {"u": p.get("u"), "v": p.get("v")} if p.get("valid") else None,
        })
    return rows


def group_stats(rows, key_fn):
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        if row["errorPx"] is None:
            continue
        buckets[key_fn(row)].append(row["errorPx"])
    return {k: stats(v) for k, v in sorted(buckets.items())}


def loo_frozen_vs_k1(eligible: list[dict]):
    """Leave-one-event-out. Model A: k1=0. Model B: refit k1 on train only (pose frozen)."""
    events = sorted({r["sequence"] for r in eligible})
    held_a, held_b = [], []
    folds = []
    k1_folds = {"ch14": [], "ch18": []}
    for seq in events:
        train = [r for r in eligible if r["sequence"] != seq]
        test = [r for r in eligible if r["sequence"] == seq]
        k1s = {"ch14": 0.0, "ch18": 0.0}
        for ch in ("ch14", "ch18"):
            k = fit_k1_only(train, ch)
            if k is not None:
                k1s[ch] = k
                k1_folds[ch].append(k)
        fold = {"sequence": seq, "nTrain": len(train), "nTest": len(test), "k1": dict(k1s), "A": [], "B": []}
        for r in test:
            pa = predict(r, STAGE_B[r["channel"]], k1=0.0)
            pb = predict(r, STAGE_B[r["channel"]], k1=k1s[r["channel"]])
            if pa.get("valid") and pa.get("errorPx") is not None:
                held_a.append(pa["errorPx"])
                fold["A"].append({"id": r["id"], "channel": r["channel"], "errorPx": pa["errorPx"]})
            if pb.get("valid") and pb.get("errorPx") is not None:
                held_b.append(pb["errorPx"])
                fold["B"].append({"id": r["id"], "channel": r["channel"], "errorPx": pb["errorPx"]})
        fold["medianA"] = stats([e["errorPx"] for e in fold["A"]])["median"]
        fold["medianB"] = stats([e["errorPx"] for e in fold["B"]])["median"]
        folds.append(fold)

    def by_ch(held_list_of_folds, key):
        return {
            ch: stats([e["errorPx"] for f in folds for e in f[key] if e["channel"] == ch])
            for ch in ("ch14", "ch18")
        }

    return {
        "events": events,
        "heldOutA": stats(held_a),
        "heldOutB": stats(held_b),
        "byChannelA": by_ch(folds, "A"),
        "byChannelB": by_ch(folds, "B"),
        "k1FoldValues": k1_folds,
        "k1FoldSummary": {ch: stats(vs) for ch, vs in k1_folds.items()},
        "folds": folds,
    }


def radial_corr(rows):
    pts = [(row["radiusPx"], row["errorPx"]) for row in rows if row["errorPx"] is not None]
    if len(pts) < 8:
        return None
    r = np.asarray([p[0] for p in pts], float)
    e = np.asarray([p[1] for p in pts], float)
    if np.std(r) < 1 or np.std(e) < 1:
        return {"n": len(pts), "corr": None}
    return {"n": len(pts), "corr": float(np.corrcoef(r, e)[0, 1])}


def main():
    data = json.load(open(INPUT))
    records = data["correspondences"]
    assert len(records) == 43

    excluded = [r for r in records if r.get("excludedFromFit")]
    needs_fix = [r for r in records if (r.get("reviewStatus") or "") == "needs-fix"]
    pool = [r for r in records if is_fit_pool(r)]
    eligible = [r for r in pool if projectable(r, 0.0)]
    unprojectable_pool = [r for r in pool if not projectable(r, 0.0)]

    # Global k1 on all eligible (training snapshot)
    k1_global = {}
    for ch in ("ch14", "ch18"):
        k = fit_k1_only(eligible, ch)
        k1_global[ch] = 0.0 if k is None else k

    rows_a = residuals(eligible, {"ch14": 0.0, "ch18": 0.0})
    rows_b = residuals(eligible, k1_global)
    loo = loo_frozen_vs_k1(eligible)

    # Edge probes under A and B (never trained on)
    edge_report = []
    for rid in sorted(EDGE_PROBE_IDS):
        r = next(x for x in records if x["id"] == rid)
        for label, k1s in (("A_frozen", {"ch14": 0.0, "ch18": 0.0}), ("B_k1_global", k1_global)):
            p = predict(r, STAGE_B[r["channel"]], k1=k1s[r["channel"]])
            edge_report.append({
                "id": rid,
                "sequence": r["sequence"],
                "channel": r["channel"],
                "model": label,
                "k1": k1s[r["channel"]],
                "valid": bool(p.get("valid")),
                "errorPx": p.get("errorPx"),
                "thetaDeg": p.get("thetaDeg"),
                "reason": p.get("reason"),
                "projected": {"u": p.get("u"), "v": p.get("v")} if p.get("valid") else None,
            })

    # Improvement across events: count folds where B median < A median
    fold_wins = sum(1 for f in loo["folds"] if f["medianA"] is not None and f["medianB"] is not None and f["medianB"] < f["medianA"] - 0.5)
    fold_ties = sum(1 for f in loo["folds"] if f["medianA"] is not None and f["medianB"] is not None and abs(f["medianB"] - f["medianA"]) <= 0.5)
    fold_losses = sum(1 for f in loo["folds"] if f["medianA"] is not None and f["medianB"] is not None and f["medianB"] > f["medianA"] + 0.5)

    result = {
        "lab": "14E.5",
        "input": str(INPUT),
        "baseline": "x_c69aede71834",
        "distortionEquation": {
            "form": "rho = f * (theta + k1 * theta^3)",
            "theta": "radians from optical axis",
            "rho": "pixels from (cx, cy)",
            "k1": "dimensionless; fit bounds ±0.15",
            "usableRadiusPx": 1400,
            "note": "Usable radius NOT expanded for edge probes. Pose/f/cx/cy frozen from Stage B.",
        },
        "inventory": {
            "total": len(records),
            "excludedFromFit": [{"id": r["id"], "sequence": r["sequence"], "channel": r["channel"], "reviewStatus": r.get("reviewStatus"), "reason": (r.get("excludedFromFit") or {}).get("reason")} for r in excluded],
            "needsFix": [{"id": r["id"], "sequence": r["sequence"], "channel": r["channel"]} for r in needs_fix],
            "edgeProbesNeverInTrain": sorted(EDGE_PROBE_IDS),
            "fitPool": len(pool),
            "eligibleProjectable": len(eligible),
            "unprojectableInPool": [{"id": r["id"], "sequence": r["sequence"], "channel": r["channel"]} for r in unprojectable_pool],
            "heldOutEvents": loo["events"],
            "nHeldOutEvents": len(loo["events"]),
        },
        "modelA_frozen": {
            "trainOnEligible": {
                "overall": stats([row["errorPx"] for row in rows_a]),
                "byChannel": group_stats(rows_a, lambda row: row["channel"]),
                "byRegion": group_stats(rows_a, lambda row: row["region"]),
                "radialCorr": radial_corr(rows_a),
            },
            "loo": {"heldOut": loo["heldOutA"], "byChannel": loo["byChannelA"]},
        },
        "modelB_k1_only": {
            "k1Global": k1_global,
            "trainOnEligible": {
                "overall": stats([row["errorPx"] for row in rows_b]),
                "byChannel": group_stats(rows_b, lambda row: row["channel"]),
                "byRegion": group_stats(rows_b, lambda row: row["region"]),
                "radialCorr": radial_corr(rows_b),
            },
            "loo": {
                "heldOut": loo["heldOutB"],
                "byChannel": loo["byChannelB"],
                "k1FoldSummary": loo["k1FoldSummary"],
                "k1FoldValues": loo["k1FoldValues"],
            },
            "eventWins": {"better": fold_wins, "tie": fold_ties, "worse": fold_losses, "nEvents": len(loo["folds"])},
        },
        "edgeProbes_40_41": edge_report,
        "goalPx": GOAL_PX,
        "folds": loo["folds"],
    }

    out = OUT_DIR / "lab14e5-results.json"
    json.dump(result, open(out, "w"), indent=2)
    print(json.dumps({
        "wrote": str(out),
        "eligible": len(eligible),
        "excluded": len(excluded),
        "k1": k1_global,
        "looA": loo["heldOutA"],
        "looB": loo["heldOutB"],
        "radialA": radial_corr(rows_a),
        "radialB": radial_corr(rows_b),
        "eventWins": result["modelB_k1_only"]["eventWins"],
        "edge": edge_report,
    }, indent=2))


if __name__ == "__main__":
    main()
