import type { ExperienceHotspot, ExperienceViewpoint } from "./types";

const KEY = "spatial-lab.experiences.overrides.v1";

export type ExperienceOverrides = {
  viewpoints: ExperienceViewpoint[];
  hotspots: ExperienceHotspot[];
  /** When set, hides matching built-in viewpoint ids. */
  hiddenViewpointIds?: string[];
};

type Store = Record<string, ExperienceOverrides>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  window.localStorage.setItem(KEY, JSON.stringify(store));
}

export function loadOverrides(propertyId: string): ExperienceOverrides {
  const row = read()[propertyId];
  return {
    viewpoints: row?.viewpoints ?? [],
    hotspots: row?.hotspots ?? [],
    hiddenViewpointIds: row?.hiddenViewpointIds ?? [],
  };
}

export function saveViewpoint(propertyId: string, vp: ExperienceViewpoint) {
  const store = read();
  const cur = store[propertyId] ?? { viewpoints: [], hotspots: [] };
  const viewpoints = [...cur.viewpoints.filter((v) => v.id !== vp.id), vp];
  const hidden = (cur.hiddenViewpointIds ?? []).filter((id) => id !== vp.id);
  store[propertyId] = { ...cur, viewpoints, hiddenViewpointIds: hidden };
  write(store);
}

export function saveHotspot(propertyId: string, hs: ExperienceHotspot) {
  const store = read();
  const cur = store[propertyId] ?? { viewpoints: [], hotspots: [] };
  const hotspots = [...cur.hotspots.filter((h) => h.id !== hs.id), hs];
  store[propertyId] = { ...cur, hotspots };
  write(store);
}

export function removeOverrideViewpoint(propertyId: string, id: string) {
  const store = read();
  const cur = store[propertyId];
  if (!cur) return;
  const wasOverride = cur.viewpoints.some((v) => v.id === id);
  const viewpoints = cur.viewpoints.filter((v) => v.id !== id);
  const hiddenViewpointIds = wasOverride
    ? cur.hiddenViewpointIds ?? []
    : [...new Set([...(cur.hiddenViewpointIds ?? []), id])];
  store[propertyId] = { ...cur, viewpoints, hiddenViewpointIds };
  write(store);
}

export function removeOverrideHotspot(propertyId: string, id: string) {
  const store = read();
  const cur = store[propertyId];
  if (!cur) return;
  store[propertyId] = { ...cur, hotspots: cur.hotspots.filter((h) => h.id !== id) };
  write(store);
}

export function replaceViewpointsOrder(propertyId: string, ordered: ExperienceViewpoint[]) {
  const store = read();
  const cur = store[propertyId] ?? { viewpoints: [], hotspots: [] };
  const withOrder = ordered.map((vp, i) => ({ ...vp, order: i }));
  // Persist all as overrides so order sticks for built-ins too
  const hidden = cur.hiddenViewpointIds ?? [];
  store[propertyId] = { ...cur, viewpoints: withOrder, hiddenViewpointIds: hidden };
  write(store);
}

export function mergeContent(
  builtIn: { viewpoints: ExperienceViewpoint[]; hotspots: ExperienceHotspot[] },
  overrides: ExperienceOverrides,
) {
  const hidden = new Set(overrides.hiddenViewpointIds ?? []);
  const vpOverrideIds = new Set(overrides.viewpoints.map((v) => v.id));
  const hsIds = new Set(overrides.hotspots.map((h) => h.id));
  // If overrides replace the full ordered set (all built-ins present as overrides), use overrides only.
  const replacesAll =
    overrides.viewpoints.length > 0 &&
    builtIn.viewpoints.every((v) => vpOverrideIds.has(v.id) || hidden.has(v.id));
  const viewpoints = replacesAll
    ? [...overrides.viewpoints]
    : [
        ...builtIn.viewpoints.filter((v) => !vpOverrideIds.has(v.id) && !hidden.has(v.id)),
        ...overrides.viewpoints,
      ];
  return {
    viewpoints: viewpoints.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    hotspots: [...builtIn.hotspots.filter((h) => !hsIds.has(h.id)), ...overrides.hotspots],
  };
}
