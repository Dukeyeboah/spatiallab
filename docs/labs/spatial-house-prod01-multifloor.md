# LAB PROD-01 — Two-Floor Property Experience

**Status (2026-11-02):** Authoring + visitor preview implemented in Spatial Lab. Models extracted locally (not in git). Spatial House publication **not** live yet — contract documented below.

## Phase 0 — Audit (reuse)

| Capability | Status | Notes |
|------------|--------|-------|
| Plain Three.js + LCC Web SDK 0.6.3 | **Reuse** | `ExperienceTourHost` |
| Load / unload / dispose on `dataPath` change | **Reuse** | Remount + `LCCRender.unload` |
| Checkpoints (capture pose, fade fly-to) | **Reuse / extend** | Per-floor in experience JSON |
| Quality lever, walk pads, collision | **Reuse** | |
| Floor-plan upload/align (EXP-03B) | **Reuse later** | Link via `floorPlan.planRecordId`; not re-authored in this UI yet |
| Staging / wall overlays (EXP-04/05) | **Preserved** | Not in visitor PROD-01 chrome |
| Multi-floor schema + connections | **New** | `lib/labs/experiences/propertyExperience/` |
| Floor welcome (screenshots only) | **New** | No LCC load |
| Stair triggers + confirm | **Live (First→Ground)** | Stop AABB + void block + “Go downstairs?” modal; cooldown / arrival suppress |
| Export / import experience JSON | **New** | Draft in localStorage + file export |
| ZIP import UI | **Partial** | Shell extract documented; packages already extracted |
| Shared world registration | **Out of scope** | Connections map scene→arrival camera only |

## Property demo: Spintex House (provisional)

| Floor | Entry | Local path |
|-------|--------|------------|
| Ground Floor | `SpintexHouseGroundFloor.lcc` | `public/labs/properties/spintex-house/v1/ground/` |
| First Floor | `SpintexUpstairs.lcc` | `public/labs/properties/spintex-house/v1/first/` |

Source ZIPs (unchanged archives in Downloads):

- `Spintex House Ground Floor_render.zip` (~321 MB)
- `Spintex Upstairs_render.zip` (~318 MB)

Format: Portable **`.lcc`** (not LCC2/SOG). SDK loads with `usePage: false`.

Previews: `v1/previews/downstairs.jpg`, `upstairs.jpg` (visitor welcome thumbs; `ground.jpg` / `first.jpg` kept as copies).

## Storage plan

| What | Where |
|------|--------|
| Original ZIPs | Keep in local backup / private archive — **not** git |
| Extracted floor packages | `public/labs/properties/<slug>/v1/{ground,first}/` (gitignored) |
| Preview images | `…/previews/` (small; may commit) |
| Experience config | Draft: localStorage · Export: `*.experience.json` · Optional commit under property folder |
| R2 (later) | Versioned prefixes `properties/<slug>/v1/ground/…` — **not** uploaded in this lab |
| Spatial House metadata | Firestore later — not required for PROD-01 |

## Spatial House publication contract

**Visitor URL (target):** `/experiences/[slug]` e.g. `/experiences/spintex-house`

Optional query: `?floor=ground` | `?floor=first` (skip welcome when `allowDirectFloorLinks`).

**Published package:**

1. Validated `PropertyExperienceConfig` JSON (schema `spatial-lab/property-experience` v1)
2. HTTPS model bases per floor (`model.remoteBaseUrl` + `entry`) with identical relative layout
3. Preview image URLs
4. `property.status: "published"`
5. Rights confirmation (client models — never public without approval)

**Spatial House must:**

- Show property card → **Explore in 3D**
- Mount the **same** visitor player (no Dev chrome)
- Support floor welcome, start cameras, room shortcuts, two-way stair confirms
- Hide author tools

Do **not** publish live until approved.

## Authoring summary

Open **`http://localhost:3000/labs/property-experience?author=1`**.

1. Extract models (README under `public/labs/properties/spintex-house/`).
2. Toggle **Author mode**.
3. Enter a floor → **Save as Floor Start** / **Capture floor preview**.
4. **Capture pose** → name → **Add Room / Checkpoint**.
5. At stairs → walk into the seeded First→Ground trigger (or **Create Floor Connection**); set Ground start for arrival.
6. **Save Draft** (floor starts auto-persist) → **Validate** → **Export Experience JSON**.
7. Switch to **Visitor Preview** and run the Phase 10 journey.

## Limitations

- Floor-plan align UI still lives under classic Experiences; PROD-01 stores optional `floorPlan` refs only.
- First→Ground stair confirm is live; Ground→First upstairs connection not authored yet.
- Block zones are axis-aligned boxes; tighten `size` in exported JSON if needed.
- Preview capture may store a data-URL in the draft (large); replace with file under `previews/` for publish.
- R2 / paid upload **not** performed.
- Full GPU memory soak after many floor switches: mark **unverified** until you stress-test.

## Graphics presets

See `qualityPresets.ts` / PROD-02A: 8-step ladder + mix tests (e.g. 4M·30m·1×). Default remains **Balanced** (1.5M · 55 m · 1.5×).

## Changelog

| Date | Note |
|------|------|
| 2026-11-02 | PROD-01 player + authoring; Spintex extract; startCamera on TourHost; poses.json also from `assets/` |
| 2026-11-03 | First→Ground stair stop/modal from author positions; mix graphics presets; auto-persist floor start |
| 2026-11-03 | Start-camera flash fixed (opaque loader + reveal after pose); downstairs trigger at void stopper; default eye 1.50 m; sync draft hydrate |
| 2026-11-03 | Fix Ground start save (keep world Y, not eyeHeight); Ground→First stair block/modal; clear corrupt Ground starts |
| 2026-11-03 | Upstairs trigger on stair treads (not hallway); HousePointsLoader + ~1.75s LOD settle before reveal |
| 2026-11-03 | Ground stair block/trigger saved at (−1.41, −2.96, 4.09); PROD-02A moved to isolated `/labs/prod-02a` |
