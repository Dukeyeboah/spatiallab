import * as THREE from "three";
import { surfaceLocalMatrix } from "./surfaceGeometry";
import type { SurfaceRenderPreset } from "./surfaceOcclusion";
import type { SurfaceArtwork, SurfaceExcludeRect, SurfaceOverlay } from "./surfaceTypes";
import { createWallFinishMaterial } from "./wallMaterialShader";
import { normalizeWallFinish, presetFinishDefaults } from "./wallMaterialTypes";

export type SurfaceTextureResolver = (assetId: string) => Promise<THREE.Texture | null>;

const loader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;

/**
 * Build (or rebuild) a Three.js group for one surface overlay + artwork.
 * polygonOffset + slight normal offset fight z-fighting with Gaussians.
 *
 * EXP-05D: `thinBox` keeps the front face at local z=0 (same as plane) and
 * extends thickness into the wall (−Z). Optional excludeRects punch holes so
 * protruding décor stays visible.
 */
export async function buildSurfaceGroup(
  surface: SurfaceOverlay,
  resolveTexture: SurfaceTextureResolver,
  renderPreset: SurfaceRenderPreset = "default",
): Promise<THREE.Group> {
  const root = new THREE.Group();
  root.name = `surface-${surface.id}`;
  root.userData.surfaceId = surface.id;
  root.visible = surface.visible !== false;

  const showBase = surface.showBase !== false;
  if (showBase) {
    const mat = await makeWallMaterial(surface, resolveTexture, renderPreset);
    const mesh = new THREE.Mesh(buildShellGeometry(surface), mat);
    mesh.userData.surfaceId = surface.id;
    mesh.userData.surfacePick = true;
    mesh.userData.surfaceBase = true;
    mesh.renderOrder = renderPreset === "alwaysFront" ? 10 : 2;
    root.add(mesh);
  } else {
    const pickMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      colorWrite: false,
    });
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(surface.width, surface.height), pickMat);
    pick.userData.surfaceId = surface.id;
    pick.userData.surfacePick = true;
    pick.userData.surfaceBase = false;
    pick.renderOrder = 1;
    root.add(pick);
  }

  for (const art of surface.artwork) {
    const artGroup = await buildArtworkGroup(art, resolveTexture);
    if (artGroup) root.add(artGroup);
  }

  root.matrixAutoUpdate = false;
  root.matrix.copy(surfaceLocalMatrix(surface));
  root.matrixWorldNeedsUpdate = true;
  return root;
}

/** Front face at z=0; thin box occupies z ∈ [−thickness, 0]. */
export function buildShellGeometry(surface: SurfaceOverlay): THREE.BufferGeometry {
  const shape = makePanelShape(surface.width, surface.height, surface.excludeRects ?? []);
  const mode = surface.shellMode ?? "plane";
  if (mode === "thinBox") {
    const thickness = clampThickness(surface.shellThickness ?? 0.02);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      // Enough segments that holes stay clean
      curveSegments: 1,
    });
    // Extrude spans z=0..depth; shift so front (room) face stays at z=0
    geo.translate(0, 0, -thickness);
    return geo;
  }
  return new THREE.ShapeGeometry(shape);
}

function clampThickness(t: number): number {
  if (!Number.isFinite(t)) return 0.02;
  return Math.min(0.05, Math.max(0.008, t));
}

function makePanelShape(width: number, height: number, holes: SurfaceExcludeRect[]): THREE.Shape {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.lineTo(-hw, -hh);

  for (const r of holes) {
    const w = Math.max(0.02, r.width);
    const h = Math.max(0.02, r.height);
    const x0 = r.u - w * 0.5;
    const x1 = r.u + w * 0.5;
    const y0 = r.v - h * 0.5;
    const y1 = r.v + h * 0.5;
    // Keep hole inside panel with a tiny margin
    const ix0 = Math.max(-hw + 0.01, Math.min(hw - 0.01, x0));
    const ix1 = Math.max(-hw + 0.01, Math.min(hw - 0.01, x1));
    const iy0 = Math.max(-hh + 0.01, Math.min(hh - 0.01, y0));
    const iy1 = Math.max(-hh + 0.01, Math.min(hh - 0.01, y1));
    if (ix1 - ix0 < 0.02 || iy1 - iy0 < 0.02) continue;
    const hole = new THREE.Path();
    // CW hole (Three.js convention opposite to outer shape)
    hole.moveTo(ix0, iy0);
    hole.lineTo(ix0, iy1);
    hole.lineTo(ix1, iy1);
    hole.lineTo(ix1, iy0);
    hole.lineTo(ix0, iy0);
    shape.holes.push(hole);
  }
  return shape;
}

async function makeWallMaterial(
  surface: SurfaceOverlay,
  resolveTexture: SurfaceTextureResolver,
  renderPreset: SurfaceRenderPreset,
): Promise<THREE.ShaderMaterial> {
  const m = surface.material;
  const finish = normalizeWallFinish(
    surface.finish ??
      presetFinishDefaults(
        m.kind === "texture" ? "wallpaper" : "mattePaint",
        m.color,
        // Stable seed from surface id
        hashSeed(surface.id),
      ),
    m.color,
  );
  // Keep opacity / base color in sync with legacy material fields when editing color
  finish.baseColor = m.color || finish.baseColor;
  finish.opacity = m.opacity;

  let map: THREE.Texture | null = null;
  let mapTransform: {
    repeatU: number;
    repeatV: number;
    offsetU: number;
    offsetV: number;
    rotation: number;
  } | null = null;
  if (m.kind === "texture") {
    map = await resolveTexture(m.assetId);
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
      mapTransform = { ...m.mapping };
    }
  }

  const thin = (surface.shellMode ?? "plane") === "thinBox";
  return createWallFinishMaterial(finish, map, mapTransform, renderPreset, thin);
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 100000);
}

async function buildArtworkGroup(
  art: SurfaceArtwork,
  resolveTexture: SurfaceTextureResolver,
): Promise<THREE.Group | null> {
  const tex = await resolveTexture(art.imageAssetId);
  if (!tex) return null;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const g = new THREE.Group();
  g.userData.artworkId = art.id;

  const imgMat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const img = new THREE.Mesh(new THREE.PlaneGeometry(art.width, art.height), imgMat);
  img.position.z = 0.004 + art.frameDepth * 0.5;
  img.renderOrder = 3;
  g.add(img);

  if (art.frameBorder > 0.001 || art.frameDepth > 0.001) {
    const fw = art.width + art.frameBorder * 2;
    const fh = art.height + art.frameBorder * 2;
    const depth = Math.max(0.008, art.frameDepth);
    const frameMat = new THREE.MeshBasicMaterial({
      color: art.frameColor || "#2a2118",
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, depth), frameMat);
    frame.position.z = depth * 0.5;
    frame.renderOrder = 2;
    g.add(frame);
    img.position.z = depth + 0.002;
  }

  g.position.set(art.u, art.v, 0);
  g.rotation.z = art.rotation;
  return g;
}

/** Dispose geometries/materials/textures owned by a surface group. */
export function disposeSurfaceGroup(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const material of mats) {
      if (!material) continue;
      const sm = material as THREE.ShaderMaterial;
      if (sm.isShaderMaterial) {
        const map = sm.uniforms?.uMap?.value as THREE.Texture | undefined;
        map?.dispose();
        sm.dispose();
        continue;
      }
      const bm = material as THREE.MeshBasicMaterial;
      bm.map?.dispose();
      bm.dispose();
    }
  });
}

/** Load a texture from an object URL (caller owns revoke). */
export function loadTextureFromUrl(url: string): Promise<THREE.Texture | null> {
  if (!loader) return Promise.resolve(null);
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => resolve(t),
      undefined,
      () => resolve(null),
    );
  });
}
