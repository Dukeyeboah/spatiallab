# Lab 14E.3 — Expanded correspondence audit & calibration candidates (local)

**Status (2026-10-17):** Local only. **No GPU / no RunPod / no training.** Stage B `x_c69aede71834` is **not** replaced.

| Artefact | Location |
|----------|----------|
| Input (preserved) | `…/xgrids/calibration/inputs/correspondences-builtin-basel-house-2026-10-17.json` (+ copy under `…/training/lab14e3-calibration-validation/`) |
| Machine-readable results | `…/training/lab14e3-calibration-validation/lab14e3-results.json` |
| Script | `scripts/xgrids/lab14e3_calibration_validation.py` |

Also completed in this lab cycle: **LCC viewer** at `/labs/lcc-web-sdk` is Plain Three.js only (R3F UI hidden; code kept).

---

## Part A — LCC viewer (architecture)

| Layer | Role |
|-------|------|
| Next.js / React | Pages, panels, sample picker, status |
| Plain Three.js + LCC SDK 0.6.3 | Rendering, orbit / first-person, picking, collision |
| R3F | Used elsewhere in Spatial Lab; LCC↔R3F bridge **parked** (`LccR3FHost.tsx`) |

Cleanup: single WebGL context per mount; `releaseLccSdk()` on unmount / sample change; one animation loop; interior start from capture-pose median.

---

## Step 1 — Preserve and inspect

- **43** correspondences, schema v1, `calibrationStatus: provisional`.
- Cameras: **ch14 = 21**, **ch18 = 22**. All quality tagged `good`. No `reviewStatus` / `scene` tags yet. None `excludedFromFit`.
- **21** capture events (sequences 1633…3187). Image size **4000×3000** throughout.
- File’s `projectionUsedForDiagnostics` uses **assumed** `f=750`, yaw ±90° — **ignored** for all scoring below.
- Previous inputs (`2026-10-15`, `2026-10-15-reviewed`, `lab14e2-…`) left untouched.

### Quality grades (heuristic audit — original picks kept)

| Grade | n | Meaning |
|-------|---|--------|
| verified | 12 | Clear architectural corner language, mid-range, not historically flagged |
| approximate | 27 | Close-range, outer fisheye, long edge/sill, or large residual — keep for review |
| questionable | 4 | Lab 13V history and/or glass/pane / may-move |

**Questionable ids:** `c_74df63628df5` (shelf), `c_c61d3721d061` (close board), `c_b50667f52448` (window pane), `c_1e7ff984220a` (Lab 13V vehicle id — feature text now says roof apex; treat as approximate pending human re-check).

**Invalid under Stage B usable radius (3):** outer-image roof corners `c_52e5d51a7442` (2661 ch18), `c_5566b397d0fe` / `c_933babbf4afa` (2959) — observation pixels beyond the 1400 px usable circle for the projected ray; flagged, not deleted.

Duplicates: no exact LAS/pixel clones; several roof corners are the same *physical* feature across events (intentional multi-view).

---

## Step 2 — Stage B baseline residuals (`x_c69aede71834`)

Projection: equidistant fisheye, `f≈961`, `(cx,cy)=(1999.5,1449.5)`, scanner centre (lever 0), original fisheye pixels.

**All valid projections (40/43):**

| Slice | Median px | P90 px | RMS |
|-------|-----------|--------|-----|
| Overall | **19.8** | **40.9** | 29.2 |
| ch14 | 21.1 | 41.2 | 29.8 |
| ch18 | 18.3 | 40.9 | 28.7 |
| Centre | **14.3** | 16.6 | 13.4 |
| Middle | 19.8 | 29.5 | 21.3 |
| Outer | **38.8** | 69.3 | 43.8 |
| &lt;3 m | 11.5 | 28.6 | 19.5 |
| 6–15 m | 16.5 | 43.1 | 25.2 |
| &gt;15 m | **26.8** | 63.8 | 37.5 |

- Radius–error correlation **+0.66** (inner r&lt;600 median ~12.8 px; outer r≥900 median ~38.8 px).
- Mean residual **(du, dv)** ≈ ch14 **(+4.9, −11.6)**, ch18 **(−6.7, −14.1)** — systematic **downward** bias in image space, larger at the periphery.
- Largest errors are **outer** roof/pipe corners at medium–far range (e.g. 2768 ch18 75.6 px, 2977 ch14 74.5 px).

**Leave-one-event-out with frozen Stage B (usable set, excluding 4 questionable):** held-out median **22.2 px**, P90 **42.7 px**.

---

## Step 3 — Correspondence-quality summary

Reliable core is **~12 verified** + many usable **approximate** architectural matches (windows, pillars, roof intersections). The expansion successfully spread courtyard events and both cameras, but:

1. Many picks sit on **long edges / roof lines** (LiDAR can slide along the edge).
2. **Outer fisheye** coverage increased — exactly where Stage B residual grows.
3. Far sparse roofs (&gt;15 m) remain hard.

Do **not** auto-delete large-error points; they are diagnostic of the lens/edge issue.

---

## Step 4 — Held-out validation (event-grouped)

All candidate LOO numbers below use the **usable** set (exclude 4 questionable) unless noted. Training RMS is on that camera’s usable points; held-out is leave-**one-event**-out.

---

## Step 5 — Candidate models (not saved as new baseline)

| Candidate | Held-out median (usable) | P90 | Notes |
|-----------|--------------------------|-----|--------|
| Frozen Stage B `x_c69aede71834` | 22.2 | 42.7 | Reference |
| Refit Stage B (yaw/pitch/roll/f) | 19.3 | 48.8 | f drops to ~932–934; mild improvement |
| Stage B + lever (±15 cm) | 19.1 | 43.4 | Levers small (~3–15 cm) but LOO **max 152 px** — unstable folds; ch18 hits bound |
| Stage B + cx,cy (±40 px) | 17.0 | 38.3 | **cx/cy hit bounds** and trade with pitch — **not trusted** |
| Stage B + k1 (r=f·(θ+k1θ³), \|k1\|≤0.15) | **13.9** | **32.7** | k1≈**−0.044** both cameras; best LOO, still **above** 8–10 px goal |

**Interpretation**

1. **Consistent error:** yes — growing with radius, downward residual bias.
2. **Edges worse:** strongly yes (outer median ~2.7× centre).
3. **Translation alone:** does not explain the radial pattern; lever fit is unstable under LOO.
4. **Principal point:** bound-hitting / degenerate with orientation — not supported as a free fix.
5. **Lens residual (minimal k1):** best matches the radial pattern and improves held-out median ~22→14 px, but does **not** reach the provisional **8–10 px** goal and is still experimental (one extra parameter per camera).

---

## Step 6 — Decision

1. **Reliable matches:** ~12 verified; ~27 approximate but useful; 4 questionable; 3 currently unprojectable at the fisheye limit.
2. **Consistent calibration errors:** yes — radial / outer-image growth + mild vertical bias.
3. **Edges:** yes, dominant.
4. **Cause:** orientation+f alone insufficient at the periphery; lever-only and cx,cy-only not justified; a **small radial term** is the only candidate that both fits the residual pattern and improves LOO without bound-hitting chaos.
5. **Best generalising candidate today:** Stage B + mild k1 (experimental) — still **~14 px** held-out median.
6. **8–10 px goal:** **not met**.
7. **New Gaussian training?** **No.** Evidence is not yet strong enough to replace `x_c69aede71834` or re-train 14B/14D. Next steps should stay local: (a) human verify outer roof picks / re-pick edge slides, (b) if still radial after cleanup, trial a **regularised** k1 (or equivalent) with the same held-out events, (c) only then consider one controlled training experiment.

**Do not** overwrite Stage B `x_c69aede71834`. **Do not** start RunPod.

---

## Suggested next decision (awaiting approval)

1. Import the 2026-10-17 JSON into `/camera-calibration` and mark verified / held-out / rejected in the UI (events **2718, 2959, 2827** suggested for hold-out).
2. Optionally re-pick the three unprojectable outer points slightly inward of the usable circle.
3. If approved later: one constrained “Stage B + k1” experiment written **beside** (not over) the baseline, with LOO on fixed events.
4. Gaussian retrain only after held-out median is clearly &lt;10 px on courtyard architecture.
