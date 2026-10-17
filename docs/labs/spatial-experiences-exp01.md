# LAB EXP-01 — Spatial Lab Experiences (interactive tour prototype)

**Status (2026-10-17):** Local prototype. Plain Three.js + XGRIDS LCC Web SDK **0.6.3**. Independent of LiDAR / calibration / Nerfstudio pipelines. No cloud spend. Sample packages are **proprietary XGRIDS demos** — do not redistribute or assume commercial license / `appKey` rights until confirmed.

| Item | Location |
|------|----------|
| Route | `/labs/spatial-experiences` |
| Host | `components/labs/experiences/ExperienceTourHost.tsx` |
| Catalog | `lib/labs/experiences/catalog.ts` (property, viewpoints, hotspots) |
| Editor overrides | `localStorage` key `spatial-lab.experiences.overrides.v1` |
| Samples | `public/labs/lcc-samples/Room_Tour_L2_PRO_P/`, `PentHouse/` (gitignored) |
| SDK playground | `/labs/lcc-web-sdk` (unchanged) |

## Architecture

| Layer | Role |
|-------|------|
| Next.js / React | Property panel, viewpoint list, hotspot card, hide UI, fullscreen, Dev editor |
| Plain Three.js + LCC SDK | Gaussian rendering, orbit / walk, pick, marker meshes |
| Experience catalog | Per-project settings separate from LCC tiles |

R3F is **not** used for this renderer.

## Deliverables

### 1. Working Room tour
- Default property **Sample Residence — Room**
- Three viewpoints: Entrance, Living area, Far corner (smooth fly-to)
- Two demo hotspots (click marker or list)
- Orbit / Walk, Reset, Hide UI, Fullscreen

### 2. PentHouse load test
- Scene selector includes PentHouse (`meta.lcc2`, ~180 MB tiles on disk, ~10.7M splats in meta)
- **No** invented viewpoints/hotspots until geometry is inspected (`viewpointsReady: false`)
- **Findings (verified in browser 2026-10-17):** switching Scene → Penthouse remounts the host and **renders** an interior (stone feature wall, wood cabinetry, ceiling lights). Meta HTTP 200; tiles under `public/labs/lcc-samples/PentHouse/data/`. First load is slower than Room (~180 MB). No poses.json for auto viewpoints — leave empty until walked.

### 3–5. Viewpoints, hotspots, editing
- Dev panel: Capture camera → name → Save viewpoint; Place hotspot → click scene → title/description → Save
- Overrides merge with catalog; Remove deletes override only
- Hotspot positions are Three.js world coords (post modelMatrix); markers rebuild when the list changes

### 6. Performance (dev panel)
- Live FPS + progress + max-splats slider (0.5M–4M)
- Room typically navigable with UI open on a modern laptop GPU; drop max-splats if FPS falls
- Single animation loop; SDK `releaseLccSdk()` on unmount / scene switch

### 7. Recommended next features
→ **Done in LAB EXP-02** for perf presets, Walk default, floor map, collision probe, Revit Home. See `docs/labs/spatial-experiences-exp02.md`.

Still open after EXP-02:
1. Record PentHouse / Revit viewpoints after walking (do not invent names beforehand)
2. Branded shell per client (logo, accent, copy) driven by catalog only
3. Guided path / auto-tour between viewpoints
4. Hotspot media library (local uploads) and floor-plan image authoring
5. Confirm XGRIDS commercial license + `appKey` before any public deploy

### 8. License note
Samples remain XGRIDS property. This lab is an **internal prototype**. Commercial deployment requires explicit licensing confirmation.

## How to open

1. Ensure samples exist under `public/labs/lcc-samples/` (see README there).
2. `npm run dev` → `/labs/spatial-experiences`
3. Wait for loading bar → use viewpoint buttons / gold markers
4. Dev → performance and authoring tools
