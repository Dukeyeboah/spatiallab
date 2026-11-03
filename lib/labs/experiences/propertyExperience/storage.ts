import {
  PROPERTY_EXPERIENCE_SCHEMA,
  PROPERTY_EXPERIENCE_VERSION,
  type PropertyExperienceConfig,
} from "./types";

const DRAFT_KEY = "spatial-lab.property-experience.drafts.v1";

type DraftStore = Record<string, PropertyExperienceConfig>;

function readDrafts(): DraftStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DraftStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDrafts(store: DraftStore) {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(store));
}

export function loadDraft(propertyId: string): PropertyExperienceConfig | null {
  return readDrafts()[propertyId] ?? null;
}

export function saveDraft(config: PropertyExperienceConfig): PropertyExperienceConfig {
  const next: PropertyExperienceConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  };
  const store = readDrafts();
  store[config.property.id] = next;
  writeDrafts(store);
  return next;
}

export function clearDraft(propertyId: string) {
  const store = readDrafts();
  delete store[propertyId];
  writeDrafts(store);
}

export function exportExperienceJson(config: PropertyExperienceConfig): string {
  const payload: PropertyExperienceConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function downloadExperienceJson(config: PropertyExperienceConfig, filename?: string) {
  const blob = new Blob([exportExperienceJson(config)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? `${config.property.slug}.experience.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseExperienceJson(text: string): PropertyExperienceConfig {
  const data = JSON.parse(text) as PropertyExperienceConfig;
  const issues = validateExperience(data);
  if (issues.some((i) => i.level === "error")) {
    throw new Error(issues.filter((i) => i.level === "error").map((i) => i.message).join("; "));
  }
  return data;
}

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
};

export function validateExperience(config: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!config || typeof config !== "object") {
    return [{ level: "error", message: "Config is not an object" }];
  }
  const c = config as PropertyExperienceConfig;
  if (c.schema !== PROPERTY_EXPERIENCE_SCHEMA) {
    issues.push({ level: "error", message: `Expected schema ${PROPERTY_EXPERIENCE_SCHEMA}` });
  }
  if (c.version !== PROPERTY_EXPERIENCE_VERSION) {
    issues.push({ level: "error", message: `Unsupported version ${String(c.version)}` });
  }
  if (!c.property?.id || !c.property?.slug || !c.property?.title) {
    issues.push({ level: "error", message: "property.id, slug and title are required" });
  }
  if (!Array.isArray(c.floors) || c.floors.length === 0) {
    issues.push({ level: "error", message: "At least one floor is required" });
  }
  const floorIds = new Set((c.floors ?? []).map((f) => f.id));
  for (const f of c.floors ?? []) {
    if (!f.id || !f.name) issues.push({ level: "error", message: "Each floor needs id and name" });
    if (!f.model?.entry) issues.push({ level: "error", message: `Floor ${f.id}: model.entry required` });
    if (!f.model?.localBasePath && !f.model?.remoteBaseUrl) {
      issues.push({ level: "error", message: `Floor ${f.id}: localBasePath or remoteBaseUrl required` });
    }
    if (!f.startCamera) {
      issues.push({ level: "warn", message: `Floor ${f.id}: start camera not set` });
    }
    if (!f.previewImageUrl) {
      issues.push({ level: "warn", message: `Floor ${f.id}: preview image missing` });
    }
    for (const vp of f.viewpoints ?? []) {
      if (vp.floorId !== f.id) {
        issues.push({ level: "error", message: `Viewpoint ${vp.id} floorId mismatch` });
      }
    }
  }
  for (const conn of c.connections ?? []) {
    if (!floorIds.has(conn.sourceFloorId) || !floorIds.has(conn.destFloorId)) {
      issues.push({ level: "error", message: `Connection ${conn.id}: unknown floor id` });
    }
    if (conn.sourceFloorId === conn.destFloorId) {
      issues.push({ level: "error", message: `Connection ${conn.id}: source and dest must differ` });
    }
    if (!conn.arrivalCamera?.position) {
      issues.push({ level: "error", message: `Connection ${conn.id}: arrival camera required` });
    }
  }
  if (c.visitor?.defaultFloorId && !floorIds.has(c.visitor.defaultFloorId)) {
    issues.push({ level: "error", message: "visitor.defaultFloorId not in floors" });
  }
  return issues;
}

/** Point-in-AABB test (centre + full size). */
export function pointInTrigger(
  point: [number, number, number],
  center: [number, number, number],
  size: [number, number, number],
): boolean {
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  return (
    point[0] >= center[0] - hx &&
    point[0] <= center[0] + hx &&
    point[1] >= center[1] - hy &&
    point[1] <= center[1] + hy &&
    point[2] >= center[2] - hz &&
    point[2] <= center[2] + hz
  );
}
