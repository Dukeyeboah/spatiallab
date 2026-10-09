"use client";

type GaussianShapePanelProps = {
  sigmaX: number;
  sigmaY: number;
  rotationDegrees: number;
};

/**
 * Learning panel for the Elliptical Gaussian experiment: shows the current
 * shape and the 2x2 covariance matrix that describes the same shape.
 */
export function GaussianShapePanel({ sigmaX, sigmaY, rotationDegrees }: GaussianShapePanelProps) {
  const isCircular = sigmaX === sigmaY;

  // Covariance Sigma = R * diag(sigmaX^2, sigmaY^2) * R^T, written out:
  //   [ c²·sx² + s²·sy²     c·s·(sx² − sy²) ]
  //   [ c·s·(sx² − sy²)     s²·sx² + c²·sy² ]
  const angle = (rotationDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const sx2 = sigmaX * sigmaX;
  const sy2 = sigmaY * sigmaY;
  const covXX = c * c * sx2 + s * s * sy2;
  const covYY = s * s * sx2 + c * c * sy2;
  const covXY = c * s * (sx2 - sy2);

  const f = (value: number) => value.toFixed(4);

  return (
    <div className="gaussian-shape">
      <div className="gaussian-shape-title">Gaussian Shape</div>
      <div>
        σx {sigmaX.toFixed(2)} · σy {sigmaY.toFixed(2)} · angle {rotationDegrees}°
      </div>
      <div>Shape: {isCircular ? "circular" : "elliptical"}</div>
      <div className="covariance">
        Σ = [ {f(covXX)} {f(covXY)} ]
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;[ {f(covXY)} {f(covYY)} ]
      </div>
      <div className="note">
        Equal sigmas give a circle; unequal sigmas stretch it into an ellipse. Rotation turns the
        ellipse. The covariance matrix Σ stores both: the spread on its diagonal and, once rotated,
        the orientation in its off-diagonal terms.
      </div>
    </div>
  );
}
