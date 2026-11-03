/**
 * Common interior / property icons for checkpoints (UI + floor map).
 */

export type CheckpointIconId =
  | "entrance"
  | "living"
  | "dining"
  | "kitchen"
  | "bedroom"
  | "bath"
  | "office"
  | "balcony"
  | "stairs"
  | "garden"
  | "camera"
  | "pin";

export const CHECKPOINT_ICONS: { id: CheckpointIconId; label: string }[] = [
  { id: "entrance", label: "Entrance" },
  { id: "living", label: "Living" },
  { id: "dining", label: "Dining" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bedroom", label: "Bedroom" },
  { id: "bath", label: "Bath" },
  { id: "office", label: "Office" },
  { id: "balcony", label: "Balcony" },
  { id: "stairs", label: "Stairs" },
  { id: "garden", label: "Garden" },
  { id: "camera", label: "View" },
  { id: "pin", label: "Pin" },
];

export const DEFAULT_CHECKPOINT_ICON: CheckpointIconId = "pin";
