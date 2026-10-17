import type { ExperienceCatalog, ExperienceProperty } from "./types";

/**
 * Built-in demo properties for Spatial Lab Experiences.
 * Sample packages under public/labs/lcc-samples/ (gitignored) — XGRIDS proprietary.
 */
export const EXPERIENCE_CATALOG: ExperienceCatalog = {
  version: 1,
  properties: [
    {
      id: "xgrids-room",
      title: "Sample Residence — Room",
      description: "XGRIDS Room LCC2 walkthrough · Spatial Lab Experiences prototype (not a client listing).",
      dataPath: "/labs/lcc-samples/Room_Tour_L2_PRO_P/meta.lcc2",
      sizeHint: "~108 MB",
      branding: { accent: "#c4a574", tagline: "Spatial Lab Experiences" },
      nav: { defaultMode: "first-person", maxSplats: 1_500_000, collision: true },
      viewpointsReady: true,
      floors: [
        {
          id: "floor-1",
          name: "Main floor",
          // Hand-tuned walkable AABB from capture poses — not LCC getBounds().
          worldBounds: { minX: -9, maxX: 2.5, minZ: -12.5, maxZ: 1.5 },
        },
      ],
      viewpoints: [
        {
          id: "vp-entrance",
          name: "Entrance",
          roomId: "Entrance",
          order: 0,
          description: "Near the start of the capture path.",
          sceneId: "xgrids-room",
          position: [0.05, 1.45, 0.4],
          target: [0.05, 1.35, -2.2],
          mapUv: { u: 0.72, v: 0.88 },
        },
        {
          id: "vp-living",
          name: "Living area",
          roomId: "Living area",
          order: 1,
          description: "Mid-room vantage from the capture trajectory.",
          sceneId: "xgrids-room",
          position: [-6.2, 1.4, -2.4],
          target: [-3.5, 1.25, -4.5],
          mapUv: { u: 0.22, v: 0.55 },
        },
        {
          id: "vp-far",
          name: "Far corner",
          roomId: "Far corner",
          order: 2,
          description: "Looking back across the space.",
          sceneId: "xgrids-room",
          position: [-1.0, 1.5, -10.5],
          target: [-2.5, 1.3, -6.0],
          mapUv: { u: 0.58, v: 0.12 },
        },
      ],
      hotspots: [
        {
          id: "hs-welcome",
          title: "Welcome",
          description: "Demo hotspot near the entrance.",
          sceneId: "xgrids-room",
          position: [0.2, 1.2, -1.5],
        },
        {
          id: "hs-feature",
          title: "Feature wall",
          description: "Example of an anchored note on reconstructed geometry.",
          sceneId: "xgrids-room",
          position: [-5.5, 1.3, -3.8],
        },
      ],
    },
    {
      id: "xgrids-penthouse",
      title: "Sample Residence — Penthouse",
      description: "XGRIDS PentHouse LCC2 (~10.7M splats). Inspect before inventing room labels.",
      dataPath: "/labs/lcc-samples/PentHouse/meta.lcc2",
      sizeHint: "~180 MB",
      branding: { accent: "#8a9bb0", tagline: "Spatial Lab Experiences" },
      nav: { defaultMode: "first-person", maxSplats: 1_500_000, collision: true },
      viewpointsReady: false,
      floors: [],
      viewpoints: [],
      hotspots: [],
    },
    {
      id: "xgrids-revit-home",
      title: "Sample — Revit Home",
      description: "XGRIDS Revit Home LCC2 (~4.1M splats, ~49 MB). Viewpoints empty until inspected.",
      dataPath: "/labs/lcc-samples/XGRIDS_Revit__Home/meta.lcc2",
      sizeHint: "~49 MB",
      branding: { accent: "#a89078", tagline: "Spatial Lab Experiences" },
      nav: { defaultMode: "first-person", maxSplats: 1_500_000, collision: true },
      viewpointsReady: false,
      floors: [],
      viewpoints: [],
      hotspots: [],
    },
  ],
};

export function propertyById(id: string): ExperienceProperty | undefined {
  return EXPERIENCE_CATALOG.properties.find((p) => p.id === id);
}

export const DEFAULT_EXPERIENCE_ID = "xgrids-room";

export function sortedViewpoints(vps: ExperienceProperty["viewpoints"]) {
  return [...vps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}
