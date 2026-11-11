/**
 * PROD-03 outdoor road experience configuration.
 * Single capture — no floors / stairs. Coordinates are local to the LCC2 model frame.
 */

import type { Vec3Tuple } from "@/lib/labs/experiences/types";
import {
  HENNA_CATEGORY,
  HENNA_COVER_PREVIEW,
  HENNA_DATA_PATH,
  HENNA_DISPLAY_NAME,
  HENNA_ENTRY_FILENAME,
  HENNA_PROPERTY_ID,
  HENNA_SLUG,
  HENNA_START_PREVIEW,
  hennaLocationPreview,
  type HennaPropKind,
} from "@/lib/labs/prod03/assets";

export const PROD03_SCHEMA = "spatial-lab/outdoor-road-experience" as const;
export const PROD03_VERSION = 1 as const;

export const PROD03_DEFAULT_BLOCK_MESSAGE = "That section is under construction.";

export type Prod03NavMode = "walk" | "orbit" | "avatar";
export type Prod03PublicationStatus = "draft" | "ready" | "published";

export type Prod03CameraPose = {
  position: Vec3Tuple;
  target: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  eyeHeight?: number;
};

export type Prod03Barrier = {
  id: string;
  label: string;
  enabled: boolean;
  center: Vec3Tuple;
  /** Full width / height / depth in metres. */
  size: Vec3Tuple;
  /** Yaw (rad) around world Y — oriented box collision + visuals. */
  yaw?: number;
  /** Shown when a visitor tries to enter this block. */
  denyMessage?: string;
};

/** How visitors see road blocks (collision always applies when enabled). */
export type Prod03BlockVisual = "hidden" | "glass";

export const PROD03_SPRINT_PRESETS = [2.5, 3.5, 4.5, 5.5] as const;
export type Prod03SprintMultiplier = (typeof PROD03_SPRINT_PRESETS)[number];

export type Prod03PropPlacement = {
  id: string;
  kind: HennaPropKind;
  label: string;
  position: Vec3Tuple;
  /** Yaw around world Y (radians). */
  yaw: number;
  /** Uniform scale. */
  scale: number;
  visible?: boolean;
};

export type Prod03Location = {
  id: string;
  name: string;
  description?: string;
  order?: number;
  position: Vec3Tuple;
  target: Vec3Tuple;
  yaw?: number;
  pitch?: number;
  /** Optional thumbnail for the Locations picker. */
  previewImageUrl?: string;
  visitorVisible?: boolean;
  showInScene?: boolean;
};

export type Prod03ExperienceConfig = {
  schema: typeof PROD03_SCHEMA;
  version: typeof PROD03_VERSION;
  property: {
    id: string;
    slug: string;
    title: string;
    description: string;
    category: string;
    status: Prod03PublicationStatus;
  };
  model: {
    entry: string;
    localPath: string;
    remoteBaseUrl?: string;
  };
  startCamera: Prod03CameraPose | null;
  /** Thumbnail for the synthetic Starting point location chip. */
  startPreviewImageUrl?: string;
  defaultNavMode: Prod03NavMode;
  defaultQualityId: "performance" | "balanced" | "high";
  /** Orb Assistant V1.1 only — Free Follow. */
  avatar: {
    kind: "orb-assistant-v1.1";
    scale: number;
    /** Shift sprint multiplier (outdoor presets 2.5–5.5). */
    sprintMultiplier?: Prod03SprintMultiplier;
  };
  /** Visitor look for road blocks: fully invisible, or nearby frosted glass. */
  blockVisual: Prod03BlockVisual;
  barriers: Prod03Barrier[];
  /** Dressing meshes (signs / cones / barricades) placed along the road. */
  props: Prod03PropPlacement[];
  locations: Prod03Location[];
  previewImageUrl?: string;
  notes?: string;
  updatedAt?: string;
};

export function createHennaSeed(): Prod03ExperienceConfig {
  return {
    schema: PROD03_SCHEMA,
    version: PROD03_VERSION,
    property: {
      id: HENNA_PROPERTY_ID,
      slug: HENNA_SLUG,
      title: HENNA_DISPLAY_NAME,
      description:
        "An interactive walk along a reconstructed community road section. Explore the captured stretch only — this is not the entire community.",
      category: HENNA_CATEGORY,
      status: "draft",
    },
    model: {
      entry: HENNA_ENTRY_FILENAME,
      localPath: HENNA_DATA_PATH,
    },
    startCamera: null,
    startPreviewImageUrl: HENNA_START_PREVIEW,
    defaultNavMode: "avatar",
    defaultQualityId: "high",
    avatar: {
      kind: "orb-assistant-v1.1",
      scale: 1.5,
      sprintMultiplier: 4.5,
    },
    blockVisual: "hidden",
    barriers: [],
    props: [],
    locations: [],
    previewImageUrl: HENNA_COVER_PREVIEW,
    notes:
      "PROD-03 lab draft. Place barriers after inspecting the road. Do not publish until approved.",
  };
}

function clampSprint(value: unknown): Prod03SprintMultiplier {
  const n = Number(value);
  if (n === 2.5 || n === 3.5 || n === 4.5 || n === 5.5) return n;
  return 4.5;
}

/** Normalize older drafts missing props / denyMessage / blockVisual / previews. */
export function normalizeProd03Config(raw: Prod03ExperienceConfig): Prod03ExperienceConfig {
  const visual = raw.blockVisual === "glass" ? "glass" : "hidden";
  return {
    ...raw,
    avatar: {
      kind: "orb-assistant-v1.1",
      scale: raw.avatar?.scale ?? 1.5,
      sprintMultiplier: clampSprint(raw.avatar?.sprintMultiplier),
    },
    blockVisual: visual,
    startPreviewImageUrl: raw.startPreviewImageUrl?.trim() || HENNA_START_PREVIEW,
    barriers: (raw.barriers ?? []).map((b) => ({
      ...b,
      yaw: b.yaw ?? 0,
      denyMessage: b.denyMessage?.trim() || PROD03_DEFAULT_BLOCK_MESSAGE,
    })),
    props: Array.isArray(raw.props) ? raw.props : [],
    locations: (raw.locations ?? []).map((loc) => ({
      ...loc,
      previewImageUrl:
        hennaLocationPreview(loc.name, loc.previewImageUrl) ?? loc.previewImageUrl,
    })),
  };
}
