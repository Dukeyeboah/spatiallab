import type { SurfaceExportBundle, SurfaceOverlay } from "./surfaceTypes";

const META_KEY = "spatial-lab.experiences.surfaces.v1";
const DB_NAME = "spatial-lab-experiences-surfaces";
const STORE = "images";

type MetaStore = Record<string, SurfaceOverlay[]>;

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

export async function putSurfaceImage(assetId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getSurfaceImageUrl(assetId: string): Promise<string | null> {
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

export async function deleteSurfaceImage(assetId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function listSurfaceOverlays(propertyId: string): SurfaceOverlay[] {
  return [...(readMeta()[propertyId] ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function saveSurfaceOverlay(surface: SurfaceOverlay) {
  const store = readMeta();
  const list = [...(store[surface.propertyId] ?? [])];
  const i = list.findIndex((s) => s.id === surface.id);
  const next = { ...surface, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = next;
  else list.push(next);
  store[surface.propertyId] = list;
  writeMeta(store);
}

export function removeSurfaceOverlay(propertyId: string, id: string) {
  const store = readMeta();
  store[propertyId] = (store[propertyId] ?? []).filter((s) => s.id !== id);
  writeMeta(store);
}

export function replaceSurfaceOverlays(propertyId: string, surfaces: SurfaceOverlay[]) {
  const store = readMeta();
  store[propertyId] = surfaces;
  writeMeta(store);
}

export function exportSurfaces(propertyId: string): SurfaceExportBundle {
  const surfaces = listSurfaceOverlays(propertyId);
  const notes: SurfaceExportBundle["assetNotes"] = [];
  for (const s of surfaces) {
    if (s.material.kind === "texture") {
      notes.push({
        hint: "Wallpaper image in IndexedDB — re-upload if restoring on another machine.",
        assetId: s.material.assetId,
        fileName: s.material.fileName,
      });
    }
    for (const a of s.artwork) {
      notes.push({
        hint: "Artwork image in IndexedDB.",
        assetId: a.imageAssetId,
        fileName: a.fileName,
      });
    }
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    propertyId,
    surfaces,
    assetNotes: notes,
  };
}

export function importSurfaceMeta(bundle: SurfaceExportBundle) {
  replaceSurfaceOverlays(bundle.propertyId, bundle.surfaces);
}

export async function fileToSurfaceImage(
  file: File,
): Promise<{ assetId: string; fileName: string; mimeType: string }> {
  const name = file.name || "texture.png";
  if (!/\.(png|jpe?g|webp|gif)$/i.test(name) && !/^image\//i.test(file.type)) {
    throw new Error("Use a PNG, JPEG, WebP, or GIF image.");
  }
  const assetId = `surfimg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await putSurfaceImage(assetId, file);
  return { assetId, fileName: name, mimeType: file.type || "image/png" };
}
