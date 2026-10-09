"use client";

type MatrixDisplayProps = {
  label: string;
  /** Row-major rows. */
  rows: number[][];
  digits: number;
  unit: string;
};

/** A small monospace matrix, e.g. a covariance. */
export function MatrixDisplay({ label, rows, digits, unit }: MatrixDisplayProps) {
  const width = Math.max(...rows.flat().map((v) => v.toFixed(digits).length));
  return (
    <div className="matrix">
      <div>
        {label} <span className="unit">({unit})</span>
      </div>
      <pre>
        {rows
          .map((row) => `[ ${row.map((v) => v.toFixed(digits).padStart(width)).join("  ")} ]`)
          .join("\n")}
      </pre>
    </div>
  );
}
