# Lab 14E.1 — Lever-arm and principal-point probe (local)

**Status (2026-10-16):** Local only. **No GPU.** RunPod Lab 14B/14D pods terminated after backup verification (see rebuild guide 14E.1 / cleanup).

| Artefact | Path (outside Git) |
| --- | --- |
| Hand-only metrics (authoritative) | `…/training/lab14e1-lever-principal/lab14e1-hand-only-results.json` |
| Auto proposals for UI review | `…/training/lab14e1-lever-principal/correspondences-with-auto-proposals.json` |
| Combined dump | `…/training/lab14e1-lever-principal/lab14e1-results.json` (includes circular autos — do not use for scores) |

---

## Setup

- Baseline: Stage B `x_c69aede71834` (rotation + f; cx,cy fixed; lever 0).
- Hand set: reviewed correspondences **minus** outlier `c_ca516a0a5228` (**18** points).
- **Trial A:** per-camera lever arm only (±15 cm body-frame bounds); Stage B R+f fixed; leave-one-event-out.
- **Trial B:** per-camera `cx,cy` only (±80 px); lever 0; Stage B R+f fixed; leave-one-event-out.
- **14 auto proposals** on courtyard sequences (ray ∩ plane + strong image gradient) saved for **human review** — **excluded from scores** (circular: built from the same projection model).

Existing architectural hand picks in the **5–12.5 m** band: **8** (windows, roof, pillar, boards). Autos aim to add more after visual confirmation in `/camera-calibration`.

---

## Results (hand-picked only)

| Condition | Held-out median | p90 | Notes |
| --- | ---: | ---: | --- |
| Stage B LOO (baseline) | **16.0 px** | 27.1 | ch14 18.1 / ch18 15.1 |
| Trial A (lever only) LOO | **14.4 px** | 21.9 | slight help; not &lt; 8 |
| Trial B (principal only) LOO | **15.5 px** | 23.1 | Δcx,cy ≲ 2 px; negligible |

### By distance (Stage B LOO)

| Band | n | median |
| --- | ---: | ---: |
| &lt; 5 m | 8 | 13.9 px |
| **5–12 m** | 7 | **18.6 px** |
| &gt; 12 m | 3 | 16.9 px |

Architectural 5–12.5 m Stage B LOO: median **18.4 px** → Trial A **15.0 px** → Trial B **17.8 px**.

### Lever arms (full-data Trial A fit)

| Camera | Body XYZ (cm) | ‖L‖ |
| --- | --- | ---: |
| ch14 | +0.7, +0.7, −0.2 | **1.0 cm** |
| ch18 | −0.7, −1.7, +0.2 | **1.8 cm** |

Physically small, opposite-ish in Y (plausible for left/right modules), but **far too small** to explain ~15–18 px residuals at courtyard depth (that would need ~10+ cm or other free parameters).

### Principal point (Trial B full fit)

| Camera | Δcx, Δcy (px) |
| --- | --- |
| ch14 | −0.5, −0.7 |
| ch18 | −1.1, −1.8 |

Essentially still at the image centre — **not** the missing degree of freedom for this set.

---

## Interpretation

1. **Target &lt; 8 px held-out was not reached** — and was not forced with wild parameters (levers stayed &lt; 2 cm; cx,cy almost unchanged).
2. **Lever-only and principal-only each fail** as sole fixes on the current hand set. Combined with Lab 14E (far residuals &gt; 5 cm geometric budget), the remaining error likely needs **more / better courtyard correspondences** and then either **joint** lever+rotation refinement, a **lens residual** term, or **pose/time** structure — still one new factor at a time after expanding picks.

**Next:** Lab **14E.2** correspondence review — [lab14e2-correspondence-review.md](lab14e2-correspondence-review.md). Import package ready; **no fitting** until you approve additional matches.
3. Auto proposals are useful **candidates** only after UI review (reject foliage, verify LiDAR hit on rigid structure).

---

## Recommended next step

1. In `/camera-calibration`, review the **14 auto proposals** + add hand picks to reach **≥10 solid new** courtyard architectural matches (5–12 m, both cameras, spread regions).
2. Re-run Stage B (or Stage B + lever jointly with strong priors) on the expanded set with leave-one-event-out.
3. Only if held-out median approaches **&lt; 8–10 px**, rebuild the Lab 14D package and request smoke 300 — **no quality / no GPU until then**.

---

## Stop line

No GPU, no dataset rebuild, no changes to Lab 14B/14D training outputs.
