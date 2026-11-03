/**
 * LAB EXP-04 / 04B — furniture asset import boundary.
 *
 * Internal canonical form for staging is always:
 *   - visual: Three.js Object3D loaded from GLB (or builtin procedural)
 *   - storage: StagingAssetRef pointing at IDB GLB bytes, public URL, or builtin id
 *
 * Saved staging JSON never embeds source format (OBJ/FBX/etc.). Future importers
 * must convert → GLB blob → `putStagingGlb` / StagingAssetRef before placements
 * reference the asset.
 */

import {
  fileToStagingGlb,
  putStagingGlb,
} from "@/lib/labs/experiences/stagingStorage";
import {
  BUILTIN_CHAIR_ASSET,
  type StagingAssetRef,
} from "@/lib/labs/experiences/stagingTypes";
import { loadStagingObject, type LoadedStagingObject } from "@/lib/labs/experiences/stagingModels";
import { getStagingGlbUrl } from "@/lib/labs/experiences/stagingStorage";

/** Formats we may accept later; only glb/gltf/builtin are implemented now. */
export type StagingSourceFormat = "glb" | "gltf" | "obj" | "fbx" | "ai-glb" | "builtin";

export type StagingImportRequest =
  | { format: "builtin" }
  | { format: "glb" | "gltf"; file: File }
  /** Future: Wavefront / FBX — convert offline or client-side to GLB, then store. */
  | { format: "obj" | "fbx"; file: File }
  /**
   * Future: result from an external image→3D service.
   * Service should return an optimized GLB (metres, Y-up, reasonable poly count).
   * We only store the GLB bytes — never the prompt/image in staging JSON.
   */
  | { format: "ai-glb"; blob: Blob; fileName?: string; generatorId?: string };

export type StagingImportResult = {
  asset: StagingAssetRef;
  /** Human note for Dev UI / export assetNotes. */
  note: string;
};

/**
 * Normalize any supported source into a StagingAssetRef (canonical GLB / builtin).
 * Does not change placements — callers create placements after import.
 */
export async function importStagingAsset(req: StagingImportRequest): Promise<StagingImportResult> {
  switch (req.format) {
    case "builtin":
      return { asset: BUILTIN_CHAIR_ASSET, note: "Built-in procedural chair (metres, Y-up)." };
    case "glb":
    case "gltf": {
      const { assetId, fileName, mimeType } = await fileToStagingGlb(req.file);
      return {
        asset: { kind: "idb", assetId, fileName, mimeType },
        note: `Stored as GLB in IndexedDB (${fileName}).`,
      };
    }
    case "obj":
    case "fbx":
      throw new Error(
        `${req.format.toUpperCase()} import is not implemented yet. Convert to GLB externally, then Upload GLB.`,
      );
    case "ai-glb": {
      const fileName = req.fileName ?? `ai-${req.generatorId ?? "model"}.glb`;
      const assetId = `stg_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await putStagingGlb(assetId, req.blob);
      return {
        asset: { kind: "idb", assetId, fileName, mimeType: "model/gltf-binary" },
        note: `AI/service GLB stored in IndexedDB (${fileName}). Staging JSON references assetId only.`,
      };
    }
    default: {
      const _exhaustive: never = req;
      throw new Error(`Unknown import: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Load visual mesh + auto-fit — single entry for the host (hides loader details). */
export async function loadCanonicalStagingVisual(asset: StagingAssetRef): Promise<LoadedStagingObject> {
  return loadStagingObject(asset, getStagingGlbUrl);
}

/**
 * Later image→3D hook (not called in this lab):
 *
 * 1. Client uploads reference photo to a separate service (not Spatial Lab / not RunPod here).
 * 2. Service returns `{ glbUrl }` or binary GLB (PBR optional, metres preferred).
 * 3. `const blob = await fetch(glbUrl).then(r => r.blob())`
 * 4. `const { asset } = await importStagingAsset({ format: 'ai-glb', blob, fileName: 'gen.glb' })`
 * 5. Place as today — collision proxy is derived from the loaded mesh AABB/OBB.
 *
 * Staging export stays format-agnostic: only `assetId` + fileName hint.
 */
export const IMAGE_TO_3D_INTEGRATION_NOTE =
  "External image→3D → optimized GLB → importStagingAsset({ format: 'ai-glb', blob }) → same placement/collision path.";
