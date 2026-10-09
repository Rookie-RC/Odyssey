// What a trip was for — skiing, a citywalk, a picnic … Each Visit may list
// activities (Visit.activities); the first one is its primary activity, the
// one the Hero Map draws on the place's pin. Activities complement the visit
// type (how deep the visit was) and the transport (how you got there).
//
// The runtime accepts any short slug, so this list can grow without a runtime
// change; ids the frontend does not know are kept in the data but not shown.
import { t } from "./i18n";
import type { Activity, Visit } from "./types";

export type ActivityGroup = "city" | "outdoors" | "purpose";

export const ACTIVITY_GROUPS: { id: ActivityGroup; label: string; items: Activity[] }[] = [
  {
    id: "city",
    label: "City",
    items: ["sightseeing", "citywalk", "museum", "food", "shopping", "concert", "themepark"],
  },
  {
    id: "outdoors",
    label: "Outdoors",
    items: ["hiking", "ski", "surf", "beach", "picnic", "aurora"],
  },
  {
    id: "purpose",
    label: "Purpose",
    items: ["backpacking", "study", "visiting"],
  },
];

export const ACTIVITIES: Activity[] = ACTIVITY_GROUPS.flatMap((g) => g.items);

const KNOWN = new Set<string>(ACTIVITIES);

export function isActivity(v: unknown): v is Activity {
  return typeof v === "string" && KNOWN.has(v);
}

const LABEL: Record<Activity, string> = {
  sightseeing: "Sightseeing",
  citywalk: "Citywalk",
  museum: "Museums & art",
  food: "Food",
  shopping: "Shopping",
  concert: "Concert & festival",
  themepark: "Theme park",
  hiking: "Hiking",
  ski: "Skiing",
  surf: "Surfing",
  beach: "Beach",
  picnic: "Picnic",
  aurora: "Northern lights",
  backpacking: "Backpacking",
  study: "Study & conference",
  visiting: "Visiting friends",
};

export function activityLabel(a: Activity): string {
  return t(LABEL[a]);
}

/** The visit's known activities, in the order the user chose them. */
export function activitiesOf(v: Pick<Visit, "activities">): Activity[] {
  const out: Activity[] = [];
  for (const a of v.activities ?? []) if (isActivity(a) && !out.includes(a)) out.push(a);
  return out;
}

/** The activity a visit is drawn with: its first known one. */
export function primaryActivity(v: Pick<Visit, "activities">): Activity | null {
  return activitiesOf(v)[0] ?? null;
}

/** Line glyphs on the shared 20 px grid (1.5 px strokes, round caps; drawn
 * for this project like the rest of components/Icons.tsx, never emoji —
 * VISUAL_SPEC §29). Inner SVG markup, so the same constant serves the React
 * icon and the map pins (which are plain DOM). */
export const ACTIVITY_GLYPH: Record<Activity, string> = {
  sightseeing:
    '<path d="M3 7.4A1.6 1.6 0 0 1 4.6 5.8h2l1.2-1.9h4.4l1.2 1.9h2A1.6 1.6 0 0 1 17 7.4v7.2a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 14.6Z"/><circle cx="10" cy="10.8" r="2.8"/>',
  citywalk:
    '<circle cx="11.2" cy="3.6" r="1.5"/><path d="M10.6 6.4 9.6 11.2l2.4 2.6.4 3.8"/><path d="m9.6 11.2-1.8 3-2.8 1.6"/><path d="m10.4 7.4-2.6 1.6-.8 2.6"/><path d="m10.6 7.6 1.8 2.4 2.4.6"/>',
  museum: '<path d="M2.8 7.4 10 3.2l7.2 4.2Z"/><path d="M5 9.6v5.2M8.3 9.6v5.2M11.7 9.6v5.2M15 9.6v5.2"/><path d="M3 17h14"/>',
  food: '<path d="M2.8 10h14.4c0 3.5-3.2 6.2-7.2 6.2S2.8 13.5 2.8 10Z"/><path d="M7.2 17.6h5.6"/><path d="m9.4 8.4 6-5.6M12.2 8.6l5-4.2"/>',
  shopping: '<path d="M4.2 6.6h11.6l-1 10.6H5.2Z"/><path d="M7.4 8.8V5.6a2.6 2.6 0 0 1 5.2 0v3.2"/>',
  concert: '<path d="M8 14.6V4.4l8-1.6v10"/><circle cx="5.8" cy="14.6" r="2.2"/><circle cx="13.8" cy="12.8" r="2.2"/>',
  themepark:
    '<circle cx="10" cy="8" r="5.4"/><path d="M10 2.6v10.8M4.6 8h10.8M6.2 4.2l7.6 7.6M13.8 4.2l-7.6 7.6"/><path d="M7.2 17.4 10 8l2.8 9.4M5.4 17.4h9.2"/>',
  hiking: '<path d="m1.8 16.8 5.6-8.6 3.2 4.8 2.2-3 5.4 6.8Z"/><path d="M7.4 8.2V3.2l3.2 1.2-3.2 1.2"/>',
  ski: '<circle cx="13.4" cy="3.4" r="1.5"/><path d="m12.6 5.8-3 3.4 2.8 2.2-1.4 3.4"/><path d="m9.6 9.2-2 2.8"/><path d="m12.2 6.4 2.6 2.4"/><path d="M11.4 6.6 7.4 8"/><path d="M2.8 13.6 17.4 18"/>',
  surf: '<path d="M2.4 13.4c2.4-.2 3.3-2 4.5-4.2 1.4-2.6 3.3-4.4 6.2-4.4 2.4 0 4.1 1.5 4.3 3.4-1.7-1-4-.5-4.5 1.4-.5 1.7.6 3.3 2.5 3.4"/><path d="M2.4 16.8c1.5 0 2.4-.9 3.9-.9s2.4.9 3.9.9 2.4-.9 3.9-.9 2.4.9 3.9.9"/>',
  beach:
    '<path d="M3 9.6C3 5.7 6.1 2.8 10 2.8s7 2.9 7 6.8c-1.2-.9-2.3-.9-3.5 0-1.2-.9-2.3-.9-3.5 0-1.2-.9-2.3-.9-3.5 0-1.2-.9-2.3-.9-3.5 0Z"/><path d="M10 9.6v7.4"/><path d="M3.4 17.2h13.2"/>',
  picnic: '<path d="M3 9.2h14l-1.7 7.6H4.7Z"/><path d="M6 9.2a4 4 0 0 1 8 0"/><path d="M3.8 12.8h12.4M8.2 9.6l.4 7M11.8 9.6l-.4 7"/>',
  aurora:
    '<path d="M2.6 6c2.6-2.2 4.6.8 7.4-1.4 2.6-2 4.8-.2 7.4-1.6"/><path d="M4.6 6.2v4.6M7.4 5.8v6.4M10.2 5v4.8M13 4.4v6.2M15.6 4v3.8"/><path d="m1.8 17.4 4.4-3.4 2.8 1.8 3.2-2.6 3 2 3-1.6"/>',
  backpacking:
    '<path d="M8 5.4V4.2a2 2 0 0 1 4 0v1.2"/><rect x="4.6" y="5.4" width="10.8" height="12" rx="3"/><path d="M7.4 17.4v-4.2a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v4.2"/><path d="M4.6 9.6h10.8"/>',
  study: '<path d="M10 3.6 18 7.4l-8 3.8-8-3.8Z"/><path d="M5.4 9.1v3.7c1.3 1.3 2.9 2 4.6 2s3.3-.7 4.6-2V9.1"/><path d="M18 7.4v4.6"/>',
  visiting:
    '<path d="M3 9.2 10 3.4l7 5.8"/><path d="M4.8 7.8v8.8h10.4V7.8"/><path d="M10 14.4s-2.4-1.5-2.4-3.1a1.2 1.2 0 0 1 2.4-.5 1.2 1.2 0 0 1 2.4.5c0 1.6-2.4 3.1-2.4 3.1Z"/>',
};

/** A stopover with no activity is a night in passing: a crescent moon. */
export const OVERNIGHT_GLYPH =
  '<path d="M14.8 12.8A6.2 6.2 0 0 1 7.2 5.2a6.2 6.2 0 1 0 7.6 7.6Z"/><path d="M14 3.4v2.4M12.8 4.6h2.4"/>';

/** Standalone SVG markup for a glyph (for DOM built outside React). */
export function glyphSvg(inner: string, size: number, strokeWidth = 1.5): string {
  return (
    `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  );
}
