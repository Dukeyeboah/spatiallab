import type { FloorPlanExportBundle, FloorPlanRecord } from "./floorPlanTypes";

const META_KEY = "spatial-lab.experiences.floor-plans.v1";
const DB_NAME = "spatial-lab-experiences-floorplans";
const STORE = "images";

type MetaStore = Record<string, FloorPlanRecord[]>; // propertyId → plans

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

export async function putFloorPlanImage(assetId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getFloorPlanImageUrl(assetId: string, publicUrl?: string): Promise<string | null> {
  if (publicUrl) return publicUrl;
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

export async function deleteFloorPlanImage(assetId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function listFloorPlans(propertyId: string): FloorPlanRecord[] {
  return [...(readMeta()[propertyId] ?? [])].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.floorName.localeCompare(b.floorName));
}

export function getDefaultFloorPlan(propertyId: string): FloorPlanRecord | null {
  const list = listFloorPlans(propertyId);
  return list.find((p) => p.isDefault) ?? list[0] ?? null;
}

export function saveFloorPlanRecord(plan: FloorPlanRecord) {
  const store = readMeta();
  const list = [...(store[plan.propertyId] ?? [])];
  const i = list.findIndex((p) => p.id === plan.id);
  if (plan.isDefault) {
    for (const p of list) p.isDefault = false;
  }
  const next = { ...plan, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = next;
  else list.push(next);
  if (!list.some((p) => p.isDefault) && list.length) list[0].isDefault = true;
  store[plan.propertyId] = list;
  writeMeta(store);
}

export async function removeFloorPlan(propertyId: string, planId: string) {
  const store = readMeta();
  const list = store[propertyId] ?? [];
  const victim = list.find((p) => p.id === planId);
  store[propertyId] = list.filter((p) => p.id !== planId);
  if (store[propertyId].length && !store[propertyId].some((p) => p.isDefault)) {
    store[propertyId][0].isDefault = true;
  }
  writeMeta(store);
  if (victim && !victim.publicUrl) await deleteFloorPlanImage(victim.imageAssetId);
}

export function exportFloorPlans(propertyId: string): FloorPlanExportBundle {
  const plans = listFloorPlans(propertyId);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    propertyId,
    plans,
    imageNotes: plans.map((p) => ({
      assetId: p.imageAssetId,
      fileNameHint: `${p.floorName.replace(/\s+/g, "-").toLowerCase()}.${p.mimeType.includes("png") ? "png" : "jpg"}`,
      publicUrl: p.publicUrl,
    })),
  };
}

export function importFloorPlanMeta(bundle: FloorPlanExportBundle) {
  const store = readMeta();
  store[bundle.propertyId] = bundle.plans;
  writeMeta(store);
}

export async function fileToPlanImage(file: File): Promise<{ assetId: string; width: number; height: number; mimeType: string }> {
  const mimeType = file.type || "image/jpeg";
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mimeType) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error("Use PNG, JPEG, or WebP.");
  }
  const assetId = `fpimg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await putFloorPlanImage(assetId, file);
  const dims = await readImageSize(file);
  return { assetId, width: dims.w, height: dims.h, mimeType };
}

function readImageSize(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image dimensions."));
    };
    img.src = url;
  });
}

/** Seed a bundled public sample if the property has no plans yet. */
export function ensureSampleFloorPlan(propertyId: string, floorId: string, modelDataPath?: string) {
  if (listFloorPlans(propertyId).length) return;
  const plan: FloorPlanRecord = {
    id: `fp_sample_${propertyId}`,
    propertyId,
    floorId,
    floorName: "Ground Floor",
    imageAssetId: "public:scandinavian-apartment-sample",
    publicUrl: "/labs/experiences/floor-plans/scandinavian-apartment-sample.jpg",
    width: 0,
    height: 0,
    mimeType: "image/jpeg",
    isDefault: true,
    anchors: [],
    transform: null,
    rooms: [],
    coordSystemVersion: 1,
    modelDataPath,
    updatedAt: new Date().toISOString(),
  };
  saveFloorPlanRecord(plan);
}
