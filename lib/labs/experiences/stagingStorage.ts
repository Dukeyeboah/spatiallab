import type { StagingExportBundle, StagingPlacement } from "./stagingTypes";

const META_KEY = "spatial-lab.experiences.staging.v1";
const DB_NAME = "spatial-lab-experiences-staging";
const STORE = "glb";

type MetaStore = Record<string, StagingPlacement[]>;

function readMeta(): MetaStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MetaStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(store: MetaStore) {
  window.localStorage.setItem(META_KEY, JSON.stringify(store));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putStagingGlb(assetId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getStagingGlbUrl(assetId: string): Promise<string | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(assetId);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

export async function deleteStagingGlb(assetId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function listStagingPlacements(propertyId: string): StagingPlacement[] {
  return [...(readMeta()[propertyId] ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveStagingPlacement(placement: StagingPlacement) {
  const store = readMeta();
  const list = [...(store[placement.propertyId] ?? [])];
  const i = list.findIndex((p) => p.id === placement.id);
  const next = { ...placement, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = next;
  else list.push(next);
  store[placement.propertyId] = list;
  writeMeta(store);
}

export function removeStagingPlacement(propertyId: string, id: string) {
  const store = readMeta();
  store[propertyId] = (store[propertyId] ?? []).filter((p) => p.id !== id);
  writeMeta(store);
}

export function replaceStagingPlacements(propertyId: string, placements: StagingPlacement[]) {
  const store = readMeta();
  store[propertyId] = placements;
  writeMeta(store);
}

export function exportStaging(propertyId: string): StagingExportBundle {
  const placements = listStagingPlacements(propertyId);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    propertyId,
    placements,
    assetNotes: placements.map((p) => {
      if (p.asset.kind === "builtin") {
        return { hint: "Built-in procedural chair — no file restore needed.", builtinId: p.asset.builtinId };
      }
      if (p.asset.kind === "public") {
        return {
          hint: `Public URL asset — ensure ${p.asset.publicUrl} is present.`,
          publicUrl: p.asset.publicUrl,
          fileName: p.asset.fileName,
        };
      }
      return {
        hint: "GLB was stored in IndexedDB. Re-upload the same file and update assetId, or embed separately.",
        assetId: p.asset.assetId,
        fileName: p.asset.fileName,
      };
    }),
  };
}

export function importStagingMeta(bundle: StagingExportBundle) {
  replaceStagingPlacements(bundle.propertyId, bundle.placements);
}

export async function fileToStagingGlb(file: File): Promise<{ assetId: string; fileName: string; mimeType: string }> {
  const name = file.name || "model.glb";
  if (!/\.(glb|gltf)$/i.test(name) && !/model\/(gltf|gltf-binary)/i.test(file.type)) {
    throw new Error("Use a .glb or .gltf file.");
  }
  const assetId = `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await putStagingGlb(assetId, file);
  return { assetId, fileName: name, mimeType: file.type || "model/gltf-binary" };
}
