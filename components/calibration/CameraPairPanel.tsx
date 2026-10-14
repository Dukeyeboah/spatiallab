"use client";

import { useState } from "react";
import { eventChannels, imageNameMatches, runImageUrl, type Run, type RunEvent, type RunImage } from "@/lib/xgrids";
import { CHANNEL_COLOURS } from "./CalibrationLayers";

export type PairPanelSize = "hidden" | "small" | "large";

type CameraPairPanelProps = {
  run: Run;
  event: RunEvent;
  size: PairPanelSize;
  onSizeChange: (size: PairPanelSize) => void;
};

/**
 * Both cameras of the selected capture event side by side, at full
 * resolution from the backend (scaled by the browser). Each caption checks
 * that the image belongs to this event: its file name (sequence, channel,
 * timestamp) must agree with the manifest, and the decoded size with the
 * size the recording declares.
 */
export function CameraPairPanel({ run, event, size, onSizeChange }: CameraPairPanelProps) {
  return (
    <div className={`camera-pair ${size}`}>
      <div className="camera-pair-header">
        <span>
          Sequence {event.sequence} · {eventChannels(event).join(" + ")} · fisheye images as recorded (not undistorted)
        </span>
        <div className="segmented">
          {(["hidden", "small", "large"] as const).map((option) => (
            <button key={option} className={option === size ? "selected" : ""} onClick={() => onSizeChange(option)}>
              {option === "hidden" ? "Hide" : option === "small" ? "Small" : "Large"}
            </button>
          ))}
        </div>
      </div>
      {size !== "hidden" && (
        <div className="camera-pair-images">
          {eventChannels(event).map((channel) => (
            <CameraImage
              // A new key per image resets the "loaded" check, so a stale image is never reported as checked.
              key={`${channel}-${event.images[channel].file}`}
              runId={run.id}
              event={event}
              channel={channel}
              image={event.images[channel]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CameraImage({ runId, event, channel, image }: { runId: string; event: RunEvent; channel: string; image: RunImage }) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const nameOk = imageNameMatches(event, channel, image);
  const sizeOk = natural && natural.width === image.width && natural.height === image.height;

  if (!image.file) {
    return (
      <figure>
        <div className="camera-pair-missing">
          {channel}: not decoded ({image.decoderStatus}) {image.decoderMessage}
        </div>
      </figure>
    );
  }
  const url = runImageUrl(runId, image.file);
  return (
    <figure>
      {failed ? (
        <div className="camera-pair-missing">{channel}: the backend didn&apos;t return this image.</div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title="Open at full resolution">
          <img
            src={url}
            alt={`${channel}, sequence ${event.sequence}`}
            decoding="async"
            onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
        </a>
      )}
      <figcaption>
        <span className="swatch" style={{ background: CHANNEL_COLOURS[channel] }} /> <b>{channel}</b> ·{" "}
        {image.timestampUtc.slice(11)} · {image.decoderStatus}
        {image.decoderStatus !== "ok" && image.decoderMessage && ` (${image.decoderMessage})`}
        <span className={nameOk && sizeOk ? "check ok" : nameOk && !natural ? "check" : "check bad"}>
          {!nameOk
            ? " ⚠ file name doesn't match this event"
            : !natural
              ? " · loading…"
              : sizeOk
                ? ` · ✓ seq ${event.sequence}, ${natural.width}×${natural.height}`
                : ` ⚠ ${natural.width}×${natural.height}, expected ${image.width}×${image.height}`}
        </span>
      </figcaption>
    </figure>
  );
}
