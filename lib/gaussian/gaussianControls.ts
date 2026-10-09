import * as THREE from "three";
import type { Gaussian3D } from "./gaussianMath";

/**
 * What the sliders edit. Rotation is stored as Euler angles (degrees) because
 * they are easy to drag; toGaussian3D() turns them into the quaternion that
 * the Gaussian data model actually uses.
 */
export type GaussianControlsState = {
  position: [number, number, number];
  scale: [number, number, number];
  rotationDegrees: [number, number, number];
  opacity: number;
  /** Quad half-size in standard deviations (3 covers ~99% of the Gaussian's 2D mass). */
  supportSigmas: number;
  showOutline: boolean;
  showEllipsoid: boolean;
};

export const defaultGaussianControls: GaussianControlsState = {
  position: [0, 0, 0],
  scale: [0.6, 0.2, 0.2],
  rotationDegrees: [0, 0, 30],
  opacity: 0.9,
  supportSigmas: 3,
  showOutline: true,
  showEllipsoid: true,
};

/** A fixed colour; this lab is about shape, not colour. Linear RGB. */
const GAUSSIAN_COLOR = new THREE.Color(1.0, 0.55, 0.15);

export function toGaussian3D(state: GaussianControlsState): Gaussian3D {
  const [rx, ry, rz] = state.rotationDegrees.map(THREE.MathUtils.degToRad);
  return {
    position: new THREE.Vector3(...state.position),
    scale: new THREE.Vector3(...state.scale),
    // Euler (XYZ order) -> quaternion. Quaternions avoid gimbal lock and are
    // what Gaussian splatting files store.
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ")),
    color: GAUSSIAN_COLOR,
    opacity: state.opacity,
  };
}
