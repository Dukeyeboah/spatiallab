"use client";

import { PropertyExperienceApp } from "@/components/labs/experiences/property/PropertyExperienceApp";

/**
 * LAB PROD-01 — two-floor property experience authoring + visitor preview.
 * Open /labs/property-experience · add ?author=1 for author tools · ?floor=ground to skip welcome.
 */
export default function PropertyExperiencePage() {
  return <PropertyExperienceApp />;
}
