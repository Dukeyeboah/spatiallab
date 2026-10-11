"use client";

import { formatBytes } from "@/lib/splats";
import { thumbnailUrl, WARNING_LABELS, type TrainingProject } from "@/lib/training";

type PhotoGridProps = {
  project: TrainingProject;
  onlyWarnings: boolean;
  onlyUnplaced: boolean;
  /** Photo ids the training package holds out for evaluation (Lab 10C). */
  evalImages: Set<string>;
  onRemove: (imageId: string, filename: string) => void;
  disabled: boolean;
};

/** Thumbnails (served by the backend, 320 px) with each photo's facts, warnings and, once estimated, its pose status. */
export function PhotoGrid({ project, onlyWarnings, onlyUnplaced, evalImages, onRemove, disabled }: PhotoGridProps) {
  const warnings = project.analysis.warnings;
  const job = project.poses?.status === "done" ? project.poses : null;
  const unplaced = new Set(job?.summary?.notRegistered ?? []);
  const inJob = new Set(job?.imageIds ?? []);
  const images = project.images
    .filter((i) => !onlyWarnings || warnings[i.id]?.length)
    .filter((i) => !onlyUnplaced || unplaced.has(i.id));

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
                {job &&
                  (!inJob.has(image.id) ? (
                    <div className="photo-facts">Added after poses were estimated</div>
                  ) : unplaced.has(image.id) ? (
                    <div className="photo-unplaced">Not placed by COLMAP</div>
                  ) : (
                    <div className="photo-placed">Placed · {job.summary?.observations[image.id] ?? 0} points</div>
                  ))}
                {evalImages.has(image.id) && (
                  <div className="photo-facts" title="Not trained on: the trained scene is rendered from this pose and compared with the photo.">
                    Held out for evaluation
                  </div>
                )}
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
