import {
  PROD03_SCHEMA,
  PROD03_VERSION,
  normalizeProd03Config,
  type Prod03ExperienceConfig,
} from "@/lib/labs/prod03/types";

const DRAFT_KEY = "spatial-lab.prod03.drafts.v1";

type DraftStore = Record<string, Prod03ExperienceConfig>;

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

export function loadProd03Draft(propertyId: string): Prod03ExperienceConfig | null {
  const raw = readDrafts()[propertyId];
  return raw ? normalizeProd03Config(raw) : null;
}

export function saveProd03Draft(config: Prod03ExperienceConfig): Prod03ExperienceConfig {
  const next: Prod03ExperienceConfig = {
    ...normalizeProd03Config(config),
    updatedAt: new Date().toISOString(),
  };
  const store = readDrafts();
  store[config.property.id] = next;
  writeDrafts(store);
  return next;
}

export function clearProd03Draft(propertyId: string) {
  const store = readDrafts();
  delete store[propertyId];
  writeDrafts(store);
}

export function exportProd03Json(config: Prod03ExperienceConfig): string {
  return JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2);
}

export function downloadProd03Json(config: Prod03ExperienceConfig, filename?: string) {
  const blob = new Blob([exportProd03Json(config)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? `${config.property.slug}.experience.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseProd03Json(text: string): Prod03ExperienceConfig {
  const data = JSON.parse(text) as Prod03ExperienceConfig;
  if (data.schema !== PROD03_SCHEMA) {
    throw new Error(`Expected schema ${PROD03_SCHEMA}`);
  }
  if (data.version !== PROD03_VERSION) {
    throw new Error(`Expected version ${PROD03_VERSION}`);
  }
  if (!data.property?.id || !data.model?.localPath) {
    throw new Error("Missing property.id or model.localPath");
  }
  return normalizeProd03Config(data);
}
