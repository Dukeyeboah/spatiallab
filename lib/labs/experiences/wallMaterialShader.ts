import * as THREE from "three";
import type { WallBlendMode, WallFinishSettingsV1 } from "./wallMaterialTypes";
import type { SurfaceRenderPreset } from "./surfaceOcclusion";

/**
 * Single-pass unlit layered wall finish (EXP-05E).
 * Procedural grain / wash / plaster live in the fragment shader — no stacked
 * transparent planes. Blend modes composite **material layers only**, not LCC.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3 uBaseColor;
uniform float uOpacity;
uniform float uSeed;
uniform float uGrain;
uniform float uColorVar;
uniform float uTexStrength;
uniform float uBrightness;
uniform float uContrast;
uniform float uWarmCool;
uniform float uVGrad;
uniform float uRoughness;
uniform int uBlendMode;
uniform int uHasMap;
uniform sampler2D uMap;
uniform vec2 uMapRepeat;
uniform vec2 uMapOffset;
uniform float uMapRotation;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.017);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * valueNoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

vec3 applyBlend(vec3 base, vec3 blend, float t, int mode) {
  vec3 r;
  if (mode == 1) {
    // multiply
    r = base * blend;
  } else if (mode == 2) {
    // overlay
    r = mix(
      2.0 * base * blend,
      1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
      step(0.5, base)
    );
  } else if (mode == 3) {
    // soft light (simplified Pegtop)
    r = (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
  } else {
    // normal mix
    r = blend;
  }
  return mix(base, r, clamp(t, 0.0, 1.0));
}

vec2 rotateUv(vec2 uv, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  uv -= 0.5;
  return vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
}

void main() {
  vec3 col = uBaseColor;

  // Low-frequency wash (limewash / plaster blotch) — seeded
  float blotch = fbm(vUv * 3.5 + uSeed * 0.11);
  vec3 wash = mix(col * 0.92, col * 1.08, blotch);
  col = mix(col, wash, uColorVar);

  // Fine grain
  float g = hash21(vUv * 900.0 + uSeed);
  col *= 1.0 + (g - 0.5) * uGrain * 0.35;

  // Fine plaster: medium-frequency mineral texture as luminance layer
  float plaster = fbm(vUv * 28.0 + 17.0);
  vec3 plasterCol = vec3(mix(0.88, 1.06, plaster));
  col = applyBlend(col, plasterCol, uTexStrength * 0.65, uBlendMode);

  // Optional wallpaper / uploaded map (material layers only)
  if (uHasMap == 1) {
    vec2 muv = rotateUv(vUv, uMapRotation);
    muv = muv * uMapRepeat + uMapOffset;
    vec3 mapCol = texture2D(uMap, muv).rgb;
    col = applyBlend(col, mapCol, uTexStrength, uBlendMode);
  }

  // Vertical brightness gradient (top slightly softer by default)
  float vg = mix(1.0 + uVGrad * 0.12, 1.0 - uVGrad * 0.18, vUv.y);
  col *= vg;

  // Warm / cool balance
  col.r += uWarmCool * 0.04;
  col.b -= uWarmCool * 0.04;

  // Brightness + contrast
  col *= uBrightness;
  col = (col - 0.5) * uContrast + 0.5;

  // Roughness cue: slight desat + flatten highlights (unlit approximation)
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma), uRoughness * 0.12);

  // Tiny directional cue from world normal (not scene lights)
  float ndl = 0.92 + 0.08 * clamp(dot(normalize(vWorldNormal), normalize(vec3(0.25, 0.85, 0.2))), 0.0, 1.0);
  col *= ndl;

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, uOpacity);
}
`;

function blendModeInt(mode: WallBlendMode): number {
  switch (mode) {
    case "multiply":
      return 1;
    case "overlay":
      return 2;
    case "softLight":
      return 3;
    default:
      return 0;
  }
}

function hexToColor(hex: string): THREE.Color {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color("#d8d2c8");
  }
}

export function createWallFinishMaterial(
  finish: WallFinishSettingsV1,
  map: THREE.Texture | null,
  mapTransform: { repeatU: number; repeatV: number; offsetU: number; offsetV: number; rotation: number } | null,
  renderPreset: SurfaceRenderPreset,
  doubleSide: boolean,
): THREE.ShaderMaterial {
  const opaque = renderPreset === "opaque" || finish.opacity >= 0.999;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBaseColor: { value: hexToColor(finish.baseColor) },
      uOpacity: { value: renderPreset === "opaque" ? 1 : finish.opacity },
      uSeed: { value: finish.seed },
      uGrain: { value: finish.grainStrength },
      uColorVar: { value: finish.colorVariation },
      uTexStrength: { value: finish.textureStrength },
      uBrightness: { value: finish.brightness },
      uContrast: { value: finish.contrast },
      uWarmCool: { value: finish.warmCool },
      uVGrad: { value: finish.verticalGradient },
      uRoughness: { value: finish.roughness },
      uBlendMode: { value: blendModeInt(finish.blendMode) },
      uHasMap: { value: map ? 1 : 0 },
      uMap: { value: map },
      uMapRepeat: {
        value: new THREE.Vector2(mapTransform?.repeatU ?? 1, mapTransform?.repeatV ?? 1),
      },
      uMapOffset: {
        value: new THREE.Vector2(mapTransform?.offsetU ?? 0, mapTransform?.offsetV ?? 0),
      },
      uMapRotation: { value: mapTransform?.rotation ?? 0 },
    },
    transparent: !opaque,
    depthTest: renderPreset !== "alwaysFront",
    depthWrite: renderPreset !== "alwaysFront" && renderPreset !== "noDepthWrite",
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  if (renderPreset === "alwaysFront") {
    mat.depthTest = false;
    mat.depthWrite = false;
  }
  if (renderPreset === "noDepthWrite") {
    mat.depthWrite = false;
  }

  return mat;
}
