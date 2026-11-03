"use client";

import {
  QUALITY_LEVER_HELP,
  QUALITY_PRESETS,
  qualityLadderOrder,
  qualityMixOrder,
  qualityPresetOrder,
  type QualityPresetId,
} from "@/lib/labs/experiences/qualityPresets";

type Props = {
  value: QualityPresetId;
  onChange: (id: QualityPresetId) => void;
  /** Show the active preset note under the lever. */
  showNote?: boolean;
};

/**
 * Always-visible Graphics lever: progressive ladder + mix-test tradeoffs.
 */
export function QualityLever({ value, onChange, showNote = true }: Props) {
  const order = qualityPresetOrder();
  const index = Math.max(0, order.indexOf(value));
  const preset = QUALITY_PRESETS[value];
  const ladder = qualityLadderOrder();
  const mix = qualityMixOrder();

  return (
    <div className="exp-quality-lever" role="group" aria-label="Graphics quality">
      <div className="exp-quality-lever-head">
        <span className="exp-quality-lever-label">Graphics</span>
        <span className="exp-quality-lever-value" title={preset.note}>
          {QUALITY_PRESETS[value].label}
        </span>
      </div>
      <input
        className="exp-quality-lever-range"
        type="range"
        min={0}
        max={order.length - 1}
        step={1}
        value={index}
        aria-valuetext={preset.label}
        onChange={(e) => {
          const next = order[Number(e.target.value)] ?? value;
          onChange(next);
        }}
      />
      <div className="exp-quality-group">
        <span className="exp-quality-group-label">Ladder</span>
        <div className="exp-quality-lever-ticks ladder" aria-hidden>
          {ladder.map((id) => (
            <button
              key={id}
              type="button"
              className={value === id ? "on" : ""}
              onClick={() => onChange(id)}
              title={QUALITY_PRESETS[id].note}
            >
              {QUALITY_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>
      <div className="exp-quality-group">
        <span className="exp-quality-group-label">Mix tests</span>
        <div className="exp-quality-lever-ticks mix" aria-hidden>
          {mix.map((id) => (
            <button
              key={id}
              type="button"
              className={value === id ? "on" : ""}
              onClick={() => onChange(id)}
              title={QUALITY_PRESETS[id].note}
            >
              {QUALITY_PRESETS[id].label}
            </button>
          ))}
        </div>
      </div>
      {showNote ? (
        <p className="exp-quality-lever-note" title={QUALITY_LEVER_HELP}>
          {preset.note}
        </p>
      ) : null}
    </div>
  );
}
