"use client";

import type { CheckpointIconId } from "@/lib/labs/experiences/checkpointIcons";

type Props = {
  id: CheckpointIconId;
  className?: string;
  title?: string;
};

/** Compact SVG glyphs for checkpoint labels on UI + map. */
export function CheckpointIcon({ id, className, title }: Props) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (id) {
    case "entrance":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "living":
      return (
        <svg {...common}>
          <path d="M4 14h16v5H4z" />
          <path d="M6 14V10a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
          <path d="M8 19v2M16 19v2" />
        </svg>
      );
    case "dining":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="13" rx="7" ry="3.5" />
          <path d="M12 9.5V6M9 6h6" />
        </svg>
      );
    case "kitchen":
      return (
        <svg {...common}>
          <rect x="4" y="8" width="16" height="11" rx="1" />
          <path d="M8 8V5M12 8V4M16 8V5" />
        </svg>
      );
    case "bedroom":
      return (
        <svg {...common}>
          <path d="M3 18v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
          <path d="M3 18h18M6 11V8a2 2 0 0 1 2-2h3" />
        </svg>
      );
    case "bath":
      return (
        <svg {...common}>
          <path d="M5 12h14v3a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-3z" />
          <path d="M7 12V7a2 2 0 0 1 2-2h1" />
        </svg>
      );
    case "office":
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="8" rx="1" />
          <path d="M8 10V7h8v3M9 18v2M15 18v2" />
        </svg>
      );
    case "balcony":
      return (
        <svg {...common}>
          <path d="M4 14h16v5H4z" />
          <path d="M6 14V9l6-4 6 4v5" />
        </svg>
      );
    case "stairs":
      return (
        <svg {...common}>
          <path d="M4 18h4v-4h4V10h4V6h4" />
        </svg>
      );
    case "garden":
      return (
        <svg {...common}>
          <path d="M12 20V10" />
          <path d="M12 14c-3 0-5-2-5-5 3 0 5 2 5 5z" />
          <path d="M12 12c3 0 5-2 5-5-3 0-5 2-5 5z" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <path d="M4 8h3l1.5-2h5L15 8h5v11H4z" />
          <circle cx="12" cy="13.5" r="3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="10" r="3.5" />
          <path d="M12 13.5V20" />
        </svg>
      );
  }
}
