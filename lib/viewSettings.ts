/**
 * "standard" = three.js pointsMaterial.
 * "shader"   = our own minimal vertex + fragment shaders (shaders/).
 */
export type RenderMode = "standard" | "shader";

/**
 * Variations of the Shader Points mode (see components/ShaderPointsMaterial.tsx).
 * "rgb" is the unchanged baseline.
 */
export type ShaderExperiment =
  | "rgb"
  | "height"
  | "depthSize"
  | "circle"
  | "softCircle"
  | "gaussian"
  | "ellipticalGaussian";

/** Experiments that output alpha < 1 and therefore need transparent blending. */
export const TRANSPARENT_EXPERIMENTS: ShaderExperiment[] = [
  "softCircle",
  "gaussian",
  "ellipticalGaussian",
];

/**
 * Parameters for the Soft Circle, Gaussian Point and Elliptical Gaussian experiments.
 * Radii and sigmas are in gl_PointCoord units: the point's square is 1.0 wide.
 */
export type SoftPointSettings = {
  /** Soft Circle: fully opaque inside this radius. */
  innerRadius: number;
  /** Soft Circle: fully transparent beyond this radius. */
  outerRadius: number;
  /** Gaussian Point: width of the bell curve. */
  sigma: number;
  /** Gaussian Point: multiplies the alpha of every point. */
  opacity: number;
  /** Elliptical Gaussian: spread along the ellipse's own X axis. */
  sigmaX: number;
  /** Elliptical Gaussian: spread along the ellipse's own Y axis. */
  sigmaY: number;
  /** Elliptical Gaussian: ellipse orientation, degrees, counter-clockwise on screen. */
  rotationDegrees: number;
  /** Whether transparent points write to the depth buffer (see ShaderPointsMaterial). */
  depthWrite: boolean;
};

export const defaultSoftPointSettings: SoftPointSettings = {
  innerRadius: 0.2,
  outerRadius: 0.5,
  sigma: 0.2,
  opacity: 1.0,
  sigmaX: 0.2,
  sigmaY: 0.08,
  rotationDegrees: 0,
  depthWrite: false,
};

/** Which parameters belong to which experiment (used by Reset Experiment). */
export const EXPERIMENT_PARAMETERS: Partial<
  Record<ShaderExperiment, (keyof SoftPointSettings)[]>
> = {
  softCircle: ["innerRadius", "outerRadius"],
  gaussian: ["sigma", "opacity"],
  ellipticalGaussian: ["sigmaX", "sigmaY", "rotationDegrees"],
};

/**
 * Everything the control panel can change.
 * New toggles (intensity, trajectory, clipping, ...) can be added here later.
 */
export type ViewSettings = {
  renderMode: RenderMode;
  /** Only used when renderMode is "shader". */
  shaderExperiment: ShaderExperiment;
  softPoints: SoftPointSettings;
  /** Point size in screen pixels. */
  pointSize: number;
  /** true = scanner RGB colours, false = a single flat colour. */
  showRgb: boolean;
  showAxes: boolean;
  showGrid: boolean;
  /** Line through the scanner poses. */
  showPath: boolean;
  /** A small marker at each pose. */
  showPoses: boolean;
  /** Scanner marker at the selected pose. */
  showMarker: boolean;
};

/**
 * Fill in any missing fields from the defaults.
 * During development, Fast Refresh keeps the old settings object in React
 * state when new settings are added to the code; without this, reading a
 * new field (e.g. softPoints.sigmaX) would give undefined until a reload.
 */
export function withDefaults(settings: ViewSettings): ViewSettings {
  return {
    ...defaultViewSettings,
    ...settings,
    softPoints: { ...defaultSoftPointSettings, ...settings.softPoints },
  };
}

export const defaultViewSettings: ViewSettings = {
  renderMode: "standard",
  shaderExperiment: "rgb",
  softPoints: defaultSoftPointSettings,
  pointSize: 2,
  showRgb: true,
  showAxes: true,
  showGrid: true,
  showPath: true,
  showPoses: true,
  showMarker: true,
};
