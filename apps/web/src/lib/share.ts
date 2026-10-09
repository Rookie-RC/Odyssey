// Shareable tickets: the data behind the three ticket images (lib/ticket.ts)
// — one trip as a boarding pass, a country as a multi-city pass, the whole
// journey as an atlas pass. Pure functions of the atlas records, so the
// ticket shows exactly what the atlas holds: nothing is invented (no gates, no
// seats); the barcode and number are decorative, derived from the ids.
import type { Media, Place, Profile, Season, Transport, Visit, VisitType, Wishlist } from "./types";
import { getRouteTrajectory } from "./routes";
import { transportOf } from "./transport";
import { atlasFacts, type AtlasFacts } from "./domain";
import { seasonFromMonth, visitDateTime } from "./timeline";

export type ShareScope = "trip" | "country" | "journey";

/** A three-letter atlas code for a place, airport-board style: the first
 * three letters of its name without accents ("Amsterdam" → AMS, "Jülich /
 * Aachen" → JUL). Names without Latin letters keep their first two characters
 * (杭州 → 杭州). */
export function placeCode(name: string): string {
  const latin = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z]/g, "");
  if (latin.length >= 3) return latin.slice(0, 3).toUpperCase();
  const chars = Array.from(name.trim().replace(/\s+/g, ""));
  if (chars.length === 0) return "—";
  if (/^[A-Za-z]/.test(chars[0])) return chars.join("").slice(0, 3).toUpperCase();
  return chars.slice(0, 2).join("");
}

/** A stable short hash (FNV-1a) — seeds the barcode and the ticket number. */
export function ticketHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** "YA-7F3K2Q": decorative, deterministic per ticket. */
export function ticketNumber(seed: string): string {
  return "YA-" + ticketHash(seed).toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/** Whole days covered by a visit, when both ends carry a day ("2025-11-10" →
 * "2025-11-15" = 6). Month-precision dates have no day count. */
export function visitDays(v: Pick<Visit, "startDate" | "endDate">): number | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = v.startDate && re.exec(v.startDate);
  const b = v.endDate && re.exec(v.endDate);
  if (!a || !b) return null;
  const ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const days = Math.round(ms / 86_400_000) + 1;
  return days >= 1 ? days : null;
}

function visitSeason(v: Visit): Season | null {
  const m = /^\d{4}-(\d{2})/.exec(v.startDate ?? v.endDate ?? "");
  return m ? seasonFromMonth(Number(m[1])) : null;
}

export interface TicketLeg {
  visit: Visit;
  place: Place;
  /** Where the trip set out from: the residence active at the time (the same
   * rule as the map's routes), or null when none is known. */
  from: Place | null;
  mode: Transport;
  visitType: VisitType;
  season: Season | null;
  days: number | null;
}

function buildLegs(places: Place[], visits: Visit[]): TicketLeg[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const origin = new Map<string, Place>();
  for (const s of getRouteTrajectory(places, visits).segments) {
    origin.set(s.id.slice(s.id.lastIndexOf("#") + 1), s.from);
  }
  const legs: TicketLeg[] = [];
  for (const v of visits) {
    const place = byId.get(v.placeId);
    if (!place) continue;
    legs.push({
      visit: v,
      place,
      from: origin.get(v.id) ?? null,
      mode: transportOf(v),
      visitType: v.visitType,
      season: visitSeason(v),
      days: visitDays(v),
    });
  }
  return legs;
}

// Undated visits go last either way (NaN from ±Infinity falls through to the id).
const byDate = (a: TicketLeg, b: TicketLeg) =>
  (visitDateTime(a.visit) ?? Infinity) - (visitDateTime(b.visit) ?? Infinity) ||
  a.visit.id.localeCompare(b.visit.id);
const newestFirst = (a: TicketLeg, b: TicketLeg) =>
  (visitDateTime(b.visit) ?? -Infinity) - (visitDateTime(a.visit) ?? -Infinity) ||
  a.visit.id.localeCompare(b.visit.id);

export interface TripTicket {
  kind: "trip";
  leg: TicketLeg;
  withFriends: boolean;
  reflection: string;
  photo: Media | null;
  number: string;
}

export interface CountryTicket {
  kind: "country";
  countryCode: string;
  country: string;
  /** Every visit in the country, oldest first. */
  legs: TicketLeg[];
  /** Distinct places, in the order first visited. */
  cities: Place[];
  since: number | null;
  number: string;
}

export interface JourneyTicket {
  kind: "journey";
  passenger: string;
  facts: AtlasFacts;
  home: Place | null;
  /** Journeys (everything but residences), most recent first. */
  legs: TicketLeg[];
  number: string;
}

export type Ticket = TripTicket | CountryTicket | JourneyTicket;

export interface AtlasRecords {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
}

/** Only photographs served by the atlas itself can be drawn into a shareable
 * image (a remote one would taint the canvas). */
export function isLocalPhoto(m: Media): boolean {
  return m.type === "image" && m.path.startsWith("/media/");
}

export function tripTicket(visitId: string, r: AtlasRecords): TripTicket | null {
  const leg = buildLegs(r.places, r.visits).find((l) => l.visit.id === visitId);
  if (!leg) return null;
  const byId = new Map(r.media.map((m) => [m.id, m]));
  const photo =
    (leg.visit.mediaIds ?? []).map((id) => byId.get(id)).find((m): m is Media => Boolean(m && isLocalPhoto(m))) ?? null;
  return {
    kind: "trip",
    leg,
    withFriends: leg.visit.withFriends ?? false,
    reflection: (leg.visit.reflection ?? "").trim(),
    photo,
    number: ticketNumber("trip:" + visitId),
  };
}

export function countryTicket(countryCode: string, r: AtlasRecords): CountryTicket | null {
  const cc = countryCode.toUpperCase();
  const legs = buildLegs(r.places, r.visits)
    .filter((l) => l.place.countryCode.toUpperCase() === cc)
    .sort(byDate);
  if (legs.length === 0) return null;
  const cities: Place[] = [];
  for (const l of legs) if (!cities.some((c) => c.id === l.place.id)) cities.push(l.place);
  const years = legs.map((l) => Number((l.visit.startDate ?? l.visit.endDate ?? "").slice(0, 4))).filter((y) => y > 1900);
  return {
    kind: "country",
    countryCode: cc,
    country: legs[0].place.country,
    legs,
    cities,
    since: years.length ? Math.min(...years) : null,
    number: ticketNumber("country:" + cc),
  };
}

export function journeyTicket(r: AtlasRecords): JourneyTicket {
  const legs = buildLegs(r.places, r.visits)
    .filter((l) => l.visitType !== "lived")
    .sort(newestFirst);
  const homeId = r.profile?.currentBase?.placeId;
  return {
    kind: "journey",
    passenger: r.profile?.name?.trim() || "",
    facts: atlasFacts(r.places, r.visits, r.wishlist),
    home: r.places.find((p) => p.id === homeId) ?? null,
    legs,
    number: ticketNumber("journey:" + (r.profile?.name ?? "") + r.visits.length),
  };
}

/** Visited countries with how many places each holds, most first. */
export function sharableCountries(places: Place[], visits: Visit[]): { code: string; name: string; places: number }[] {
  const visited = new Set(visits.map((v) => v.placeId));
  const out = new Map<string, { code: string; name: string; places: number }>();
  for (const p of places) {
    if (!visited.has(p.id) || !p.countryCode) continue;
    const code = p.countryCode.toUpperCase();
    const e = out.get(code) ?? { code, name: p.country, places: 0 };
    e.places++;
    out.set(code, e);
  }
  return [...out.values()].sort((a, b) => b.places - a.places || a.name.localeCompare(b.name));
}

/** Every visit that can be shared as a trip, most recent first. */
export function sharableTrips(places: Place[], visits: Visit[]): { visit: Visit; place: Place }[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  return visits
    .filter((v) => byId.has(v.placeId))
    .map((v) => ({ visit: v, place: byId.get(v.placeId)! }))
    .sort(
      (a, b) =>
        (visitDateTime(b.visit) ?? -Infinity) - (visitDateTime(a.visit) ?? -Infinity) ||
        a.visit.id.localeCompare(b.visit.id)
    );
}
