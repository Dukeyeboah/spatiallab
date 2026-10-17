#!/usr/bin/env python3
"""
Lab 14E.3 — expanded Basel House correspondence validation (local only).

Reprojects the 2026-10-17 export with Stage B x_c69aede71834, audits quality,
leave-one-event-out validation, and compares candidate camera models.
Writes outside the repo; never overwrites calibration experiments.
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
import camera_calibration as cc  # noqa: E402

STAGE_B = {
    "ch14": {
        "orientation": {"yawDeg": -88.953323, "pitchDeg": 2.885573, "rollDeg": 0.368913},
        "model": {**cc.PROVISIONAL_MODEL, "focalPx": 961.439824, "status": "experimental-estimate"},
    },
    "ch18": {
        "orientation": {"yawDeg": 89.4391, "pitchDeg": 4.334841, "rollDeg": 0.77412},
        "model": {**cc.PROVISIONAL_MODEL, "focalPx": 961.532298, "status": "experimental-estimate"},
    },
}

LAB13V_FLAGS = {
    "c_74df63628df5": "Lab 13V #1 shelf — historically large residual / ambiguous pick",
    "c_c61d3721d061": "Lab 13V #5 white board — very close (<1 m)",
    "c_1e7ff984220a": "Lab 13V #16 vehicle rear — may have moved",
}

MOVABLE = cc.MOVABLE_PATTERN
CX, CY, R_OK = 1999.5, 1449.5, 1400.0


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p / 100
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return xs[int(k)]
    return xs[f] * (c - k) + xs[c] * (k - f)


def stats(xs):
    xs = [float(x) for x in xs if x is not None and math.isfinite(x)]
    if not xs:
        return {"count": 0, "median": None, "p90": None, "rms": None, "mean": None, "max": None}
    a = np.asarray(xs)
    return {
        "count": len(xs),
        "median": float(np.median(a)),
        "p90": float(pct(xs, 90)),
        "rms": float(np.sqrt(np.mean(a ** 2))),
        "mean": float(np.mean(a)),
        "max": float(np.max(a)),
    }


def region(u, v, model):
    r = math.hypot(u - model["cx"], v - model["cy"])
    lim = model["validRadiusPx"]
    if r < lim / 3:
        return "centre"
    if r < 2 * lim / 3:
        return "middle"
    if r <= lim:
        return "outer"
    return "outside"


def dist_bin(d):
    if d < 3:
        return "<3m"
    if d < 6:
        return "3–6m"
    if d <= 15:
        return "6–15m"
    return ">15m"


def distance_m(r):
    p = np.asarray(r["scannerPose"]["position"], float)
    q = np.asarray(r["lidar"]["las"], float)
    return float(np.linalg.norm(q - p))


def predict(r, cam, lever=(0.0, 0.0, 0.0), k1=0.0):
    """Equidistant ± optional k1 θ³ radial term: r = f·(θ + k1·θ³)."""
    model = dict(cam["model"])
    if abs(k1) < 1e-15:
        p = cc.predict_record(r, cam["orientation"], model, lever)
        if p.get("valid") and p.get("u") is not None:
            p = dict(p)
            p["du"] = p["u"] - r["pixel"]["u"]
            p["dv"] = p["v"] - r["pixel"]["v"]
        return p
    pose = r["scannerPose"]
    v_cam = cc.to_camera(r["lidar"]["las"], pose["position"], pose["quaternion"], cam["orientation"], lever)
    x, y, z = float(v_cam[0, 0]), float(v_cam[0, 1]), float(v_cam[0, 2])
    s = math.hypot(y, z)
    theta = math.atan2(s, x)
    rho = model["focalPx"] * (theta + k1 * theta ** 3)
    if s > 0:
        u = model["cx"] + rho * (-y / s)
        v = model["cy"] + rho * (-z / s)
    else:
        u, v = model["cx"], model["cy"]
    radius = math.hypot(u - model["cx"], v - model["cy"])
    if theta >= math.pi - 1e-9 or radius > model["validRadiusPx"]:
        return {"valid": False, "u": None, "v": None, "errorPx": None, "thetaDeg": math.degrees(theta),
                "reason": "outside usable radius"}
    du, dv = u - r["pixel"]["u"], v - r["pixel"]["v"]
    err = math.hypot(du, dv)
    return {"valid": True, "u": u, "v": v, "errorPx": err, "thetaDeg": math.degrees(theta), "reason": None,
            "du": du, "dv": dv}


def residuals_pack(records, cameras, lever_by_ch=None, k1_by_ch=None):
    rows = []
    for r in records:
        ch = r["channel"]
        lever = (lever_by_ch or {}).get(ch, (0.0, 0.0, 0.0))
        k1 = (k1_by_ch or {}).get(ch, 0.0)
        p = predict(r, cameras[ch], lever, k1)
        d = distance_m(r)
        rad = math.hypot(r["pixel"]["u"] - CX, r["pixel"]["v"] - CY)
        rows.append({
            "id": r["id"],
            "sequence": r["sequence"],
            "channel": ch,
            "feature": r["feature"],
            "quality": r["quality"],
            "pixel": r["pixel"],
            "lidar": r["lidar"]["las"],
            "distanceM": d,
            "distanceBin": dist_bin(d),
            "radiusPx": rad,
            "region": region(r["pixel"]["u"], r["pixel"]["v"], cameras[ch]["model"]),
            "prediction": p,
            "errorPx": p.get("errorPx"),
            "du": p.get("du"),
            "dv": p.get("dv"),
        })
    return rows


def quality_audit(records, residual_rows):
    by_id = {row["id"]: row for row in residual_rows}
    classifications = []
    # Near-duplicate LAS or pixel pairs
    for i, a in enumerate(records):
        for b in records[i + 1 :]:
            las = math.dist(a["lidar"]["las"], b["lidar"]["las"])
            same_img = a["imageFile"] == b["imageFile"]
            pix = math.hypot(a["pixel"]["u"] - b["pixel"]["u"], a["pixel"]["v"] - b["pixel"]["v"]) if same_img else 1e9
            if las < 0.05 or pix < 8:
                pass  # flagged per-record below

    for r in records:
        row = by_id[r["id"]]
        flags = []
        grade = "verified"
        if r["id"] in LAB13V_FLAGS:
            flags.append(LAB13V_FLAGS[r["id"]])
            grade = "questionable"
        m = MOVABLE.search(r["feature"] + " " + r.get("notes", ""))
        if m:
            flags.append(f"may-move keyword '{m.group(0)}'")
            grade = "questionable"
        if row["distanceM"] < 1.5:
            flags.append(f"very close ({row['distanceM']:.2f} m) — lever arm sensitive")
            if grade == "verified":
                grade = "approximate"
        elif row["distanceM"] < 3:
            flags.append(f"close-range ({row['distanceM']:.2f} m)")
            if grade == "verified":
                grade = "approximate"
        if row["region"] in ("outer", "outside"):
            flags.append(f"fisheye {row['region']} region (r={row['radiusPx']:.0f} px)")
            if grade == "verified":
                grade = "approximate"
        feat = r["feature"].lower()
        if any(k in feat for k in ("sill", "edge", "board", "image on", "mid top")):
            flags.append("edge/plane feature (not a sharp 3D corner) — LiDAR pick may slide")
            if grade == "verified":
                grade = "approximate"
        if "window" in feat and "pane" in feat:
            flags.append("glass/pane — depth ambiguity")
            grade = "questionable"
        err = row["errorPx"]
        if err is not None and err > 40:
            flags.append(f"large Stage B residual {err:.1f} px (kept for audit, not auto-dropped)")
            if grade == "verified":
                grade = "approximate"
        # duplicates
        for other in records:
            if other["id"] == r["id"]:
                continue
            if math.dist(r["lidar"]["las"], other["lidar"]["las"]) < 0.05:
                flags.append(f"near-duplicate LAS of {other['id'][:12]}…")
                if grade == "verified":
                    grade = "approximate"
            if r["imageFile"] == other["imageFile"]:
                if math.hypot(r["pixel"]["u"] - other["pixel"]["u"], r["pixel"]["v"] - other["pixel"]["v"]) < 8:
                    flags.append(f"near-duplicate pixel of {other['id'][:12]}…")
        classifications.append({
            "id": r["id"],
            "sequence": r["sequence"],
            "channel": r["channel"],
            "feature": r["feature"],
            "grade": grade,
            "flags": flags,
            "stageB_errorPx": err,
            "distanceM": row["distanceM"],
            "region": row["region"],
        })
    return classifications


def group_stats(rows, key_fn):
    buckets = defaultdict(list)
    for row in rows:
        if row["errorPx"] is None:
            continue
        buckets[key_fn(row)].append(row["errorPx"])
    return {k: stats(v) for k, v in sorted(buckets.items())}


def loo_events(records, cameras, lever_by_ch=None, k1_by_ch=None, refit="none"):
    """Leave-one-event-out. refit: none | B | B+lever | B+cxcy | B+k1."""
    events = sorted({r["sequence"] for r in records})
    held = []
    folds = []
    for seq in events:
        train = [r for r in records if r["sequence"] != seq]
        test = [r for r in records if r["sequence"] == seq]
        cams = {ch: {"orientation": dict(cameras[ch]["orientation"]), "model": dict(cameras[ch]["model"])} for ch in cameras}
        levers = dict(lever_by_ch or {ch: (0.0, 0.0, 0.0) for ch in cameras})
        k1s = dict(k1_by_ch or {ch: 0.0 for ch in cameras})
        if refit != "none":
            for ch in ("ch14", "ch18"):
                mine = [r for r in train if r["channel"] == ch]
                if len(mine) < 4:
                    continue
                fitted = fit_candidate(mine, cams[ch], mode=refit)
                if fitted:
                    cams[ch] = fitted["camera"]
                    if "lever" in fitted:
                        levers[ch] = fitted["lever"]
                    if "k1" in fitted:
                        k1s[ch] = fitted["k1"]
        fold_errs = []
        for r in test:
            p = predict(r, cams[r["channel"]], levers[r["channel"]], k1s[r["channel"]])
            if p.get("valid") and p.get("errorPx") is not None:
                held.append(p["errorPx"])
                fold_errs.append({"id": r["id"], "channel": r["channel"], "errorPx": p["errorPx"]})
        folds.append({"sequence": seq, "nTrain": len(train), "nTest": len(test), "errors": fold_errs,
                      "median": stats([e["errorPx"] for e in fold_errs])["median"]})
    return {"heldOut": stats(held), "folds": folds, "byChannel": {
        ch: stats([e["errorPx"] for f in folds for e in f["errors"] if e["channel"] == ch])
        for ch in ("ch14", "ch18")
    }}


def fit_candidate(records, camera0, mode="B"):
    """Fit one camera. mode: B | B+lever | B+cxcy | B+k1."""
    o0 = camera0["orientation"]
    m0 = camera0["model"]
    cfg = cc.SolverConfig()

    if mode == "B":
        res = cc.fit(records, "B", o0, m0, cfg)
        if not res.get("ok"):
            return None
        return {"camera": {"orientation": res["orientation"], "model": res["model"]}, "rms": res["rmsResidualPx"]}

    if mode == "B+lever":
        # x = yaw,pitch,roll,f, lx,ly,lz  with |l|<=0.15 m
        def fun(x):
            ori = {"yawDeg": float(x[0]), "pitchDeg": float(x[1]), "rollDeg": float(x[2])}
            model = dict(m0)
            model["focalPx"] = float(x[3])
            lever = (float(x[4]), float(x[5]), float(x[6]))
            return cc._residuals(records, ori, model, lever)
        x0 = [o0["yawDeg"], o0["pitchDeg"], o0["rollDeg"], m0["focalPx"], 0, 0, 0]
        lo = [o0["yawDeg"] - 5, o0["pitchDeg"] - 5, o0["rollDeg"] - 5, 700, -0.15, -0.15, -0.15]
        hi = [o0["yawDeg"] + 5, o0["pitchDeg"] + 5, o0["rollDeg"] + 5, 1200, 0.15, 0.15, 0.15]
        result = least_squares(fun, x0, bounds=(lo, hi), method="trf", loss="soft_l1", f_scale=10, max_nfev=3000)
        ori = {"yawDeg": float(result.x[0]), "pitchDeg": float(result.x[1]), "rollDeg": float(result.x[2])}
        model = dict(m0)
        model["focalPx"] = float(result.x[3])
        lever = (float(result.x[4]), float(result.x[5]), float(result.x[6]))
        resid = fun(result.x)
        return {
            "camera": {"orientation": ori, "model": model},
            "lever": lever,
            "rms": float(math.sqrt(resid @ resid / max(1, len(records)))),
        }

    if mode == "B+cxcy":
        def fun(x):
            ori = {"yawDeg": float(x[0]), "pitchDeg": float(x[1]), "rollDeg": float(x[2])}
            model = dict(m0)
            model["focalPx"] = float(x[3])
            model["cx"] = float(x[4])
            model["cy"] = float(x[5])
            return cc._residuals(records, ori, model)
        x0 = [o0["yawDeg"], o0["pitchDeg"], o0["rollDeg"], m0["focalPx"], m0["cx"], m0["cy"]]
        lo = [o0["yawDeg"] - 5, o0["pitchDeg"] - 5, o0["rollDeg"] - 5, 700, m0["cx"] - 40, m0["cy"] - 40]
        hi = [o0["yawDeg"] + 5, o0["pitchDeg"] + 5, o0["rollDeg"] + 5, 1200, m0["cx"] + 40, m0["cy"] + 40]
        result = least_squares(fun, x0, bounds=(lo, hi), method="trf", loss="soft_l1", f_scale=10, max_nfev=3000)
        ori = {"yawDeg": float(result.x[0]), "pitchDeg": float(result.x[1]), "rollDeg": float(result.x[2])}
        model = dict(m0)
        model["focalPx"] = float(result.x[3])
        model["cx"] = float(result.x[4])
        model["cy"] = float(result.x[5])
        resid = fun(result.x)
        return {
            "camera": {"orientation": ori, "model": model},
            "rms": float(math.sqrt(resid @ resid / max(1, len(records)))),
            "deltaCxCy": (model["cx"] - m0["cx"], model["cy"] - m0["cy"]),
        }

    if mode == "B+k1":
        def fun(x):
            ori = {"yawDeg": float(x[0]), "pitchDeg": float(x[1]), "rollDeg": float(x[2])}
            model = dict(m0)
            model["focalPx"] = float(x[3])
            k1 = float(x[4])
            out = []
            for r in records:
                p = predict(r, {"orientation": ori, "model": model}, k1=k1)
                if not p["valid"]:
                    out += [100.0, 100.0]
                else:
                    out += [p["u"] - r["pixel"]["u"], p["v"] - r["pixel"]["v"]]
            return np.asarray(out)
        x0 = [o0["yawDeg"], o0["pitchDeg"], o0["rollDeg"], m0["focalPx"], 0.0]
        lo = [o0["yawDeg"] - 5, o0["pitchDeg"] - 5, o0["rollDeg"] - 5, 700, -0.15]
        hi = [o0["yawDeg"] + 5, o0["pitchDeg"] + 5, o0["rollDeg"] + 5, 1200, 0.15]
        result = least_squares(fun, x0, bounds=(lo, hi), method="trf", loss="soft_l1", f_scale=10, max_nfev=3000)
        ori = {"yawDeg": float(result.x[0]), "pitchDeg": float(result.x[1]), "rollDeg": float(result.x[2])}
        model = dict(m0)
        model["focalPx"] = float(result.x[3])
        k1 = float(result.x[4])
        resid = fun(result.x)
        return {
            "camera": {"orientation": ori, "model": model},
            "k1": k1,
            "rms": float(math.sqrt(resid @ resid / max(1, len(records)))),
        }
    return None


def radial_pattern(rows):
    """Correlate residual magnitude with image radius — hint for distortion."""
    pts = [(row["radiusPx"], row["errorPx"], row["du"], row["dv"]) for row in rows if row["errorPx"] is not None]
    if len(pts) < 8:
        return None
    r = np.asarray([p[0] for p in pts])
    e = np.asarray([p[1] for p in pts])
    # Pearson r vs error
    if np.std(r) < 1 or np.std(e) < 1:
        return {"n": len(pts), "corr_radius_error": None}
    corr = float(np.corrcoef(r, e)[0, 1])
    # mean signed radial component of residual (projection toward image centre)
    radial_signed = []
    for rad, err, du, dv in pts:
        if rad < 1:
            continue
        # residual · radial unit (from centre to pixel ≈ outward)
        # We don't have pixel offset from centre in du,dv of residual; approximate with error vs radius bins
        radial_signed.append(err)
    outer = [p[1] for p in pts if p[0] >= 900]
    inner = [p[1] for p in pts if p[0] < 600]
    return {
        "n": len(pts),
        "corr_radius_error": corr,
        "median_inner_rlt600": stats(inner)["median"],
        "median_outer_rge900": stats(outer)["median"],
    }


def main():
    corr_path = Path(
        "/Users/duke/Downloads/BM_Heritage_Basel_House_2026-07-15-101012/reconstruction/xgrids/calibration/inputs/"
        "correspondences-builtin-basel-house-2026-10-17.json"
    )
    out = Path(
        "/Users/duke/Downloads/BM_Heritage_Basel_House_2026-07-15-101012/reconstruction/training/lab14e3-calibration-validation"
    )
    out.mkdir(parents=True, exist_ok=True)

    data = json.loads(corr_path.read_text())
    records = data["correspondences"]
    assert len(records) == 43

    # --- inventory ---
    inventory = {
        "source": str(corr_path),
        "n": len(records),
        "byChannel": dict(Counter(r["channel"] for r in records)),
        "byQuality": dict(Counter(r["quality"] for r in records)),
        "events": sorted({r["sequence"] for r in records}),
        "nEvents": len({r["sequence"] for r in records}),
        "imageSize": {"w": 4000, "h": 3000},
        "fileDiagnosticsModel": (data.get("projectionUsedForDiagnostics") or {}).get("model"),
        "fileDiagnosticsNote": "Do NOT use exported projectionUsedForDiagnostics errors — assumed f=750, yaw±90.",
        "baseline": "x_c69aede71834 Stage B",
    }

    # --- Stage B residuals on all 43 ---
    residual_rows = residuals_pack(records, STAGE_B)
    for row in residual_rows:
        p = row["prediction"]
        if p.get("valid") and "du" not in p:
            row["du"] = p["u"] - row["pixel"]["u"]
            row["dv"] = p["v"] - row["pixel"]["v"]

    stage_b_all = {
        "overall": stats([r["errorPx"] for r in residual_rows]),
        "byChannel": group_stats(residual_rows, lambda r: r["channel"]),
        "byDistance": group_stats(residual_rows, lambda r: r["distanceBin"]),
        "byRegion": group_stats(residual_rows, lambda r: r["region"]),
        "radialPattern": radial_pattern(residual_rows),
        "perRecord": residual_rows,
    }

    # --- quality audit ---
    audit = quality_audit(records, residual_rows)
    grade_counts = dict(Counter(a["grade"] for a in audit))
    reliable_ids = {a["id"] for a in audit if a["grade"] == "verified"}
    approx_ids = {a["id"] for a in audit if a["grade"] == "approximate"}
    question_ids = {a["id"] for a in audit if a["grade"] == "questionable"}

    # Suggested held-out events: later courtyard poses with good architecture
    suggested_held_out_events = [2718, 2959, 2827]

    # --- LOO on frozen Stage B ---
    loo_frozen = loo_events(records, STAGE_B, refit="none")

    # Also LOO on verified+approximate only (still not auto-dropping questionable from reporting)
    usable = [r for r in records if r["id"] not in question_ids]
    loo_usable_frozen = loo_events(usable, STAGE_B, refit="none")

    # --- Candidate models (refit with LOO) ---
    candidates = {}
    for name, mode in [
        ("frozen_stage_b", "none"),
        ("refit_stage_b", "B"),
        ("refit_b_plus_lever", "B+lever"),
        ("refit_b_plus_cxcy", "B+cxcy"),
        ("refit_b_plus_k1", "B+k1"),
    ]:
        # training RMS on full set (for reporting) + LOO held-out
        if mode == "none":
            cameras = STAGE_B
            levers, k1s = {}, {}
            train_rms = {ch: stats([r["errorPx"] for r in residual_rows if r["channel"] == ch]) for ch in ("ch14", "ch18")}
            fitted_params = {"note": "frozen x_c69aede71834"}
        else:
            cameras = {}
            levers, k1s = {}, {}
            fitted_params = {}
            train_rms = {}
            for ch in ("ch14", "ch18"):
                mine = [r for r in usable if r["channel"] == ch]
                fit = fit_candidate(mine, STAGE_B[ch], mode=mode)
                if not fit:
                    cameras[ch] = STAGE_B[ch]
                    train_rms[ch] = {"count": 0, "median": None}
                    continue
                cameras[ch] = fit["camera"]
                if "lever" in fit:
                    levers[ch] = fit["lever"]
                if "k1" in fit:
                    k1s[ch] = fit["k1"]
                fitted_params[ch] = {
                    "orientation": fit["camera"]["orientation"],
                    "focalPx": fit["camera"]["model"]["focalPx"],
                    "cx": fit["camera"]["model"].get("cx"),
                    "cy": fit["camera"]["model"].get("cy"),
                    "lever": fit.get("lever"),
                    "k1": fit.get("k1"),
                    "deltaCxCy": fit.get("deltaCxCy"),
                    "trainRmsPx": fit["rms"],
                }
                train_rows = residuals_pack(mine, {ch: cameras[ch]}, {ch: levers.get(ch, (0, 0, 0))}, {ch: k1s.get(ch, 0.0)})
                train_rms[ch] = stats([r["errorPx"] for r in train_rows])
        loo = loo_events(usable, cameras, levers or None, k1s or None, refit=mode if mode != "none" else "none")
        # For frozen, also report LOO on full 43
        if mode == "none":
            loo_full = loo_frozen
        else:
            loo_full = loo_events(records, cameras, levers or None, k1s or None, refit=mode)
        candidates[name] = {
            "mode": mode,
            "fitted": fitted_params,
            "trainOnUsable": train_rms,
            "looHeldOutUsable": loo["heldOut"],
            "looHeldOutUsableByChannel": loo["byChannel"],
            "looHeldOutAll43": loo_full["heldOut"],
            "looHeldOutAll43ByChannel": loo_full["byChannel"],
        }

    # Decision helpers
    goal = 10.0  # provisional px goal (8–10)
    best_name = min(
        candidates.keys(),
        key=lambda n: (candidates[n]["looHeldOutUsable"]["median"] is None, candidates[n]["looHeldOutUsable"]["median"] or 1e9),
    )

    report = {
        "lab": "14E.3",
        "inventory": inventory,
        "gradeCounts": grade_counts,
        "reliableIds": sorted(reliable_ids),
        "approximateIds": sorted(approx_ids),
        "questionableIds": sorted(question_ids),
        "suggestedHeldOutEvents": suggested_held_out_events,
        "stageB_frozen_all43": {
            "overall": stage_b_all["overall"],
            "byChannel": stage_b_all["byChannel"],
            "byDistance": stage_b_all["byDistance"],
            "byRegion": stage_b_all["byRegion"],
            "radialPattern": stage_b_all["radialPattern"],
        },
        "looFrozenAll43": loo_frozen["heldOut"],
        "looFrozenUsable": loo_usable_frozen["heldOut"],
        "candidates": candidates,
        "bestCandidateByUsableLOO": best_name,
        "goalPx": goal,
        "audit": audit,
        "residualArrows": [
            {
                "id": r["id"],
                "channel": r["channel"],
                "sequence": r["sequence"],
                "observed": r["pixel"],
                "projected": {"u": r["prediction"].get("u"), "v": r["prediction"].get("v")} if r["prediction"].get("valid") else None,
                "du": r.get("du"),
                "dv": r.get("dv"),
                "errorPx": r["errorPx"],
                "region": r["region"],
                "distanceM": r["distanceM"],
            }
            for r in residual_rows
        ],
    }

    (out / "lab14e3-results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "n": 43,
        "grades": grade_counts,
        "stageB_median": stage_b_all["overall"]["median"],
        "stageB_p90": stage_b_all["overall"]["p90"],
        "loo_frozen_usable_median": loo_usable_frozen["heldOut"]["median"],
        "candidates": {k: v["looHeldOutUsable"] for k, v in candidates.items()},
        "best": best_name,
        "out": str(out),
    }, indent=2))


if __name__ == "__main__":
    main()
