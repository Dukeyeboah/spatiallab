# Lab 14E.5 — Reviewed correspondences & constrained fisheye `k1` (local)

**Status (2026-10-17):** Local only. **No GPU / no RunPod / Stage B `x_c69aede71834` not replaced.**

| Artefact | Path |
|----------|------|
| Reviewed input (Phase 1) | `…/training/lab14e5-fisheye-k1/correspondences-builtin-basel-house-2026-10-17-reviewed-14e5.json` |
| Results JSON | `…/training/lab14e5-fisheye-k1/lab14e5-results.json` |
| Script | `scripts/xgrids/lab14e5_fisheye_k1.py` |

---

## Phase 1 — Review vs fit eligibility

| Id | Seq / cam | Decision |
|----|-----------|----------|
| `c_5566b397d0fe` (#40) | 2959 ch14 | **Verified** edge feature; **Restored** (`excludedFromFit` cleared). Still classified outside-usable under Stage B. **Never used in k1 training.** |
| `c_933babbf4afa` (#41) | 2959 ch18 | Same as #40. |
| `c_52e5d51a7442` (#24) | 2661 ch18 | **Approximate**, remains **excluded**. |
| `c_b50667f52448` | 3037 ch18 | **Needs correction** — not trusted for fitting. |
| Shelf / board | 1633 / 3187 | **Approximate** (kept). |
| Roof apex | 2317 ch14 | **Verified** (kept). |

Original pixels and LiDAR unchanged. UI: Reject → Verified/Approximate/Needs correction now **clears** a Reject exclusion so status and fit eligibility stay aligned (`CalibrationReviewQueue`, `CorrespondenceReview`).

---

## Distortion model (Model B)

Equidistant base with one radial term (pose, f, cx, cy **frozen** from Stage B):

\[
\rho = f\,(\theta + k_1\theta^3)
\]

| Symbol | Meaning |
|--------|---------|
| \(\theta\) | Angle from optical axis (radians) |
| \(f\) | Stage B focal (px/rad), frozen |
| \(k_1\) | Dimensionless; fit bounds **±0.15** |
| \(\rho\) | Distance from \((c_x,c_y)\) in pixels |

**Usable region:** still \(\rho \le 1400\) px. The usable circle was **not** expanded to admit edge probes. Negative \(k_1\) can pull some large-\(\theta\) rays *inside* that circle without changing the limit.

---

## Phase 3 — Validation summary

### Eligibility

| Set | n |
|-----|---|
| Total correspondences | 43 |
| Explicitly excluded (`#24`) | 1 |
| Needs-fix (glass) | 1 |
| Edge probes never in train (#40, #41) | 2 |
| **Eligible + Stage B-projectable (fit / LOO)** | **39** |
| Held-out events (leave-one-event) | **17** |

### Model A — frozen Stage B (`k1 = 0`)

| Slice | Median px | P90 | RMS |
|-------|-----------|-----|-----|
| Train / LOO overall* | **20.1** | 41.4 | 29.6 |
| ch14 | 21.1 | 41.2 | 29.8 |
| ch18 | 20.1 | 41.4 | 29.4 |
| Centre | 14.3 | 17.3 | 13.8 |
| Middle | 19.8 | 29.5 | 21.3 |
| Outer | **38.8** | 69.3 | 43.8 |
| corr(radius, error) | **0.65** | | |

\*With frozen parameters, train-on-all and leave-one-event medians match.

### Model B — Stage B + `k1` only

Global fit: **ch14 \(k_1 \approx -0.029\)**, **ch18 \(k_1 \approx -0.020\)**.

| Slice | Median px | P90 | RMS |
|-------|-----------|-----|-----|
| Train overall | **16.3** | 32.9 | 20.4 |
| LOO held-out | **16.4** | 33.9 | 20.9 |
| LOO ch14 | 17.7 | 33.5 | 21.1 |
| LOO ch18 | 14.9 | 28.6 | 20.8 |
| Centre | 14.0 | 17.0 | 13.8 |
| Middle | 17.5 | 28.4 | 19.4 |
| Outer | **22.7** | 40.3 | 25.3 |
| corr(radius, error) | **0.34** | | |

Event-grouped LOO: **B better on 12 / 17** events, tie 2, worse 3.

### `k1` stability (17 folds)

| Camera | Median \(k_1\) | Range across folds | Hit ±0.15 bound? |
|--------|---------------|--------------------|------------------|
| ch14 | −0.029 | −0.031 … −0.026 | **No** |
| ch18 | −0.020 | −0.020 … −0.017 | **No** |

Small, same-sign, fold-stable → **physically plausible** as a mild radial correction on this equidistant base; not a bound-hitting artefact.

### Edge probes #40 / #41 (never in training)

| Point | Model A | Model B (global \(k_1\)) |
|-------|---------|-------------------------|
| #40 2959 ch14 | no projection (θ≈88°) | projects · **~69 px** error |
| #41 2959 ch18 | no projection (θ≈84°) | projects · **~55 px** error |

So \(k_1\) can move these rays inside the *existing* usable circle, but residuals stay large. They are **not** evidence that Model B is good at the extreme edge, and they were not used to fit \(k_1\).

---

## Phase 4 — Recommendation

1. **Is lens distortion helping?** Yes, modestly and consistently: held-out median **20 → 16 px**, outer **39 → 23 px**, radial correlation **0.65 → 0.34**, improvement on most events, stable \(k_1\).
2. **Enough for another GPU Gaussian train?** **No.** Still well above the provisional **8–10 px** goal; edge probes remain ~55–70 px when they project at all.
3. **What next?** Keep Stage B frozen. Optionally continue correspondence cleanup (glass pane; optional re-check of large-residual outer approximates). Manufacturer intrinsics / a fuller distortion model remain open. **Do not** replace `x_c69aede71834` or start training from this lab alone.

**Stop here** pending your review.

### Post-report user export (21:19 UTC)

You later **rejected** #40 and #41 again (`correspondences-…-after-reject-40-41.json`). That does not change the 14E.5 LOO numbers (those two were never in the 39-point fit set). For future work, treat them as rejected unless restored once more.
