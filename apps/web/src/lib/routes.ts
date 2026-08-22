// Derives the Hero Map's route layer from existing domain data as
// *residence-based* travel (v1.3): each trip is an independent segment
// radiating outward from the residence that was active when the trip
// happened — not a point-to-point chronological chain. A trip in 2021 during
// a Hangzhou residence period reads as Hangzhou → destination, and a later
// trip while based in Jülich reads as Jülich → destination, exactly as the
// user's life actually unfolded.
//
// Nothing here is manually maintained and no external routing API is
// involved. These lines are conceptual chronological connections — never a
// claim about the actual transport route taken.
//
// Rules:
//   - residence periods come from Visit records with visitType "lived"
//     (start/end timing defines the active window; a lived Visit with no end
//     date is the current residence)
//   - each eligible non-lived Visit is dated (start date, else end date),
//     matched to the residence active at that time, and becomes one segment:
//     Residence Place → Visit Place
//   - Trip A → Trip B chains are never generated
//   - residence → itself is never generated
//   - a Visit that cannot be associated with any residence period is omitted
//     (never guessed); so are Wishlist/future destinations and lived Visits
//     themselves (they are origins, not routes)
//   - invalid/missing Place references are skipped (a missing Place can never
//     crash rendering — there is simply no segment)
//   - Visit data is never modified for visualization
//
// Future-proofing: matching is a pure function of (visit, residence periods),
// so later versions can add an explicit per-Visit origin override (e.g. an
// `originPlaceId`), multiple simultaneous residences, or manual period
// editing without changing the rendering side.
//
// Geometry: each segment becomes a restrained geographic arc — a great-circle
// interpolation with a gentle perpendicular bulge (small for short hops, so
// dense clusters stay calm; capped for long ones, so arcs stay elegant).
import type { Place, Visit } from "./types";
import { dateTimeFromString, visitDateTime } from "./timeline";

export interface RouteSegment {
  id: string;
  from: Place;
  to: Place;
  /** Fractional-year bounds on the shared temporal axis: fromTime is when the
   * residence period began, toTime is when the trip happened. */
  fromTime: number;
  toTime: number;
}

export interface RouteTrajectory {
  /** All residence → destination segments (may be empty). */
  segments: RouteSegment[];
  /** One GeoJSON LineString feature per segment, for the MapLibre layer. */
  geojson: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      properties: { segment: string };
      geometry: { type: "LineString"; coordinates: [number, number][] };
    }[];
  };
}

export interface ResidencePeriod {
  id: string;
  visit: Visit;
  place: Place;
  /** Fractional-year bounds of the period on the shared temporal axis;
   * -Infinity / +Infinity when a bound is not recorded. */
  startTime: number;
  endTime: number;
}

/** Residence periods derived from lived Visits. A lived Visit with no end
 * date is open-ended (current residence, or a period that simply never got an
 * end date recorded). */
export function buildResidencePeriods(
  places: Place[],
  visits: Visit[]
): ResidencePeriod[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const periods: ResidencePeriod[] = [];
  for (const v of visits) {
    if (v.visitType !== "lived") continue;
    const place = byId.get(v.placeId);
    if (!place) continue; // missing Place -> cannot be a home base
    periods.push({
      id: "residence:" + v.id,
      visit: v,
      place,
      // Same date parsing as the Timeline (month precision -> the 15th), so
      // residence bounds and trip dates live on one shared temporal axis.
      startTime: dateTimeFromString(v.startDate) ?? -Infinity,
      endTime: dateTimeFromString(v.endDate) ?? +Infinity,
    });
  }
  return periods;
}

/** The residence active at fractional-year time t, or null when no period
 * covers t. Among overlapping periods (messy historical data, an undated
 * residence, a future "multiple simultaneous residences" model) the most
 * recently established residence wins — the most plausible home base — with
 * the latest end and then a stable id as tie-breakers. */
export function findActiveResidence(
  periods: ResidencePeriod[],
  t: number
): ResidencePeriod | null {
  let best: ResidencePeriod | null = null;
  for (const p of periods) {
    if (t < p.startTime || t > p.endTime) continue;
    if (
      !best ||
      p.startTime > best.startTime ||
      (p.startTime === best.startTime &&
        (p.endTime > best.endTime ||
          (p.endTime === best.endTime && p.id.localeCompare(best.id) < 0)))
    ) {
      best = p;
    }
  }
  return best;
}

/** Builds the residence-based trajectory from Places + Visits. */
export function getRouteTrajectory(
  places: Place[],
  visits: Visit[]
): RouteTrajectory {
  const byId = new Map(places.map((p) => [p.id, p]));
  const residences = buildResidencePeriods(places, visits);
  const segments: RouteSegment[] = [];

  for (const v of visits) {
    if (v.visitType === "lived") continue; // residences are origins, not routes
    const place = byId.get(v.placeId);
    if (!place) continue; // invalid/missing Place -> never a segment
    const t = visitDateTime(v);
    if (t == null) continue; // no date -> cannot be associated reliably
    const home = findActiveResidence(residences, t);
    if (!home) continue; // no matching residence -> omit rather than guess
    if (home.place.id === place.id) continue; // never residence -> itself
    segments.push({
      id: home.place.id + "->" + place.id + "#" + v.id,
      from: home.place,
      to: place,
      fromTime: home.startTime,
      toTime: t,
    });
  }
  // Stable output order: by trip time, then segment id. (Rendering does not
  // depend on order; this keeps diffs and tests deterministic.)
  segments.sort((a, b) => a.toTime - b.toTime || a.id.localeCompare(b.id));

  return {
    segments,
    geojson: {
      type: "FeatureCollection",
      features: segments.map((s) => ({
        type: "Feature",
        // Feature id enables MapLibre feature-state, which the map layer uses
        // to subtly emphasize the focused residence → destination segment.
        id: s.id,
        properties: { segment: s.id },
        geometry: {
          type: "LineString",
          coordinates: arcBetween(s.from.coordinates, s.to.coordinates),
        },
      })),
    },
  };
}

// --- geographic arc geometry ------------------------------------------------
// Points are lifted onto the unit sphere, interpolated along the great circle
// (the shortest path — this is what keeps long segments and longitude
// wrapping correct), then nudged toward the great-circle pole with a
// sine-shaped profile that starts and ends exactly at the two Places. The
// perpendicular deviation at the arc midpoint is `bulge` radians; every
// interpolated point is renormalized, so the curve stays exactly on the
// sphere and endpoints never move.

const ARC_STEPS = 48;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function toVec3(p: { lng: number; lat: number }): Vec3 {
  const phi = (p.lng * Math.PI) / 180;
  const lam = (p.lat * Math.PI) / 180;
  const cl = Math.cos(lam);
  return { x: cl * Math.cos(phi), y: Math.sin(lam), z: cl * Math.sin(phi) };
}

function toLngLat(v: Vec3): [number, number] {
  return [
    (Math.atan2(v.z, v.x) * 180) / Math.PI,
    (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI,
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v)) || 1;
  return scale(v, 1 / len);
}

/** Spherical linear interpolation between two unit vectors. */
function slerp(a: Vec3, b: Vec3, t: number, angle: number): Vec3 {
  const s = Math.sin(angle);
  const w1 = Math.sin((1 - t) * angle) / s;
  const w2 = Math.sin(t * angle) / s;
  return {
    x: a.x * w1 + b.x * w2,
    y: a.y * w1 + b.y * w2,
    z: a.z * w1 + b.z * w2,
  };
}

/** A restrained geographic arc between two Places (line string, lng/lat). */
export function arcBetween(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number }
): [number, number][] {
  const a = toVec3(from);
  const b = toVec3(to);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (angle < 1e-5) {
    // Same point: a straight degenerate segment is fine (dedup usually
    // prevents this from ever reaching the geometry).
    return [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ];
  }
  // Pole of the great circle = the perpendicular direction the arc lifts
  // toward. For near-antipodal pairs the pole is undefined; those segments
  // simply stay on the great circle (no bulge).
  const pole = cross(a, b);
  const poleLen = Math.sqrt(dot(pole, pole));
  const axis = poleLen < 1e-4 ? null : scale(pole, 1 / poleLen);
  // Bulge (radians of perpendicular deviation at the midpoint): proportional
  // to the angular distance, small for short hops (dense clusters stay calm),
  // capped for long segments (arcs stay elegant). ~0.4° for a 300 km hop,
  // ~1.2° for a 900 km hop, capped around 1.7°.
  const bulge =
    axis == null ? 0 : Math.min(Math.max(angle * 0.16, 0.004), 0.03);
  const pts: [number, number][] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const gc = slerp(a, b, t, angle);
    const lift = bulge * Math.sin(Math.PI * t);
    const v = axis && lift > 0 ? normalize(add(gc, scale(axis, lift))) : gc;
    pts.push(toLngLat(v));
  }
  // Unwrap longitudes so the path is continuous even across the antimeridian:
  // consecutive points never jump by ~360° (a segment from 179.5° to -179.5°
  // is the short way around, rendered as 179.5 → 180.5 by MapLibre's world
  // wrapping). Ordinary segments are unaffected.
  for (let i = 1; i < pts.length; i++) {
    let dlng = pts[i][0] - pts[i - 1][0];
    while (dlng > 180) {
      pts[i][0] -= 360;
      dlng -= 360;
    }
    while (dlng < -180) {
      pts[i][0] += 360;
      dlng += 360;
    }
  }
  return pts;
}
