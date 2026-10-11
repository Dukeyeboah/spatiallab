"use client";

import { formatBytes } from "@/lib/splats";
import { thumbnailUrl, WARNING_LABELS, type TrainingProject } from "@/lib/training";

type PhotoGridProps = {
  project: TrainingProject;
  onlyWarnings: boolean;
  onRemove: (imageId: string, filename: string) => void;
  disabled: boolean;
};

/** Thumbnails (served by the backend, 320 px) with each photo's facts and warnings. */
export function PhotoGrid({ project, onlyWarnings, onRemove, disabled }: PhotoGridProps) {
  const warnings = project.analysis.warnings;
  const images = onlyWarnings ? project.images.filter((i) => warnings[i.id]?.length) : project.images;

  if (project.images.length === 0) {
    return (
      <div className="photo-area">
        <div className="photo-empty">No photographs yet. Add some with the panel on the left.</div>
      </div>
    );
  }

  return (
    <div className="photo-area">
      <div className="photo-grid">
        {images.map((image) => {
          const items = warnings[image.id] ?? [];
          return (
            <figure key={image.id} className={items.length ? "photo-card warned" : "photo-card"}>
              <img src={thumbnailUrl(project.id, image.id)} alt={image.filename} loading="lazy" />
              <figcaption>
                <div className="photo-name" title={image.filename}>
                  {image.filename}
                </div>
                <div className="photo-facts">
                  {image.width}×{image.height} · {formatBytes(image.bytes)} · {image.format}
                </div>
                {items.map((w) => (
                  <div key={w.message} className="photo-warning" title={WARNING_LABELS[w.kind].explain}>
                    {w.message}
                  </div>
                ))}
                {image.notes.map((n) => (
                  <div key={n} className="photo-facts">
                    {n}
                  </div>
                ))}
                <button
                  onClick={() => onRemove(image.id, image.filename)}
                  disabled={disabled}
                  aria-label={`Remove ${image.filename}`}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
