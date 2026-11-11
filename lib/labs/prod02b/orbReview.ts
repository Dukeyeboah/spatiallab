import * as THREE from "three";
/** Opt-in review instrumentation only; no visitor controls or extra animation loop. */
export function installOrbReview(options: {
  renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera;
  controller: { enabled: boolean; body: THREE.Vector3; getDebugSnapshot(): unknown; setPose(eye: THREE.Vector3, target: THREE.Vector3): void };
  visible(value: boolean): void; quality(): unknown;
}) {
  const enabled = new URLSearchParams(location.search).get("orbReview") === "1";
  const samples = new Float32Array(240), cpu = new Float32Array(240);
  let cursor = 0, count = 0, publishedAt=0, seated=false;
  const params=new URLSearchParams(location.search);
  const readTuple=(key:string)=>{try{const v=JSON.parse(params.get(key)??"null");return Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==="number"&&Number.isFinite(n))?v as number[]:null}catch{return null}};
  const eye=readTuple("reviewEye"), targetPose=readTuple("reviewTarget");
  const telemetry=enabled?document.createElement("script"):null;
  if(telemetry){telemetry.type="application/json";telemetry.id="orb-review-telemetry";document.body.append(telemetry);options.visible(params.get("reviewAvatar")!=="off");}
  const api = {
    snapshot() {
      const sorted = Array.from(samples.subarray(0,count)).sort((a,b)=>a-b);
      const mean = sorted.reduce((a,b)=>a+b,0)/Math.max(1,count);
      return { fps: mean ? 1000/mean : 0, p95Ms: sorted[Math.max(0,Math.ceil(count*.95)-1)] ?? 0,
        cpuMs: Array.from(cpu.subarray(0,count)).reduce((a,b)=>a+b,0)/Math.max(1,count),
        quality: options.quality(), viewport: options.renderer.getSize(new THREE.Vector2()).toArray(), dpr: options.renderer.getPixelRatio(),
        draws: options.renderer.info.render.calls, triangles: options.renderer.info.render.triangles,
        geometries: options.renderer.info.memory.geometries, textures: options.renderer.info.memory.textures,
        heapMB: (performance as Performance & {memory?:{usedJSHeapSize:number}}).memory?.usedJSHeapSize! / 1048576 || null,
        camera: {position:options.camera.position.toArray(), quaternion:options.camera.quaternion.toArray(),fov:options.camera.fov}, controller: options.controller.getDebugSnapshot() };
    },
    setAvatarVisible(value: boolean) { options.visible(value); count=0;cursor=0; },
    setPose(eye:number[], target:number[]) { options.controller.setPose(new THREE.Vector3(...eye),new THREE.Vector3(...target)); count=0;cursor=0; },
  };
  const target = window as Window & {__spatialOrbReview?: typeof api};
  if(enabled) target.__spatialOrbReview=api;
  return { frame(ms:number, cpuMs:number) { if(!enabled)return;
      if(!seated&&options.controller.enabled&&eye&&targetPose){options.controller.setPose(new THREE.Vector3(...eye),new THREE.Vector3(...targetPose));seated=true;count=0;cursor=0;}
      samples[cursor]=ms;cpu[cursor]=cpuMs;cursor=(cursor+1)%240;count=Math.min(count+1,240);
      if(telemetry&&performance.now()-publishedAt>1000){telemetry.textContent=JSON.stringify(api.snapshot());publishedAt=performance.now();}
    },
    dispose() { telemetry?.remove(); if(target.__spatialOrbReview===api)delete target.__spatialOrbReview; } };
}
