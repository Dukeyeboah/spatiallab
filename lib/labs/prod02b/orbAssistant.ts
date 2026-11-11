import * as THREE from "three";

/** Local visual motion only. Navigation belongs to the existing invisible controller. */
export class OrbAssistantMotion {
  private visual: THREE.Object3D;
  private left: THREE.Object3D;
  private right: THREE.Object3D;
  private restY: number;
  private elapsed = 0;
  private movement = 0;
  private bank = 0;
  constructor(model: THREE.Object3D) {
    const visual = model.getObjectByName("VisualRoot"),
      left = model.getObjectByName("FinPivot_L"),
      right = model.getObjectByName("FinPivot_R");
    if (!visual || !left || !right)
      throw new Error("Orb Assistant is missing its visual root or fin pivots");
    this.visual = visual;
    this.left = left;
    this.right = right;
    this.restY = visual.position.y;
  }
  update(dt: number, speed: number, yawRate: number, previewMoving = false) {
    this.elapsed += Math.min(Math.max(dt, 0), 0.05);
    this.movement = THREE.MathUtils.damp(
      this.movement,
      previewMoving ? 0.65 : Math.min(1, speed / 1.25),
      6,
      dt,
    );
    this.bank = THREE.MathUtils.damp(
      this.bank,
      THREE.MathUtils.clamp(-yawRate * 0.025, -0.065, 0.065),
      7,
      dt,
    );
    const t = this.elapsed,
      amplitude = 0.035 + 0.105 * this.movement;
    this.visual.position.y =
      this.restY + 0.015 * Math.sin((t * 2 * Math.PI) / 2.5);
    this.visual.rotation.set(
      0.055 * this.movement,
      this.movement < 0.1 ? 0.025 * Math.sin(t * 1.1) : 0,
      this.bank,
    );
    this.left.rotation.z = amplitude * Math.sin(t * 2 * Math.PI * 1.2);
    this.right.rotation.z = -amplitude * Math.sin(t * 2 * Math.PI * 1.2 + 0.45);
  }
}

/** One procedural plane. No spotlight, image textures, bloom pass, or GLB ground geometry. */
export function createOrbFloorGlow() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color("#42eaf2") },
      uOpacity: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv;uniform vec3 uColor;uniform float uOpacity;
      void main(){float r=length((vUv-0.5)*2.0);
        float disc=exp(-r*r*6.0)*0.13;
        float ring=exp(-pow((r-0.48)/0.045,2.0))*0.40;
        float edge=1.0-smoothstep(0.85,1.0,r);
        gl_FragColor=vec4(uColor,(disc+ring)*edge*uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), material);
  glow.name = "OrbGroundProjection";
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 2;
  return glow;
}
