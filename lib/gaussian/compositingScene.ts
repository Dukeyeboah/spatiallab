import * as THREE from "three";

/**
 * Lab 7B scenes: small synthetic collections of 3D Gaussians for teaching
 * compositing. Not LiDAR data and not a trained splat: positions, sizes and
 * colours are chosen by hand (3 Gaussians) or by a seeded random generator
 * (100 / 500 / 1,000), so every visit shows the same scene.
 *
 * World frame: three.js, Y-up, metres. The camera starts at (0, 0, 6) looking
 * down -Z, so larger Z is nearer the camera.
 */

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

export type SceneGaussian = {
  name: string;
  /** 0 = front (red), 1 = middle (green), 2 = back (blue). */
  layer: number;
  position: Vec3;
  /** 1-sigma extent along the Gaussian's own axes (metres). */
  scale: Vec3;
  /** Unit quaternion [x, y, z, w]. */
  rotation: Quat;
  /** Linear RGB 0..1. */
  color: Vec3;
  /** Peak opacity at the centre. */
  opacity: number;
  /** Per-Gaussian offset (radians) so the Dreamscape preset doesn't move in lockstep. */
  phase: number;
};

export const GAUSSIAN_COUNTS = [3, 100, 500, 1000] as const;
export type GaussianCount = (typeof GAUSSIAN_COUNTS)[number];

/** Three clearly separated depth layers, each with its own colour family. */
export const LAYERS = [
  { name: "front", z: 1, color: [0.95, 0.2, 0.15] as Vec3 },
  { name: "middle", z: 0, color: [0.2, 0.85, 0.3] as Vec3 },
  { name: "back", z: -1, color: [0.2, 0.4, 1.0] as Vec3 },
];

export function createScene(count: GaussianCount): SceneGaussian[] {
  return count === 3 ? threeLayerScene() : randomLayeredScene(count);
}

/**
 * The teaching scene: one Gaussian per layer, offset so that all three cover
 * the screen centre (the probe pixel) from the starting camera, while each
 * also has a region of its own.
 */
function threeLayerScene(): SceneGaussian[] {
  const make = (
    layer: number,
    position: Vec3,
    scale: Vec3,
    rotationZDegrees: number,
    phase: number,
  ): SceneGaussian => ({
    name: `${["Red", "Green", "Blue"][layer]} (${LAYERS[layer].name})`,
    layer,
    position,
    scale,
    rotation: quaternionFromEulerDegrees(0, 0, rotationZDegrees),
    color: LAYERS[layer].color,
    opacity: 0.8,
    phase,
  });
  return [
    make(0, [-0.45, 0.25, LAYERS[0].z], [0.75, 0.45, 0.3], 20, 0),
    make(1, [0.35, -0.25, LAYERS[1].z], [0.6, 0.6, 0.3], 0, 2.1),
    make(2, [0.1, 0.4, LAYERS[2].z], [1.0, 0.5, 0.3], -30, 4.2),
  ];
}

/** `count` Gaussians spread over the three layers, sized so each layer is roughly covered. */
function randomLayeredScene(count: number): SceneGaussian[] {
  const random = mulberry32(count);
  // Footprint area per Gaussian ~ (area per layer) / (Gaussians per layer).
  const baseSigma = Math.sqrt(4.4 / count);
  const gaussians: SceneGaussian[] = [];
  for (let i = 0; i < count; i++) {
    const layer = i % 3;
    const jitter = () => 0.85 + 0.3 * random();
    const base = LAYERS[layer].color;
    gaussians.push({
      name: `#${i} (${LAYERS[layer].name})`,
      layer,
      position: [
        (random() - 0.5) * 4.4,
        (random() - 0.5) * 2.8,
        LAYERS[layer].z + (random() - 0.5) * 0.3,
      ],
      scale: [
        baseSigma * (0.6 + random()),
        baseSigma * (0.6 + random()),
        baseSigma * 0.5,
      ],
      rotation: randomQuaternion(random),
      color: [Math.min(1, base[0] * jitter()), Math.min(1, base[1] * jitter()), Math.min(1, base[2] * jitter())],
      opacity: 0.55 + 0.35 * random(),
      phase: random() * Math.PI * 2,
    });
  }
  return gaussians;
}

// ---------------------------------------------------------------------------
// Animation presets
// ---------------------------------------------------------------------------

export const ANIMATION_PRESETS = ["none", "breathing", "wave", "dreamscape"] as const;
export type AnimationPreset = (typeof ANIMATION_PRESETS)[number];

/** The values actually drawn this frame (base Gaussian + animation + global sliders). */
export type AnimatedGaussian = {
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  qx: number; qy: number; qz: number; qw: number;
  opacity: number;
};

export function newAnimatedGaussian(): AnimatedGaussian {
  return { px: 0, py: 0, pz: 0, sx: 1, sy: 1, sz: 1, qx: 0, qy: 0, qz: 0, qw: 1, opacity: 1 };
}

/**
 * Breathing:  every scale times 1 + 0.3 sin(2 pi * 0.25 t)   (one breath per 4 s)
 * Wave:       y += 0.25 sin(2 x - 2 pi * 0.3 t)              (a ripple travelling along +X)
 * Dreamscape: small rotations about the Gaussian's own Z and X axes, scale
 *             times 1 +- 0.12, opacity times 0.7..1, each with its own phase.
 *
 * `t` is animation time in seconds (already multiplied by the speed slider).
 * Global scale and opacity apply after the preset. Colour is never animated.
 */
export function animateGaussian(
  g: SceneGaussian,
  preset: AnimationPreset,
  t: number,
  globalScale: number,
  globalOpacity: number,
  out: AnimatedGaussian,
): AnimatedGaussian {
  let [px, py, pz] = g.position;
  let scaleFactor = 1;
  let opacityFactor = 1;
  let [qx, qy, qz, qw] = g.rotation;

  if (preset === "breathing") {
    scaleFactor = 1 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t);
  } else if (preset === "wave") {
    py += 0.25 * Math.sin(2 * px - 2 * Math.PI * 0.3 * t);
  } else if (preset === "dreamscape") {
    const spin = 0.5 * Math.sin(0.4 * t + g.phase);
    const tilt = 0.25 * Math.sin(0.3 * t + 1.7 * g.phase);
    // q * qZ(spin) * qX(tilt): rotations about the Gaussian's own axes.
    [qx, qy, qz, qw] = multiplyQuaternions([qx, qy, qz, qw], [0, 0, Math.sin(spin / 2), Math.cos(spin / 2)]);
    [qx, qy, qz, qw] = multiplyQuaternions([qx, qy, qz, qw], [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)]);
    scaleFactor = 1 + 0.12 * Math.sin(0.5 * t + g.phase);
    opacityFactor = 0.85 + 0.15 * Math.sin(0.45 * t + 2 * g.phase);
  }

  const s = scaleFactor * globalScale;
  out.px = px; out.py = py; out.pz = pz;
  out.sx = g.scale[0] * s; out.sy = g.scale[1] * s; out.sz = g.scale[2] * s;
  out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
  out.opacity = Math.min(1, g.opacity * opacityFactor * globalOpacity);
  return out;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function quaternionFromEulerDegrees(x: number, y: number, z: number): Quat {
  const d = THREE.MathUtils.degToRad;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(d(x), d(y), d(z), "XYZ"));
  return [q.x, q.y, q.z, q.w];
}

/** Hamilton product a * b (apply b first, then a). */
function multiplyQuaternions(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Uniformly distributed random rotation (Shoemake's method). */
function randomQuaternion(random: () => number): Quat {
  const u1 = random(), u2 = random() * 2 * Math.PI, u3 = random() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/** Tiny seeded PRNG: the same seed always gives the same scene. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
