/** PROD-03 — Community 6 Henna Road outdoor LCC2 assets. */

export const HENNA_PROPERTY_ID = "community-6-henna-road";
export const HENNA_SLUG = "community-6-henna-road";

export const HENNA_DATA_PATH =
  "/labs/properties/community-6-henna-road/v1-lcc2/Community6HennaRoad.lcc2";

export const HENNA_COVER_PREVIEW =
  "/labs/properties/community-6-henna-road/previews/cover.jpg";

/** Packaged authored draft (barriers / start) — fallback when localStorage is empty. */
export const HENNA_EXPERIENCE_JSON_PATH =
  "/labs/properties/community-6-henna-road/community-6-henna-road.experience.json";

export const HENNA_START_PREVIEW =
  "/labs/properties/community-6-henna-road/previews/locations/starting-point.jpg";

export const HENNA_LOCATION_PREVIEWS: Record<string, string> = {
  "Starting point": HENNA_START_PREVIEW,
  "Checkpoint B":
    "/labs/properties/community-6-henna-road/previews/locations/checkpoint-b.jpg",
  "Checkpoint C":
    "/labs/properties/community-6-henna-road/previews/locations/checkpoint-c.jpg",
};

/** Resolve a location thumbnail from explicit URL or known Henna name. */
export function hennaLocationPreview(
  name: string,
  previewImageUrl?: string | null,
): string | null {
  if (previewImageUrl?.trim()) return previewImageUrl.trim();
  return HENNA_LOCATION_PREVIEWS[name] ?? null;
}

/** Suggested future R2 prefix (do not upload until approved). */
export const HENNA_R2_PREFIX = "properties/community-6-henna-road/v1";

export const HENNA_ENTRY_FILENAME = "Community6HennaRoad.lcc2";

export const HENNA_DISPLAY_NAME = "Community 6 — Henna Road";
export const HENNA_CATEGORY = "Neighborhood & Built Environments";

export const HENNA_PROPS_BASE = "/labs/properties/community-6-henna-road/props";

export type HennaPropKind = "sign" | "barricade" | "roadworks" | "cone";

export type HennaPropCatalogItem = {
  kind: HennaPropKind;
  label: string;
  url: string;
  /** Uniform scale applied when placing a new instance. */
  defaultScale: number;
  note?: string;
};

/** Construction set for road-block dressing (local props folder). */
export const HENNA_PROP_CATALOG: HennaPropCatalogItem[] = [
  {
    kind: "sign",
    label: "Road works sign",
    url: `${HENNA_PROPS_BASE}/Sign.glb`,
    defaultScale: 1,
    note: "Large GLB (~57 MB) — first load may take a moment.",
  },
  {
    kind: "barricade",
    label: "Traffic barricade",
    url: `${HENNA_PROPS_BASE}/traffic_barricade.glb`,
    defaultScale: 0.5,
    note: "Large GLB (~40 MB); default scale 50%.",
  },
  {
    kind: "roadworks",
    label: "Prepare to stop (roadworks)",
    url: `${HENNA_PROPS_BASE}/roadworks.gltf`,
    defaultScale: 1,
  },
  {
    kind: "cone",
    label: "Traffic cone",
    url: `${HENNA_PROPS_BASE}/trafficCone.glb`,
    defaultScale: 1,
  },
];

export function hennaPropByKind(kind: HennaPropKind): HennaPropCatalogItem {
  return HENNA_PROP_CATALOG.find((p) => p.kind === kind) ?? HENNA_PROP_CATALOG[0]!;
}
