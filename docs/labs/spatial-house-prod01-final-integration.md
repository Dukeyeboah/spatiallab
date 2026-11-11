# PROD-01 final integration

**Branch:** `feature/prod01-final-integration`  
**Checkpoint commit:** `65fdf56` — PROD-01 + PROD-02A preserved before merge work  
**Do not publish to Spatial House until approved.**

## Decisions locked in

| Topic | Decision |
|-------|----------|
| Joystick | **Disabled** — code kept under `components/labs/prod02a/MobileNavControls.tsx`; not rendered; no listeners in production player |
| Camera presets | `Spatial House — Free Follow v1` / `Orbit Follow v1` in `lib/labs/prod02a/cameraPresets.ts` |
| Model format | **LCC2 primary** (`v1-lcc2/…/*.lcc2`); portable `.lcc` under `v1/` as rollback |
| Integration style | Extend PROD-01 — keep blocks, stair popups, rooms, Dev authoring |
| Point & Move | Merged into Walk: click a reachable floor spot in Walk (first-person) or Point & Move mode; targets the active controller (smooth avatar or classic walk); LOS check (no `three-pathfinding` yet) |
| Integration in `ExperienceTourHost` | Prop `cameraFollowStyle` (`"first-person"` default / `"free"` / `"ecctrl"`). free/ecctrl enable `SmoothAvatarControls` and disable `LccWalkControls`; both share the **same** `resolveCollision` (LCC + blockZones + furniture). Camera boom via `resolveCameraBoomAlong`. Stairs / triggers use the avatar **body eye**, not the boom camera |
| FOV | 65° (PROD-02A approved) |

## Checkpoint

Everything before this integration is preserved in commit `65fdf56`
(`Checkpoint: PROD-01 multifloor + PROD-02A smooth nav (pre-integration)`). Roll back with
`git checkout 65fdf56 -- <path>` or reset the integration branch to that commit.

## Joystick disabled

The PROD-02A joystick (`components/labs/prod02a/MobileNavControls.tsx`) is **not rendered** in the
property experience and nothing in `ExperienceTourHost` listens for it. Existing D-pad
`WalkOnScreenControls` still route through `setVirtualMove` / `setVirtualLook`, which go to the smooth
avatar when it is active, otherwise to classic walk.

## LCC2 primary

`spintexSeed.ts` seeds floors with `SpintexHouseGroundFloor.lcc2` / `SpintexUpstairs.lcc2` under
`/labs/properties/spintex-house/v1-lcc2/{ground,first}`. `ensureSpintexStairDefaults` migrates saved
drafts still pointing at `v1/*.lcc` onto the LCC2 paths. Portable `.lcc` packages stay under
`public/labs/properties/spintex-house/v1/` for rollback (see floor `notes`).

## Routes

| Lab | URL |
|-----|-----|
| Integrated visitor (PROD-01) | http://localhost:3000/labs/property-experience (visitor default) |
| Author | http://localhost:3000/labs/property-experience?author=1 |
| Isolated PROD-02A (reference) | http://localhost:3000/labs/prod-02a |
| Isolated PROD-02B (Mixamo — postponed) | http://localhost:3000/labs/prod-02b (not in production path) |
| Handoff / readiness | `docs/labs/spatial-house-prod01-handoff.md` |

## Visitor panel UI (aligned with PROD-02A)

- **Navigation comparison:** Current (1P) / Smooth (avatar) / Free Orbit — same three-button row as 02A.
- When Smooth is selected: **Free Follow** / **Ecctrl Orbit** sub-row.
- **Rendering quality:** Performance / Balanced / High Quality (`PROD02A_QUALITY` presets).
- Previous Walk / Point & Move / Orbit toggle and multi-step `QualityLever` are commented out in
  `PropertyExperienceApp` (Point & Move remains available as click-to-move while walking).

## How to test `/labs/property-experience`

1. `npm run dev`, open http://localhost:3000/labs/property-experience (add `?author=1` for author tools).
2. Navigation comparison: **Smooth (avatar)** default with **Free Follow**; switch Current (1P) / Free Orbit.
3. Rendering quality: Performance / Balanced / High Quality.
4. Dev: check the pose chip near stairs — position reported is the avatar eye in Free/Orbit Follow.
5. Run `npx tsc --noEmit`.

## Manual test guide (numbered)

1. Open `/labs/property-experience` — welcome with Downstairs / Upstairs thumbs.
2. Enter Downstairs — confirm LCC2 load (`collision yes` in Dev stats if author).
3. Default **Smooth → Free Follow** — WASD; A/D must not yaw camera; mouse orbits independently.
4. Switch **Ecctrl Orbit** — same path; optional recenter stays off by default.
5. Switch **Current (1P)** — classic Walk; compare.
6. Click a walkable floor spot — destination ring; controller walks there; WASD cancels.
7. Click a wall — must refuse.
8. Approach stairs — confirm popup; Cancel stays; Confirm loads other floor arrival.
9. Return the other way — no loop (cooldown / suppress).
10. Room shortcuts (if authored) — fade relocate; no wall fly-through.
11. Quality Performance / Balanced / High — no floor/camera reset.
12. Confirm **no joystick** UI.
13. Author `?author=1` — edit blocks, stair triggers, capture start; data survives reload.

## Known limitations

- **No `three-pathfinding`**: Point & Move uses a line-of-sight probe, not a navmesh — corners may require intermediate clicks.
- **Joystick off**: mobile uses D-pads + limited touch only.
- Switching Walk → Free/Orbit Follow re-seats the avatar at the camera eye and resets camera pitch to the default.
- Fly-to / Reset end by re-seating the avatar at the destination eye (boom pulls the camera back after the glide).
- Coordinate check: authored PROD-01 poses assumed compatible with LCC2 + same `modelMatrix`; re-verify starts if anything looks offset.
- Mobile: real-device pass still required.
- Spatial House website integration: **plan only — not merged**; publish **deferred**.

## Spatial House publication plan (deferred)

Full audit, blockers, publish contract, visitor extract, and House route plan:
**`docs/labs/spatial-house-prod01-handoff.md`**.

1. Extract visitor-only bundle (no Dev Mode / author tools).
2. Config contract: slug, LCC2 URLs, floors, starts, rooms, stairs, blocks, camera preset ids, quality.
3. Host assets on existing R2/CDN layout; metadata JSON or Firestore later.
4. Spatial House “Explore in 3D” → `/experiences/[slug]/tour` (House already has this route).
5. Legal / SDK watermark / visibility review before go-live.
6. **Do not modify Spatial House until the integration plan is approved.**

## Changelog

| Date | Note |
|------|------|
| 2026-11-03 | Checkpoint branch; joystick disabled; named camera presets; LCC2 seed migration started; Smooth→TourHost wiring |
| 2026-11-03 | `ExperienceTourHost` integrates `SmoothAvatarControls` (`cameraFollowStyle`); Point & Move merged into Walk; `PropertyExperienceApp` camera-style buttons (default Free Follow); FOV 65 |
| 2026-11-03 | Handoff: visitor default; twin stair ignore; P&M reject hints + blockZone dest; PROD-02B postponed; SH inspect-only plan |
