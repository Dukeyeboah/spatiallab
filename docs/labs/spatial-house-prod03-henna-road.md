# LAB PROD-03 — Community 6 Henna Road (outdoor LCC2)

**Status (2026-11-10):** Spatial Lab experiment only. **Do not publish to Spatial House / R2 until approved.**

**Open:** http://localhost:3000/labs/prod-03 · Author: `?author=1`

---

## 1. Archive inspection report

| Item | Value |
|------|--------|
| Source ZIP | `~/Downloads/Community 6 Henna Road_render2.zip` |
| Compressed size | **803 MB** |
| Extracted size | **848 MB** (on disk) |
| Files | **180** |
| ZIP test | `unzip -t` — **No errors** |
| Unsafe paths | None (no `..` / absolute entries) |
| Entry point | **`Community6HennaRoad.lcc2`** (529 KB) |
| Splats | **110** `.sog` under `data/3dgs/` |
| Collision mesh | **33** `.ply` + **33** `.btree` under `data/mesh/` |
| Meta | `info/poses.json`, `info/report.json`, `info/thumb.jpg` |
| Capture count | **One** reconstruction (single `.lcc2` + shared `data/`) |
| Device / notes | K1 scan; ~32.8M points in report; build ~7h31m |

Extracted (gitignored binaries) to:

`public/labs/properties/community-6-henna-road/v1-lcc2/`

Cover preview (tracked-friendly path): `…/previews/cover.jpg` from `info/thumb.jpg`.

---

## 2. Lab architecture

| Piece | Role |
|-------|------|
| `/labs/prod-03` | Dedicated outdoor lab |
| `Prod03Lab` | Visitor + Author shell |
| `Prod02aHost` | LCC2 load, Walk / Orbit / Smooth, **Orb V1.1**, soft **blockZones** |
| `APPROVED_ORB` | Orb Assistant V1.1 @ **1.5×** Free Follow only |
| Draft key | `spatial-lab.prod03.drafts.v1` (separate from Spintex) |

**Does not modify** PROD-01 property-experience or PROD-02B defaults beyond shared `Prod02aHost` additive `blockZones` (default empty / off).

---

## 3. Navigation modes

| UI | Host | Notes |
|----|------|-------|
| **Walk** | `current` | Classic first-person |
| **Orbit** | `orbit` | Environment look-around |
| **Avatar** | `smooth` + Orb V1.1 | Free Follow only — no Follow dropdown; not walker/R01 |

**Motion:** Walk / Avatar (Orb V1.1) / Orbit · Avatar adds Free Follow / Ecctrl. Click the ground to walk there (Point & Move). Mode switches ground-snap so Avatar does not spawn buried.

**Controls:** arrows/WASD move · **Shift + arrows** run · **Q/E** turn · drag look · phone **Pads** on left/right (apartment-style docks).

**Sprint lever:** 2.5×–5.5× (default **4.5×**).

**Locations:** Starting point + checkpoints as thumbnail cards (`previews/locations/*.jpg`).

**Visitor guide:** bottom instruction strip (above pads on phone).

---

## 4. Outdoor road blocks

Author Mode (`?author=1` or toggle **Author**):

1. Walk to a closed stretch / capture end.
2. **Add road block here** (oriented box; yaw from facing).
3. Select → resize Length / Height / Thickness; **Yaw** steps; **Block position** X/Y/Z sliders + ±0.25/1/5 m nudges / Face my view / Move to me; edit **Access message**; Enable/Disable; **Dup**.
4. **Author wireframes** only while Author + Dev. Visitor never sees wires.
5. **Visitor block look**: **Invisible** (default) or **Frosted glass** (nearby translucent panels that fade out by ~26 m).
6. Visitors who push into a block bounce back and see a centered toast with the access message.
7. **Save draft**.

Blocks feed `Prod02aHost` soft **OBB** rejection (with LCC capsule when available) + `onBlockDenied`.

---

## 4b. Construction props

Local assets under `public/labs/properties/community-6-henna-road/props/`. Host adds hemisphere + directional lights so GLBs are not black.

| File | Notes |
|------|--------|
| `Sign.glb` | ~57 MB (gitignored) |
| `traffic_barricade.glb` | ~40 MB (gitignored); **default scale 0.5** |
| `roadworks.gltf` | embedded buffers |
| `trafficCone.glb` | small |

Author: pick from dropdown → **Place prop here** → Scale / Yaw steps / **Position X·Y·Z** sliders + nudges (±0.25/1/5 m) / Move to me → Save draft.

**Later:** directional wayfinding signs (left turn / right turn / etc.) — not built yet.

---

## 5. Start camera & Locations

- **Set as starting point** — captures pose and **auto-saves** the draft (visitors begin here on reload). Thumbnail: `previews/locations/starting-point.jpg` via `startPreviewImageUrl`.
- **Locations** — named viewpoints; visitor list relocates via fade remount (no wall fly-through). Known names (**Starting point**, **Checkpoint B**, **Checkpoint C**) resolve scene photos under `previews/locations/` for the Locations picker cards.

---

## 6. Privacy / publication review (manual)

Inspect the live scene for:

- Readable vehicle plates
- Faces / household identifiers
- Sensitive signage
- Private interiors visible from the road
- Access-controlled areas beyond the intended capture

Do **not** silently edit the LCC2. Propose redaction workflow only if needed. Keep `status: draft` until you approve.

---

## 7. Cloudflare R2 handoff (prepare only — no upload)

Suggested prefix: `properties/community-6-henna-road/v1/`

Upload inventory after approval:

1. Entire `v1-lcc2/` tree (preserve relative paths; entry `Community6HennaRoad.lcc2`)
2. Exported `community-6-henna-road.experience.json`
3. Cover + optional location stills

Do **not** overwrite Spintex House objects. Reuse existing R2 verify scripts when approved.

---

## 8. Manual test (numbered)

1. `npm run dev` → http://localhost:3000/labs/prod-03  
2. Confirm load (collision yes in Author).  
3. Walk / Orbit / Avatar (Orb ~36 cm body).  
4. Q/E turn while Avatar selected.  
5. `?author=1` — **Set as starting point** on the road (auto-saves).  
6. Add 2–3 road blocks; wireframes on; walk into them → toast “under construction”.  
7. Dup + Nudge a block along an edge.  
8. Place a cone / sign / barricade; scale + rotate; Save draft.  
9. Avatar mode: hold **Shift** — sprint should feel much faster outdoors.  
10. Add a Location; return via Locations list.  
11. Quality Performance / Balanced / High.  
12. Save draft → refresh → settings restore.  
13. Export JSON.  
14. Confirm `/labs/property-experience` and `/labs/prod-02b` still work.

---

## Changelog

| Date | Note |
|------|------|
| 2026-11-11 | Location picker thumbnails for Starting point / Checkpoint B / C |
| 2026-11-11 | Visitor UX: Starting point in Locations; SH-style nav + follow modes; bottom control guide; apartment pads default; sprint lever |
| 2026-11-11 | Checkpoint/start spawn: author eye height (not follow target) + ground snap; default quality High; packaged draft 10 blocks / 12 props / 2 checkpoints |
| 2026-11-10 | Fix: construction props sync after host ready so Visitor Preview shows signs while blocks stay invisible |
| 2026-11-10 | Road-block X/Y/Z move + nudges; packaged draft refreshed (9 blocks, 8 props, 3 checkpoints) |
| 2026-11-10 | Packaged `community-6-henna-road.experience.json` (9 blocks + start); Import JSON + Restore packaged |
| 2026-11-10 | Prop X/Y/Z move + nudges; Walk mode uses same Shift sprint lever; default run 4.5× |
| 2026-11-10 | Blocker/prop rotate steps ±15/30/45/60/90° + 1° yaw slider |
| 2026-11-10 | Prop lighting; barricade default 0.5×; blocker yaw/OBB; visitor invisible vs frosted glass + distance fade; sprint lever 2.5–5.5× |
| 2026-11-10 | Outdoor sprint multiplier; Set starting point auto-save; road-block deny toast; construction props dropdown + scale |
| 2026-11-10 | Archive inspect + extract; `/labs/prod-03`; Orb V1.1 Avatar mode; barrier editor on Prod02aHost; draft/export; SH/R2 deferred |
