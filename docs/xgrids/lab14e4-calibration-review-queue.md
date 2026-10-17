# Lab 14E.4 — Calibration Review Queue (local)

**Status (2026-10-17):** UI only. **No fitting, no GPU, no Stage B replace.**

**Review export loaded:** `…/training/lab14e4-review-queue/correspondences-builtin-basel-house-2026-10-17-reviewed-14e4.json` (from Downloads `… (1).json`, 20:11 UTC). Summary: `lab14e4-review-summary.json` in the same folder.

**14E.4 export (historical):** `…/lab14e4-review-queue/correspondences-…-reviewed-14e4.json` (21:00Z).

**14E.5 resolved input:** `…/lab14e5-fisheye-k1/correspondences-…-reviewed-14e5.json` — #40/#41 **Restored** (verified, not excluded); #24 still excluded; glass still needs-fix. See [lab14e5-fisheye-k1.md](lab14e5-fisheye-k1.md).

| Flagged id | 14E.5 mark | Fit flag |
|------------|------------|----------|
| `c_74df63628df5` (1633 ch14 shelf) | approximate | not excluded |
| `c_c61d3721d061` (3187 ch14 board) | approximate | not excluded |
| `c_b50667f52448` (3037 ch18 pane) | needs-fix | not used as trusted |
| `c_1e7ff984220a` (2317 ch14 roof apex) | verified | not excluded |
| `c_52e5d51a7442` (#24, 2661 ch18) | approximate | **excluded** |
| `c_5566b397d0fe` (#40, 2959 ch14) | verified (edge) | restored; outside-usable probe (not forced into fits) |
| `c_933babbf4afa` (#41, 2959 ch18) | verified (edge) | restored; outside-usable probe |

UI (14E.5): Reject → Verified/Approximate/Needs correction now clears the Reject exclusion automatically.

After Lab 14E.3 flagged 4 questionable + 3 outside-usable projections on the expanded 43-match set, `/camera-calibration` → **Image ↔ LiDAR correspondences** shows a **Calibration Review Queue** above the coverage panel.

## What to do

1. Import `correspondences-builtin-basel-house-2026-10-17.json` if not already loaded (does not overwrite other ids).
2. Use the built-in Basel House dataset so residuals use Stage B **`x_c69aede71834`** (not the file’s old f=750 diagnostic).
3. Work **section 1 (flagged)** first via **Jump to viewer**.
4. Mark **Verified / Approximate / Needs correction / Reject** — originals are not rewritten; Reject excludes from fits.
5. Optionally section 2 (best approximate courtyard). **Do not** re-pick the leave-alone list.
6. Stop. Do not open Optimization / Stage B until the flagged list is done.

## Flagged checklist (inspect first)

| # | Id | Seq | Cam | Why |
|---|-----|-----|-----|-----|
| 1 | `c_74df63628df5` | 1633 | ch14 | Lab 13V shelf / close |
| 2 | `c_c61d3721d061` | 3187 | ch14 | Lab 13V white board / close |
| 3 | `c_b50667f52448` | 3037 | ch18 | glass pane |
| 4 | `c_1e7ff984220a` | 2317 | ch14 | Lab 13V vehicle id → confirm roof apex |
| 5 | `c_52e5d51a7442` | 2661 | ch18 | Stage B cannot project into usable circle |
| 6 | `c_5566b397d0fe` | 2959 | ch14 | Stage B cannot project into usable circle |
| 7 | `c_933babbf4afa` | 2959 | ch18 | Stage B cannot project into usable circle |

Overlap between questionable and outside-usable: **none**.

## Leave alone

- 12 Lab 14E.3 reliable ids (see `LEAVE_ALONE_RELIABLE_IDS` in `lib/calibrationReviewQueue.ts`)
- Other matches on indoor sequences **1633, 1663, 3187** that are **not** in the flagged seven

## Viewer legend

- **○** cyan circle = manually selected image point  
- **×** = LiDAR projected with Stage B `x_c69aede71834`  
- Dashed line = residual  

Code: `lib/calibrationReviewQueue.ts`, `components/calibration/CalibrationReviewQueue.tsx`.
