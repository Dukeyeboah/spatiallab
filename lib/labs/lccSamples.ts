/**
 * Local XGRIDS LCC sample packages under public/labs/lcc-samples/ (gitignored).
 * Only one scene is loaded at a time — switching remounts the host.
 */

export type LccSampleOption = {
  id: string;
  label: string;
  /** URL path to meta.lcc / meta.lcc2 (served from public/). */
  dataPath: string;
  /** Rough on-disk size hint for the UI (does not affect loading). */
  sizeHint: string;
  note?: string;
};

export const LCC_SAMPLES: LccSampleOption[] = [
  {
    id: "room",
    label: "Room tour",
    dataPath: "/labs/lcc-samples/Room_Tour_L2_PRO_P/meta.lcc2",
    sizeHint: "~108 MB",
    note: "Indoor walkthrough — default",
  },
  {
    id: "home",
    label: "Revit Home",
    dataPath: "/labs/lcc-samples/XGRIDS_Revit__Home/meta.lcc2",
    sizeHint: "~49 MB",
    note: "Smallest package",
  },
  {
    id: "sculpture",
    label: "Sculpture",
    dataPath: "/labs/lcc-samples/Sculpture/meta.lcc2",
    sizeHint: "~120 MB",
  },
  {
    id: "conference",
    label: "Conference hall",
    dataPath: "/labs/lcc-samples/ConferenceHall/meta.lcc2",
    sizeHint: "~137 MB",
  },
  {
    id: "penthouse",
    label: "Penthouse",
    dataPath: "/labs/lcc-samples/PentHouse/meta.lcc2",
    sizeHint: "~180 MB",
  },
  {
    id: "train",
    label: "Train museum",
    dataPath: "/labs/lcc-samples/TrainMuseum/meta.lcc2",
    sizeHint: "~260 MB",
  },
  {
    id: "church",
    label: "Church",
    dataPath: "/labs/lcc-samples/Church/meta.lcc2",
    sizeHint: "~288 MB",
  },
  {
    id: "office",
    label: "Office showroom",
    // Prefer underscore symlink (no space in URL path).
    dataPath: "/labs/lcc-samples/Office_Showroom/meta.lcc2",
    sizeHint: "~539 MB",
    note: "Largest — expect longer first load",
  },
];

export function sampleByPath(dataPath: string): LccSampleOption | undefined {
  return LCC_SAMPLES.find((s) => s.dataPath === dataPath);
}
