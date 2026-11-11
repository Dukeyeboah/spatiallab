# PROD-01 — Production readiness & Spatial House handoff

**Date:** 2026-11-03  
**Status:** Lab player stabilized for visitor preview; **Spatial House website not modified** (plan only).  
**PROD-02B (Mixamo):** **Postponed** — isolated at `/labs/prod-02b`; **not** imported into property-experience.

Open: **http://localhost:3000/labs/property-experience** (visitor default) · **`?author=1`** for authoring.

---

## 1. Production-readiness report

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Room shortcuts both floors | **Incomplete (content)** | Code + fade/`flyTo` ready; seed `viewpoints: []`. Author must capture rooms (or import JSON). |
| 2 | Stair transitions both ways + popup | **Implemented / unverified live** | Ground↔First connections + Confirm/Stay modal. |
| 3 | Anti floor-transition loops | **Implemented** | Cooldown 4s + arrival suppress 5.5s + **twin-trigger ignore until walk-out** (2026-11-03). |
| 4 | Point & Move in Walk | **Implemented (LOS only)** | Click floor while walking; WASD/Esc cancel. **No navmesh.** Unreachable → toast. Block zones refused. |
| 5 | LCC2 both floors | **Implemented (on disk)** | `v1-lcc2/{ground,first}/*.lcc2` present; `v1/*.lcc` rollback. Gitignored. |
| 6 | Invisible Free Follow / Ecctrl | **Implemented** | PROD-02A presets; Smooth default; joystick **off**. |
| 7 | Collision blocks + boom + P&M | **Partial** | Body: LCC + blockZones. Boom: LCC only. P&M: LCC LOS + blockZone dest check. |
| 8 | Quality Performance / Balanced / High | **Implemented / unverified** | `PROD02A_QUALITY`; quality change does not remount host. |
| 9 | Welcome, starts, visitor vs author | **Partial** | Welcome ✓. Seed starts `null` until authored/draft. **Visitor default**; `?author=1` for Dev. |
| 10 | Export / publish contract | **Partial** | Draft localStorage + JSON download/validate. No remote publish pipeline yet. |
| 11 | PROD-02B out of production path | **Done** | No Mixamo in property player / TourHost. |

**Verdict:** Integration code is ready for **lab acceptance testing**. Not Spatial House–publishable until starts + rooms are authored, rights/CDN confirmed, and visitor bundle extracted.

---

## 2. Remaining blockers (ranked)

1. **Authored start cameras** — seed `startCamera: null`; stair landings fall back to placeholder eye until saved in Author mode (or draft already has them in localStorage).
2. **Room checkpoints empty** — shortcuts unusable until viewpoints captured on both floors.
3. **Point & Move = straight LOS** — corners / around walls need intermediate clicks; no pathfinding. Acceptable for lab; **disable or keep limited** for public until verified.
4. **Camera boom ignores blockZones** — can clip through soft barriers visually.
5. **Publish / CDN package** — no immutable remote LCC2 URLs + published JSON yet.
6. **Spatial House tour player gap** — House still single-floor `TourViewer`; multi-floor visitor not wired (see §9).
7. **Legal / SDK key / asset rights** — House gate requires `assetRightsConfirmed` + commercial licence.
8. **Live regression** — items below still need a human pass on the real Spintex LCC2.

---

## 3. Visitor navigation (locked)

| Setting | Value |
|---------|--------|
| Controller | Invisible `SmoothAvatarControls` (PROD-02A) |
| Default | Smooth + **Free Follow** |
| Alternate | **Ecctrl Orbit** |
| Classic 1P / Free Orbit | Kept for lab comparison; lock for public SH if desired |
| Joystick | **Disabled** (code retained, not mounted) |
| Input | WASD / arrows, mouse look, on-screen D-pads |
| Point & Move | Click walkable floor; cancel with WASD/Esc; refuse wall / LOS / block zone with hint |
| Visible avatar | **None** (PROD-02B postponed) |

Presets: `lib/labs/prod02a/cameraPresets.ts` · Quality: `lib/labs/prod02a/qualityPresets.ts`.

---

## 4. LCC2 migration status

| Floor | Primary | Rollback | Seed |
|-------|---------|----------|------|
| Ground | `public/labs/properties/spintex-house/v1-lcc2/ground/SpintexHouseGroundFloor.lcc2` | `v1/ground/…lcc` | `ensureSpintexStairDefaults` migrates drafts |
| First | `…/v1-lcc2/first/SpintexUpstairs.lcc2` | `v1/first/…lcc` | same |

**Unverified live:** collision mesh flag, pose alignment of old starts vs LCC2, GPU soak on floor switch.

---

## 5. Point & Move status

| Item | Status |
|------|--------|
| In Walk / Smooth | Yes |
| Barriers (LCC) | LOS + floor normal |
| Authored blockZones | Destination rejected |
| Pathfinding | **No** — report corners as multi-click |
| Unreachable UX | Toast (`Can't walk there directly…`) |
| Public release | Keep as **best-effort click-to-move**; do not claim full routing |

---

## 6. Versioned experience configuration (publishing contract)

Schema already: `PropertyExperienceConfig` in `lib/labs/experiences/propertyExperience/types.ts`  
(`schema` + `version` constants, property id/slug/title/status, floors, connections, visitor).

### Required published fields

| Field | Source |
|-------|--------|
| property.id, slug, title, description, status | `property` |
| floors[].id, name, order, model.entry, localBasePath / remoteBaseUrl | `FloorRecord.model` |
| floors[].startCamera, viewpoints, blockZones, floorPlan, previewImage | Floor record |
| connections[] (triggers, labels, arrivalCamera) | Stair links |
| visitor (checkpointTransition, allowDirectFloorLinks, …) | UI |
| navigation.cameraPresetIds | Document Free / Ecctrl preset ids |
| rendering.qualityPresetIds | performance / balanced / high |
| schema + version | Migration key |

### Rules

- Floor-local coordinates; stable floor + connection ids.
- **No secrets** in JSON (no API keys).
- **Not** localStorage-only for production — export JSON → host on HTTPS (R2/CDN); optional Firestore for metadata/status only.
- Large LCC2 packages stay on object storage, referenced by URL.
- Import into clean preview must reconstruct the tour (`parseExperienceJson` + validate).

### Schema migration

Bump `PROPERTY_EXPERIENCE_VERSION`; keep `ensureSpintexStairDefaults`-style migrators for known drafts; reject unknown future `schema` with a clear error.

### Export today

Author mode → download experience JSON (`storage.ts`). Treat that file + CDN model folders as the first publish package.

---

## 7. Reusable visitor-player package (proposed)

**Least disruptive (matches Spatial House precedent):** copy a **visitor-only** module into Spatial House (same pattern as current `lib/viewer/*` from SpaceViewer). Shared npm package later once APIs stabilize. **No monorepo.**

### Include

1. `FloorWelcome` (visitor)
2. Visitor shell of `PropertyExperienceApp` (no author Dev sections)
3. `ExperienceTourHost` + `SmoothAvatarControls` + boom + quality apply
4. `propertyExperience/types`, defaults, parse/validate
5. Vendored LCC SDK 0.6.3 + licensed init
6. Walk D-pads (no joystick)

### Exclude

Editor, draft localStorage as sole config, staging/surfaces labs, calibration, research routes, PROD-02B Mixamo, author collision editors.

### Equivalence

Spatial Lab Visitor Preview (`/labs/property-experience`) and published House `/experiences/[slug]/tour` must share the same nav, collision, and stair behavior for a given published config.

---

## 8. Remote assets & safety

- Prefer existing HTTPS hosting / `NEXT_PUBLIC_LCC_ASSET_BASE` pattern already used by House.
- Immutable model versions (`v1-lcc2/…`); new capture → new version folder.
- Public: previews + published JSON + LCC2 packages cleared for display.
- Private: raw scans, author drafts, keys.
- Confirm property display rights + commercial SDK licence before go-live.

---

## 9. Spatial House integration plan (inspect only — **not implemented**)

**Repo:** `/Users/duke/Documents/GitHub/SpatialHouse`

| Surface | Path |
|---------|------|
| Gallery | `app/experiences/page.tsx` + `components/experiences/ExperienceCard.tsx` |
| Detail | `app/experiences/[slug]/page.tsx` |
| Explore in 3D | Card/detail → `/experiences/[slug]/tour` when `canLaunchTour` |
| Tour route | `app/experiences/[slug]/tour/page.tsx` → today’s single-floor `TourViewer` |
| Catalog | `lib/experiences.ts` (placeholders only today) |
| Docs | `docs/VIEWER-INTEGRATION.md`, `docs/ADDING-EXPERIENCES.md` |

**Proposed flow (URLs already match):**  
Property card → Explore in 3D → `/experiences/[slug]/tour` → floor welcome → multi-floor visitor player.

| Step | Action | Touch |
|------|--------|-------|
| A | Add Spintex (or real) listing only when rights + CDN ready | `lib/experiences.ts` |
| B | Add `experienceConfigUrl` (multi-floor JSON); keep legacy `tourPath` | catalog type |
| C | Tour page: if config URL → Lab visitor player; else existing `TourViewer` | `tour/page.tsx` |
| D | Host floors on CDN; gitignore large assets | ops |
| E | No Dev Mode / no accounts / no billing this milestone | product |

**Do not** iframe Spatial Lab. **Do not** merge Lab FastAPI.

### Implemented in Spatial House (2026-11-03)

Architectural Property is live as a `public-demo`:

- Cover: `public/images/experiences/architectural-property.avif`
- Explore in 3D → minimal Downstairs / Upstairs picker → Smooth Free/Ecctrl walk
- Tour packages under `public/tours/architectural-property/` (local symlinks to Lab LCC2)
- Docs: SpatialHouse `docs/PROPERTY-TOUR.md`

---

## 10. Manual acceptance test (Spatial Lab)

Run on real Spintex LCC2. Mark each **pass / fail / N/A**.

1. `/labs/property-experience` — welcome thumbs for both floors.  
2. Enter Ground — LCC2 loads; Author (`?author=1`) shows `collision yes`.  
3. Smooth + Free Follow — WASD; camera independent of strafe.  
4. Ecctrl Orbit — same path.  
5. Current (1P) — classic walk compare.  
6. Click walkable floor — moves; WASD cancels.  
7. Click wall / through doorway corner — toast refuse.  
8. Click into block zone — toast refuse.  
9. Approach stairs — popup; Stay; Confirm → other floor.  
10. Reciprocal stairs — no instant loop; leave zone then re-trigger OK.  
11. Room shortcuts — **N/A until authored**.  
12. Quality Performance → High — no floor/pose reset.  
13. No joystick.  
14. Visitor role — no author Dev sections.  
15. Hard refresh — draft/export still load.  
16. Switch floors repeatedly — no stuck loader / duplicate WebGL.  
17. Export JSON → clear draft → import — tour reconstructs.  
18. PROD-02B not present in this UI.

---

## 11. Automated vs manual vs unverified

| Kind | Items |
|------|--------|
| Automated | `npx tsc --noEmit`; schema parse/validate unit paths if present |
| Manual | §10 list |
| Unverified this pass | Live stair feel, boom vs blocks, mobile D-pads, CDN cold load, House tour branch |

---

## Changelog

| Date | Note |
|------|------|
| 2026-11-03 | Handoff audit; visitor default; twin stair ignore; P&M reject toasts + blockZone dest; PROD-02B postponed; SH plan read-only |
