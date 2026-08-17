// Derives the Hero Map's spatial data from raw domain records. Nothing here is
// hardcoded: markers and visited-country codes come from Places + Visits + Profile.
//
// Rules from the spec:
//   - only visited places (those referenced by a Visit) receive markers
//   - Wishlist-only places are excluded from the default Hero Map
//   - countries are derived from visited Place.countryCode and are metadata only
import type { Place, Profile, Visit, VisitType } from "./types";
import { VISIT_RANK } from "./timeline";

export interface MapMarker {
  place: Place;
  visitType: VisitType;
  isCurrent: boolean;
  dateLabel: string;
  withFriends: boolean;
  rank: number; // higher = stronger visual weight
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateLabel(visit: Visit): string {
  if (!visit.startDate) return "";
  const m = /^(\d{4})-(\d{2})/.exec(visit.startDate);
  if (!m) return visit.startDate;
  const month = Number(m[2]);
  return (month >= 1 && month <= 12 ? MONTHS[month - 1] + " " : "") + m[1];
}

// buildMapMarkers returns one marker per visited place, using the strongest
// visit when a place has several, and flags the current base location.
export function buildMapMarkers(
  places: Place[],
  visits: Visit[],
  profile: Profile | null
): MapMarker[] {
  const strongest = new Map<string, Visit>();
  for (const v of visits) {
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
