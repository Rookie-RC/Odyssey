// Derives the Hero Map's spatial data from raw domain records. Nothing here is
// hardcoded: markers and visited-country codes come from Places + Visits + Profile.
//
// Rules from the spec:
//   - only visited places (those referenced by a Visit) receive markers
//   - Wishlist-only places are excluded from the default Hero Map
//   - countries are derived from visited Place.countryCode and are metadata only
import type { Activity, Place, Profile, Visit, VisitType } from "./types";
import { VISIT_RANK, formatMonthYear, visitDateTime } from "./timeline";
import { primaryActivity } from "./activity";
import { t } from "./i18n";

export interface MapMarker {
  place: Place;
  visitType: VisitType;
  isCurrent: boolean;
  dateLabel: string;
  withFriends: boolean;
  rank: number; // higher = stronger visual weight
  /** The icon in the pin: what the trip there was for, or "overnight" for a
   * stopover without one. Null keeps the plain dot (homes, transits). */
  activity: Activity | "overnight" | null;
}

/** Radius in px of the pin's own disc (label offsets and collisions). */
export function markerRadius(m: Pick<MapMarker, "isCurrent" | "activity">): number {
  if (m.isCurrent) return 9;
  if (m.activity === "overnight") return 9;
  return m.activity ? 11 : 5;
}

/** The pin icon for a place: the primary activity of its strongest visit,
 * else of its most recent visit that names one; a bare stopover is a night in
 * passing. Homes (lived, current) and transits keep their plain marks. */
function markerActivity(
  strongest: Visit,
  placeVisits: Visit[],
  isCurrent: boolean
): MapMarker["activity"] {
  if (isCurrent || strongest.visitType === "lived" || strongest.visitType === "transit") return null;
  const own = primaryActivity(strongest);
  if (own) return own;
  const byRecency = [...placeVisits].sort((a, b) => (visitDateTime(b) ?? -Infinity) - (visitDateTime(a) ?? -Infinity));
  for (const v of byRecency) {
    const a = primaryActivity(v);
    if (a) return a;
  }
  return strongest.visitType === "stopover" ? "overnight" : null;
}

/** Whether a visited marker plants a country flag: not the current base (it
 * has its own ring), not a mere transit, and only with a real country code. */
export function markerHasFlag(m: MapMarker): boolean {
  return !m.isCurrent && m.visitType !== "transit" && /^[A-Z]{2}$/.test((m.place.countryCode ?? "").toUpperCase());
}

function formatDateLabel(visit: Visit): string {
  return visit.startDate ? formatMonthYear(visit.startDate) : "";
}

// buildMapMarkers returns one marker per visited place, using the strongest
// visit when a place has several, and flags the current base location.
export function buildMapMarkers(
  places: Place[],
  visits: Visit[],
  profile: Profile | null
): MapMarker[] {
  const strongest = new Map<string, Visit>();
  const byPlace = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = byPlace.get(v.placeId);
    if (list) list.push(v);
    else byPlace.set(v.placeId, [v]);
    const prev = strongest.get(v.placeId);
    if (!prev || VISIT_RANK[v.visitType] > VISIT_RANK[prev.visitType]) {
      strongest.set(v.placeId, v);
    }
  }

  const currentId = profile?.currentBase?.placeId ?? null;
  const markers: MapMarker[] = [];
  for (const place of places) {
    const visit = strongest.get(place.id);
    if (!visit) continue; // not visited -> no marker on the hero map
    const isCurrent = place.id === currentId;
    markers.push({
      place,
      visitType: visit.visitType,
      isCurrent,
      dateLabel: formatDateLabel(visit),
      withFriends: visit.withFriends ?? false,
      rank: isCurrent ? 6 : VISIT_RANK[visit.visitType],
      activity: markerActivity(visit, byPlace.get(place.id) ?? [], isCurrent),
    });
  }
  markers.sort((a, b) => b.rank - a.rank);
  return markers;
}

// visitedCountryCodes returns the distinct country codes of visited places,
// used to build the subtle visited-country polygon/outline layer.
export function visitedCountryCodes(places: Place[], visits: Visit[]): string[] {
  const visitedIds = new Set(visits.map((v) => v.placeId));
  const codes = new Set<string>();
  for (const p of places) {
    if (visitedIds.has(p.id) && p.countryCode) {
      codes.add(p.countryCode);
    }
  }
  return Array.from(codes).sort();
}

/** Countries on the wishlist that hold no visited place yet: drawn hatched,
 * "would like to go", beside the solid wash of visited countries. */
export function wishlistCountryCodes(
  places: Place[],
  visits: Visit[],
  wishlist: { placeId: string }[]
): string[] {
  const visited = new Set(visitedCountryCodes(places, visits));
  const byId = new Map(places.map((p) => [p.id, p]));
  const codes = new Set<string>();
  for (const w of wishlist) {
    const cc = byId.get(w.placeId)?.countryCode;
    if (cc && !visited.has(cc)) codes.add(cc);
  }
  return Array.from(codes).sort();
}

export interface WishMarker {
  place: Place;
  wishlistId: string;
  label: string;
}

// buildWishMarkers returns one marker per Wishlist place that has not been
// visited (a visited place already has its memory marker). These only appear
// when the optional Wishlist map layer is switched on.
export function buildWishMarkers(
  places: Place[],
  visits: Visit[],
  wishlist: { id: string; placeId: string; targetTime?: { year?: number; season?: string } }[]
): WishMarker[] {
  const visited = new Set(visits.map((v) => v.placeId));
  const byId = new Map(places.map((p) => [p.id, p]));
  const out: WishMarker[] = [];
  const seen = new Set<string>();
  for (const w of wishlist) {
    const place = byId.get(w.placeId);
    if (!place || visited.has(place.id) || seen.has(place.id)) continue;
    seen.add(place.id);
    const tt = w.targetTime;
    const season = tt?.season ? t(tt.season[0].toUpperCase() + tt.season.slice(1)) : "";
    const label =
      season && tt?.year ? t("{season} {year}", { season, year: tt.year }) : season || (tt?.year ? t("{year}", { year: tt.year }) : "");
    out.push({ place, wishlistId: w.id, label: label || t("Someday") });
  }
  return out;
}

/** [[west, south], [east, north]] around the given places, or null. Longitudes
 * are taken as-is (an atlas spanning the antimeridian simply frames wide). */
export function placesBounds(places: Place[]): [[number, number], [number, number]] | null {
  if (places.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of places) {
    const { lat, lng } = p.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  if (!Number.isFinite(w)) return null;
  return [[w, s], [e, n]];
}
