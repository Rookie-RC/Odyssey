// Derives the Journey Timeline from raw domain data. Nothing here is manually
// maintained: past nodes come from Visits, the NOW node from Profile.currentBase,
// and future nodes from Wishlist entries that carry meaningful timing.
//
// Rules from the spec:
//   - past nodes are one per Visit (not one per Place)
//   - the current base becomes the single NOW anchor
//   - only Wishlist entries with a targetTime (year and/or season) appear on the
//     Timeline; a season-only target is "season, year unknown" and is placed at
//     the next occurrence of that season
//   - countries are never Timeline nodes (they are Place metadata only)
import type {
  Inspiration,
  Media,
  Place,
  Profile,
  Season,
  TargetTime,
  Visit,
  VisitHighlight,
  VisitType,
  Wishlist,
} from "./types";

export type TimelineNodeKind = "past" | "now" | "future";

export interface TimelineNode {
  id: string;
  kind: TimelineNodeKind;
  place: Place;
  /** Position on the temporal axis, as a fractional year (e.g. 2026.5). */
  time: number;
  /** Season used to tint the Timeline line at this node (null = neutral). */
  season: Season | null;
  /** Human label for the point in time, e.g. "May 2025", "Now", "Summer 2027". */
  dateLabel: string;
  /** Secondary state label, e.g. "Trip", "Living here", "Wishlist". */
  metaLabel: string;
  withFriends?: boolean;
  highlights?: VisitHighlight[];
  reflection?: string;
  why?: string;
  inspirations?: Inspiration[];
  priority?: number;
  visitType?: VisitType;
  /** Visit record id when this node is a Visit (past/now nodes). Used by the
   * Map ↔ Timeline synchronization (v1.3) to link a focused node back to its
   * Visit for the multiple-Visit rule and route-segment emphasis. */
  visitId?: string;
  mediaIds: string[];
  /** Visual weight of a past node (current > lived > trip > ... > transit). */
  depthRank: number;
}

export const VISIT_RANK: Record<VisitType, number> = {
  lived: 5,
  trip: 4,
  day_trip: 3,
  stopover: 2,
  transit: 1,
};

const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  lived: "Lived",
  trip: "Trip",
  day_trip: "Day trip",
  stopover: "Stopover",
  transit: "Transit",
};

export function visitTypeLabel(t: VisitType): string {
  return VISIT_TYPE_LABEL[t] ?? t;
}

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

export function seasonLabel(s: Season): string {
  return SEASON_LABEL[s];
}

// Mid-month index (1-12) used to position a season on the temporal axis.
const SEASON_MID_MONTH: Record<Season, number> = {
  spring: 4, // April
  summer: 7, // July
  autumn: 10, // October
  winter: 1, // January
};

export function seasonFromMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

// yearFraction maps a date to a fractional year with day-level precision so
// visits within the same month still sort chronologically.
function yearFraction(d: Date): number {
  const year = d.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return year + (d.getTime() - start) / (end - start);
}

// timeFraction exposes the fractional-year mapping so the Timeline can anchor
// the NOW position even when there is no current-base node.
export function timeFraction(d: Date = new Date()): number {
  return yearFraction(d);
}

function seasonTime(year: number, season: Season): number {
  return year + (SEASON_MID_MONTH[season] - 0.5) / 12;
}

function nextSeasonTime(nowTime: number, season: Season): number {
  const target = seasonTime(Math.floor(nowTime), season);
  return target > nowTime ? target : seasonTime(Math.floor(nowTime) + 1, season);
}

function parseDate(str: string): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(str);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 15));
}

/** Fractional-year position of a date string ("YYYY-MM" or "YYYY-MM-DD"), or
 * null when the string carries no parseable date. Day-precision maps to its
 * exact day, month-precision to the 15th — the same mapping the Timeline
 * uses — so residence periods and route matching stay on one shared axis. */
export function dateTimeFromString(str?: string): number | null {
  if (!str) return null;
  const d = parseDate(str);
  return d ? yearFraction(d) : null;
}

/** The Visit's own chronological position (start date, else end date), or
 * null when it has no placeable date. This is the pure "when the Visit
 * happened", used by the residence-based route layer (v1.3) and the
 * residence-period bounds — without the Timeline's current-base anchoring. */
export function visitDateTime(v: Visit): number | null {
  return dateTimeFromString(v.startDate) ?? dateTimeFromString(v.endDate);
}

/** Fractional-year position of a Visit on the Timeline's temporal axis, or
 * null when the visit carries no placeable date.
 *
 * This is the single chronological source of truth for the Journey Timeline:
 * a current-base visit always sits at "now" (the Timeline's NOW anchor),
 * otherwise the visit's own date wins (visitDateTime). Since v1.3 the route
 * layer deliberately uses visitDateTime (not this function): routes express
 * which residence a trip originated from, so the current-base anchoring that
 * the Timeline needs would be wrong there.
 */
export function visitTimelineTime(
  v: Visit,
  currentId: string | null,
  nowTime: number
): number | null {
  if (currentId != null && v.placeId === currentId) return nowTime;
  return visitDateTime(v);
}

function formatMonthYear(str: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(str);
  if (!m) return str;
  const month = Number(m[2]);
  return (month >= 1 && month <= 12 ? MONTHS[month - 1] + " " : "") + m[1];
}

function resolveFutureTiming(
  tt: TargetTime,
  nowTime: number
): { time: number; dateLabel: string; season: Season | null } {
  if (tt.year != null && tt.season != null) {
    return {
      time: seasonTime(tt.year, tt.season),
      dateLabel: `${SEASON_LABEL[tt.season]} ${tt.year}`,
      season: tt.season,
    };
  }
  if (tt.year != null) {
    return { time: tt.year + 0.5, dateLabel: String(tt.year), season: null };
  }
  // Season only ("Summer, year unknown"): place at the next occurrence.
  const season = tt.season as Season;
  return {
    time: nextSeasonTime(nowTime, season),
    dateLabel: SEASON_LABEL[season],
    season,
  };
}

const KIND_ORDER: Record<TimelineNodeKind, number> = { past: 0, now: 1, future: 2 };

export function getTimelineItems(
  places: Place[],
  visits: Visit[],
  wishlist: Wishlist[],
  profile: Profile | null,
  now: Date = new Date()
): TimelineNode[] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const nowTime = yearFraction(now);
  const nowSeason = seasonFromMonth(now.getMonth() + 1);
  const currentId = profile?.currentBase?.placeId ?? null;
  const nodes: TimelineNode[] = [];

  // Past nodes (one per Visit). A Visit referencing the current base becomes
  // the NOW node instead of a past node.
  for (const v of visits) {
    const place = byId.get(v.placeId);
    if (!place) continue;
    const isNow = currentId != null && v.placeId === currentId;
    // visitTimelineTime is the shared chronological source of truth (also used
    // by the Hero Map route layer), so Timeline order can never diverge from
    // route order. Visits without any date get a synthetic early position so
    // they still appear ("Earlier") without pretending to a real date.
    const t = visitTimelineTime(v, currentId, nowTime);
    const date = v.startDate ? parseDate(v.startDate) : v.endDate ? parseDate(v.endDate) : null;
    const season = date ? seasonFromMonth(date.getMonth() + 1) : null;
    nodes.push({
      id: "visit:" + v.id,
      kind: isNow ? "now" : "past",
      place,
      time: isNow ? nowTime : t ?? nowTime - 20,
      season: isNow ? nowSeason : season,
      dateLabel: isNow
        ? "Now"
        : v.startDate
          ? formatMonthYear(v.startDate)
          : v.endDate
            ? formatMonthYear(v.endDate)
            : "Earlier",
      metaLabel: isNow ? "Living here" : visitTypeLabel(v.visitType),
      withFriends: v.withFriends,
      highlights: v.highlights,
      reflection: v.reflection,
      visitType: v.visitType,
      visitId: v.id,
      mediaIds: v.mediaIds ?? [],
      depthRank: isNow ? 6 : VISIT_RANK[v.visitType],
    });
  }

  // If the current base has no Visit, still surface a NOW anchor from the Place.
  if (currentId && !visits.some((v) => v.placeId === currentId)) {
    const place = byId.get(currentId);
    if (place) {
      nodes.push({
        id: "now:" + currentId,
        kind: "now",
        place,
        time: nowTime,
        season: nowSeason,
        dateLabel: "Now",
        metaLabel: "Current base",
        mediaIds: [],
        depthRank: 6,
      });
    }
  }

  // Future nodes: Wishlist entries with meaningful target timing.
  for (const w of wishlist) {
    const tt = w.targetTime;
    if (!tt || (tt.year == null && tt.season == null)) continue;
    const place = byId.get(w.placeId);
    if (!place) continue;
    const { time, dateLabel, season } = resolveFutureTiming(tt, nowTime);
    nodes.push({
      id: "wishlist:" + w.id,
      kind: "future",
      place,
      time,
      season,
      dateLabel,
      metaLabel: "Wishlist",
      why: w.why,
      inspirations: w.inspirations,
      priority: w.priority,
      mediaIds: w.mediaIds ?? [],
      depthRank: 0,
    });
  }

  nodes.sort(
    (a, b) =>
      a.time - b.time ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.id.localeCompare(b.id)
  );
  return nodes;
}

// getPrimaryMedia resolves the first image media for a node's mediaIds. Past
// nodes use the user's own photos; future nodes use inspiration images — both
// are ordinary Media records, so the distinction is conceptual, not structural.
export function getPrimaryMedia(mediaIds: string[], media: Media[]): Media | null {
  if (!mediaIds || mediaIds.length === 0) return null;
  const byId = new Map(media.map((m) => [m.id, m]));
  for (const id of mediaIds) {
    const m = byId.get(id);
    if (m && m.type === "image") return m;
  }
  return null;
}
