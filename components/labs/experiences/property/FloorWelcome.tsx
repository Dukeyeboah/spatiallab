"use client";

import type { FloorRecord, PropertyExperienceConfig } from "@/lib/labs/experiences/propertyExperience/types";
import { sortedFloors } from "@/lib/labs/experiences/propertyExperience/types";

type Props = {
  config: PropertyExperienceConfig;
  onSelectFloor: (floorId: string) => void;
};

/**
 * Visitor floor-selection screen — no LCC load required.
 */
export function FloorWelcome({ config, onSelectFloor }: Props) {
  const floors = sortedFloors(config).filter((f) => f.visitorVisible);
  const accent = config.visitor.brandAccent ?? "#c4a574";

  return (
    <div className="pe-welcome" style={{ ["--pe-accent" as string]: accent }}>
      <div className="pe-welcome-inner">
        <p className="pe-welcome-brand">Spatial House</p>
        <h1 className="pe-welcome-title">{config.property.title}</h1>
        <p className="pe-welcome-intro">
          {config.visitor.intro ?? config.property.description}
        </p>

        <div className="pe-floor-cards">
          {floors.map((floor) => (
            <FloorCard key={floor.id} floor={floor} onSelect={() => onSelectFloor(floor.id)} />
          ))}
        </div>

        <p className="pe-welcome-hint">
          Choose a floor to begin. You can move between floors from the stairs or the floor menu.
        </p>
      </div>
    </div>
  );
}

function FloorCard({ floor, onSelect }: { floor: FloorRecord; onSelect: () => void }) {
  const rooms = [...new Set(floor.viewpoints.map((v) => v.roomId || v.name).filter(Boolean))]
    .slice(0, 4)
    .join(" · ");

  return (
    <button type="button" className="pe-floor-card" onClick={onSelect}>
      <div className="pe-floor-card-media">
        {floor.previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview may be /path or data-URL from draft
          <img src={floor.previewImageUrl} alt="" suppressHydrationWarning />
        ) : (
          <div className="pe-floor-card-placeholder">No preview yet</div>
        )}
      </div>
      <div className="pe-floor-card-body">
        <span className="pe-floor-card-name">{floor.name}</span>
        {rooms ? <span className="pe-floor-card-meta">{rooms}</span> : null}
        <span className="pe-floor-card-cta">Explore {floor.name}</span>
      </div>
    </button>
  );
}
