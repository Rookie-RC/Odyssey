// Higher-level domain queries (PRODUCT_SPEC §12). Everything here is derived
// from raw Atlas records — the UI never hand-maintains Where Next shelves or
// place stories.
//
// Where Next rules:
//   - every Wishlist entry may appear in Where Next (even without any timing)
//   - a Wishlist entry is eligible for a season when it lists that season in
//     `seasons`, or when it carries no season information at all (timeless)
//   - ranking is priority first, then a matching target season, then stable id
//   - only the top item becomes the dominant destination; the rest are
//     secondary (the component decides presentation, not this layer)
import type {
  Inspiration,
  InspirationType,
  Media,
  Place,
  Profile,
  Season,
  TargetTime,
  Visit,
  VisitHighlight,
  Wishlist,
} from "./types";
import { VISIT_RANK, seasonLabel, visitTypeLabel } from "./timeline";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const SEASON_LABEL: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

const INSPIRATION_LABEL: Record<InspirationType, string> = {
  book: "Book",
  movie: "Movie",
  video: "Video",
  social_media: "Social media",
  article: "Article",
  friend: "Friend",
  photo: "Photo",
  music: "Music",
  other: "Other",
};

// --- basic lookups ---

export function getPlace(places: Place[], id: string): Place | null {
  return places.find((p) => p.id === id) ?? null;
}

export function getVisitedPlaces(places: Place[], visits: Visit[]): Place[] {
  const visitedIds = new Set(visits.map((v) => v.placeId));
  return places.filter((p) => visitedIds.has(p.id));
}

// --- Where Next ---

export interface WhereNextItem {
  wishlist: Wishlist;
  place: Place;
}

function seasonEligible(w: Wishlist, season: Season): boolean {
  return !w.seasons || w.seasons.length === 0 || w.seasons.includes(season);
}

function targetSeasonMatch(w: Wishlist, season: Season): boolean {
  return w.targetTime?.season === season;
}

/** Returns Wishlist items eligible for a season, sorted by relevance
 * (priority desc, then target-season match, then id). The first item is the
 * dominant destination; the rest are secondary. */
export function getWhereNextItems(
  wishlist: Wishlist[],
  places: Place[],
  season: Season
): WhereNextItem[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const items: WhereNextItem[] = [];
  for (const w of wishlist) {
    const place = byId.get(w.placeId);
    if (!place || !seasonEligible(w, season)) continue;
    items.push({ wishlist: w, place });
  }
  items.sort((a, b) => {
    const pa = a.wishlist.priority ?? 0;
    const pb = b.wishlist.priority ?? 0;
    if (pb !== pa) return pb - pa;
    const ta = targetSeasonMatch(a.wishlist, season) ? 1 : 0;
    const tb = targetSeasonMatch(b.wishlist, season) ? 1 : 0;
    if (tb !== ta) return tb - ta;
    return a.wishlist.id.localeCompare(b.wishlist.id);
  });
  return items;
}

// --- Place story (memory / intention for one place) ---

export interface PlaceStory {
  place: Place;
  /** Visits for this place, strongest visit type first. */
  visits: Visit[];
  /** Wishlist entry for this place, if any. */
  wishlist: Wishlist | null;
  isCurrent: boolean;
  /** Strongest visit (the one that defines the memory). */
  primaryVisit: Visit | null;
  /** Media referenced by this place's visits and/or wishlist entry. */
  media: Media[];
  primaryMedia: Media | null;
}

export function getPlaceStory(
  placeId: string,
  places: Place[],
  visits: Visit[],
  wishlist: Wishlist[],
  profile: Profile | null,
  media: Media[]
): PlaceStory | null {
  const place = getPlace(places, placeId);
  if (!place) return null;
  const placeVisits = visits
    .filter((v) => v.placeId === placeId)
    .sort((a, b) => VISIT_RANK[b.visitType] - VISIT_RANK[a.visitType]);
  const w = wishlist.find((x) => x.placeId === placeId) ?? null;

  const mediaIds = new Set<string>();
  for (const v of placeVisits) (v.mediaIds ?? []).forEach((id) => mediaIds.add(id));
  if (w) (w.mediaIds ?? []).forEach((id) => mediaIds.add(id));
  const byId = new Map(media.map((m) => [m.id, m]));
  const placeMedia = Array.from(mediaIds)
    .map((id) => byId.get(id))
    .filter((m): m is Media => Boolean(m));

  return {
    place,
    visits: placeVisits,
    wishlist: w,
    isCurrent: profile?.currentBase?.placeId === placeId,
    primaryVisit: placeVisits[0] ?? null,
    media: placeMedia,
    primaryMedia: placeMedia[0] ?? null,
  };
}

export function getPrimaryMediaForPlace(
  placeId: string,
  visits: Visit[],
  wishlist: Wishlist[],
  media: Media[]
): Media | null {
  const ids = new Set<string>();
  for (const v of visits) {
    if (v.placeId === placeId) (v.mediaIds ?? []).forEach((id) => ids.add(id));
  }
  const w = wishlist.find((x) => x.placeId === placeId);
  if (w) (w.mediaIds ?? []).forEach((id) => ids.add(id));
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const id of ids) {
    const m = byId.get(id);
    if (m && m.type === "image") return m;
  }
  return null;
}

// --- formatting helpers ---

function fmtDate(dateStr: string): { y: string; mo: string; d: string | null } | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(dateStr);
  if (!m) return null;
  const month = Number(m[2]);
  return {
    y: m[1],
    mo: month >= 1 && month <= 12 ? MONTHS[month - 1] : m[2],
    d: m[3] ? String(Number(m[3])) : null,
  };
}

/** "Nov 10 – 15, 2025", "Jul – Aug 2025", "May 2021", "" when unknown.
 *
 * Both day-precision (`2025-11-10`) and month-precision (`2025-07`) inputs are
 * supported — the Visit form uses month inputs, so month precision is the
 * common case and must read as naturally as a full date. The year is written
 * once when both ends share it, and a comma only ever follows a day number. */
export function formatDateRange(start?: string, end?: string): string {
  const s = start ? fmtDate(start) : null;
  const e = end ? fmtDate(end) : null;
  if (!s) return "";

  // "Nov 10, 2025" / "May 2021"
  const single = (p: NonNullable<ReturnType<typeof fmtDate>>) =>
    p.d ? `${p.mo} ${p.d}, ${p.y}` : `${p.mo} ${p.y}`;

  if (!e) return single(s);

  if (s.y === e.y) {
    if (s.mo === e.mo) {
      // Same month: "Nov 10 – 15, 2025" with days, else just "Jul 2025".
      if (s.d && e.d) return s.d === e.d ? single(s) : `${s.mo} ${s.d} – ${e.d}, ${s.y}`;
      return `${s.mo} ${s.y}`;
    }
    // Same year, different months: "Jul 4 – Aug 9, 2025" / "Jul – Aug 2025".
    if (s.d && e.d) return `${s.mo} ${s.d} – ${e.mo} ${e.d}, ${s.y}`;
    return `${s.mo} – ${e.mo} ${s.y}`;
  }

  // Different years: each side carries its own year.
  return `${single(s)} – ${single(e)}`;
}

/** "Summer 2027", "Summer", "2028", "Sometime". */
export function targetTimeLabel(tt?: TargetTime): string {
  if (!tt || (tt.year == null && tt.season == null)) return "Sometime";
  const parts: string[] = [];
  if (tt.season) parts.push(SEASON_LABEL[tt.season]);
  if (tt.year != null) parts.push(String(tt.year));
  return parts.join(" ") || "Sometime";
}

export function inspirationTypeLabel(t: InspirationType): string {
  return INSPIRATION_LABEL[t] ?? "Other";
}

/** Best single-line description of an inspiration source. */
export function inspirationSourceLabel(i: Inspiration): string {
  if (i.title && i.creator) return `${i.title} · ${i.creator}`;
  if (i.title) return i.title;
  if (i.creator) return i.creator;
  if (i.platform) return i.platform;
  if (i.note) return i.note;
  return inspirationTypeLabel(i.type).toLowerCase();
}

/** Flag emoji from a 2-letter ISO country code (regional indicator symbols),
 * or "" when the code isn't a plausible ISO alpha-2 (missing/manual Places). */
export function flagEmoji(countryCode?: string): string {
  const cc = (countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
}

export { seasonLabel, visitTypeLabel };
export type { VisitHighlight };
