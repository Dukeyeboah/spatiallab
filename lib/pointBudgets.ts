/**
 * The same scan converted at different densities (see scripts/convert_las.py).
 * Only the selected one is loaded at a time.
 */
export type PointBudget = {
  label: string;
  url: string;
};

export const POINT_BUDGETS: PointBudget[] = [
  { label: "500K", url: "/data/pointcloud-500k.bin" },
  { label: "1M", url: "/data/pointcloud-1m.bin" },
  { label: "2M", url: "/data/pointcloud-2m.bin" },
];
