# LAB EXP-03B — Floor plan upload, alignment and checkpoint mapping

**Status (2026-10-18):** Working prototype on `/labs/spatial-experiences`. Plain Three.js + XGRIDS LCC SDK unchanged. No cloud.

## Answer: loading house

No external 3D asset is required. `HousePointsLoader` builds a **procedural point-house** (walls + pitched roof + door) and pulses it with a small WebGL vertex shader. Progress reveals denser structure.

## Coordinate system (LCC tour)

| Item | Value |
|------|--------|
| Viewer frame | Three.js **Y-up** after SDK `modelMatrix` |
| Floor plane | Horizontal **X–Z** (eye height on Y) |
| Map UV | Normalized **0–1**, origin **top-left** of the image |
| Units | Metres (SDK / reconstruction) |
| Alignment | Extra mapping layer only — does **not** mutate LCC tiles |

## Why Entrance looked like Room 3 (fixed)

Before alignment finished, the UI was painting the floor-plan **image** but placing markers with the old AABB/`mapUv` sketch. Those two coordinate systems do not match — so Entrance could sit near Room 3 on the art. Markers and the “you” chevron now stay **off** the plan image until **Calculate alignment** succeeds.

## How to align — step by step

**Click the plan only here:** the **large image inside Dev → Floor plans**.  
**Do not** place anchors on the small top-right Floor map.

### A. Prepare checkpoints

1. Open **Dev** (`</>` next to the gear).
2. You should already have **Entrance**. For Kitchen: walk there → **Capture pose** → name `Kitchen` → **Save**.
3. In Dev, checkpoint tiles show **✎** (edit) and **×** (delete).

### B. Pair 3D ↔ plan (need ≥3)

1. Dev → scroll to **Floor plans — align**.
2. If you had a bad earlier attempt: **Reset pairs**.
3. Tap **① Entrance** (view flies there; status = “3D ready”).
4. On the **large Dev plan**, click the drawn **Entrance** (bottom center of the art). Blue pin = pair 1.
5. Tap **① Kitchen** (or Living) → click that room on the **same large Dev image**.
6. Tap **Far corner** (or another distant spot) → click it on the plan.
7. Press **Calculate alignment**. Hint should say Good / Usable RMS.
8. Expand top-right **Floor map** — Entrance icon should sit at the bottom Entrance; walk and watch the blue chevron.

### C. Fix mistakes

- Wrong blue pin → click the pin to remove → re-do that pair.
- Large RMS → anchors in wrong rooms; reset and spread Entrance / Kitchen / far side again.

## Visitor map

- Default floor plan image when set.
- Checkpoints projected via transform (or AABB fallback if unaligned).
- Live **you** marker + heading; **Off map** when outside UV.
- Click checkpoint → existing smooth/fade fly-to (validated 3D pose).

## Storage

| Data | Where |
|------|--------|
| Plan metadata, anchors, transform, rooms | `localStorage` `spatial-lab.experiences.floor-plans.v1` |
| Uploaded image blobs | IndexedDB `spatial-lab-experiences-floorplans` |
| Bundled sample | `public/labs/experiences/floor-plans/scandinavian-apartment-sample.jpg` |

## Room regions

Dev **Draw room polygon**: click ≥3 corners on the plan preview → Finish room. Links the currently selected checkpoint as default fly-to. Visitor map click uses that viewpoint (collision-safe saved pose).

## Test checklist (Room + your plan)

1. Upload / seed plan appears in floating map when expanded.
2. After ≥3 anchors + similarity, Entrance / Living / Far markers sit on sensible plan spots.
3. Walk → you marker moves; look → heading rotates.
4. Click checkpoint → returns to saved 3D pose.
5. Reload page → alignment persists.
6. Replace plan → re-align; Export JSON downloads.

## Limitations / next

- Similarity assumes the plan is a scaled/rotated top-down of the same floor; furniture art may not match the scan.
- Collision wall guides remain a fallback when no plan image is active.
- Full interactive room-polygon editor and multi-floor height bands need a follow-up lab.
- No paid hosting; keep sample rights in mind before public deploy.

## Files

| Path | Role |
|------|------|
| `components/labs/experiences/HousePointsLoader.tsx` | Shader point-house load |
| `components/labs/experiences/FloorPlanAlignEditor.tsx` | Upload + anchors + fit |
| `lib/labs/experiences/floorPlanAlign.ts` | Similarity / affine |
| `lib/labs/experiences/floorPlanStorage.ts` | IDB + localStorage |
| `lib/labs/experiences/floorPlanTypes.ts` | Schema / export |
