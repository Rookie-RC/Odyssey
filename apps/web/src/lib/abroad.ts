// Study abroad (留学): the stretches of life spent abroad — from the day you
// land to the final flight home — with the holidays back home in between
// (Profile.abroad). The Profile summarizes each stretch (days abroad, the
// countries and places it took you to, what you did there) and the Journey
// Timeline marks its arrival, home trips and return.
import type { AbroadPeriod, Activity, DateSpan, Place, Visit } from "./types";
import { activitiesOf } from "./activity";
import { formatDateRange } from "./domain";
import { dateTimeFromString, formatMonthYear } from "./timeline";
import { t } from "./i18n";

const DAY_MS = 86_400_000;

/** Calendar day number (days since 1970-01-01) of a "YYYY-MM[-DD]" date. A
 * month-precision date covers the whole month: as a start it is the 1st, as
 * an end the last day. */
export function dayOf(str: string | undefined, edge: "start" | "end"): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(str ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (m[3]) return Math.floor(Date.UTC(y, mo - 1, Number(m[3])) / DAY_MS);
  return Math.floor((edge === "start" ? Date.UTC(y, mo - 1, 1) : Date.UTC(y, mo, 0)) / DAY_MS);
}

/** Today's calendar day number in local time. */
export function todayDay(now: Date = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

/** Inclusive range of calendar days. */
export interface DayRange {
  from: number;
  to: number;
}

export type AbroadStatus = "upcoming" | "ongoing" | "done";

/** The period's days, arrival to final return — or to today while still
 * abroad. Null when the start date is unreadable. */
export function periodRange(p: AbroadPeriod, today: number): DayRange | null {
  const from = dayOf(p.startDate, "start");
  if (from == null) return null;
  const end = p.endDate ? dayOf(p.endDate, "end") : null;
  return { from, to: Math.max(from, end ?? today) };
}

export function periodStatus(p: AbroadPeriod, today: number): AbroadStatus {
  const from = dayOf(p.startDate, "start");
  if (from != null && from > today) return "upcoming";
  const end = p.endDate ? dayOf(p.endDate, "end") : null;
  return end != null && end < today ? "done" : "ongoing";
}

/** A home trip's days inside its period. One without an end is still going
 * on (you are home right now) until today. */
function homeRange(h: DateSpan, period: DayRange, today: number): DayRange | null {
  const from = dayOf(h.startDate, "start");
  if (from == null) return null;
  const to = h.endDate ? dayOf(h.endDate, "end") : Math.max(from, today);
  if (to == null) return null;
  const r = { from: Math.max(from, period.from), to: Math.min(to, period.to) };
  return r.from <= r.to ? r : null;
}

/** Days in a set of ranges, overlaps counted once. */
function coveredDays(ranges: DayRange[]): number {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  let total = 0;
  let cur: DayRange | null = null;
  for (const r of sorted) {
    if (cur && r.from <= cur.to + 1) {
      cur.to = Math.max(cur.to, r.to);
      continue;
    }
    if (cur) total += cur.to - cur.from + 1;
    cur = { ...r };
  }
  if (cur) total += cur.to - cur.from + 1;
  return total;
}

export interface AbroadSummary {
  period: AbroadPeriod;
  status: AbroadStatus;
  /** Days actually spent abroad: the period minus the time back home. */
  days: number;
  /** "Day N" since arrival, while still abroad. */
  dayNumber: number | null;
  homeTrips: number;
  /** Distinct places visited during the period, in order of first visit. */
  places: Place[];
  /** Distinct country codes of those places, in order of first visit. */
  countries: string[];
  /** Visits other than residences. */
  trips: number;
  /** What those trips were for, most frequent first. */
  activities: { activity: Activity; count: number }[];
}

/** The day a visit happened (its start, else its end), if it has one. */
function visitDay(v: Visit): number | null {
  return dayOf(v.startDate, "start") ?? dayOf(v.endDate, "end");
}

export function summarizeAbroad(
  p: AbroadPeriod,
  places: Place[],
  visits: Visit[],
  now: Date = new Date()
): AbroadSummary {
  const today = todayDay(now);
  const status = periodStatus(p, today);
  const range = periodRange(p, today);
  const home = range
    ? (p.homeTrips ?? []).map((h) => homeRange(h, range, today)).filter((r): r is DayRange => r != null)
    : [];
  // Only days already lived count: a period (or home trip) ending in the
  // future is counted up to today.
  let days = 0;
  if (range && status !== "upcoming") {
    const last = Math.min(range.to, today);
    const away = home.map((h) => ({ from: h.from, to: Math.min(h.to, last) })).filter((h) => h.from <= h.to);
    days = Math.max(0, last - range.from + 1 - coveredDays(away));
  }

  const byId = new Map(places.map((pl) => [pl.id, pl]));
  const during = range
    ? visits
        .map((v) => ({ v, day: visitDay(v) }))
        .filter((x): x is { v: Visit; day: number } => x.day != null && x.day >= range.from && x.day <= range.to)
        .sort((a, b) => a.day - b.day)
    : [];
  const seenPlaces = new Set<string>();
  const visited: Place[] = [];
  const countries: string[] = [];
  const counts = new Map<Activity, number>();
  let trips = 0;
  for (const { v } of during) {
    const place = byId.get(v.placeId);
    if (place && !seenPlaces.has(place.id)) {
      seenPlaces.add(place.id);
      visited.push(place);
      if (place.countryCode && !countries.includes(place.countryCode)) countries.push(place.countryCode);
    }
    if (v.visitType === "lived") continue;
    trips++;
    for (const a of activitiesOf(v)) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const activities = Array.from(counts, ([activity, count]) => ({ activity, count })).sort(
    (a, b) => b.count - a.count
  );

  return {
    period: p,
    status,
    days,
    dayNumber: range && status === "ongoing" ? today - range.from + 1 : null,
    homeTrips: (p.homeTrips ?? []).length,
    places: visited,
    countries,
    trips,
    activities,
  };
}

/** Days abroad across every period. */
export function totalDaysAbroad(periods: AbroadPeriod[] | undefined, now: Date = new Date()): number {
  return (periods ?? []).reduce((n, p) => n + summarizeAbroad(p, [], [], now).days, 0);
}

export type AbroadMilestoneKind = "arrive" | "home" | "return";

/** A moment of a stay abroad on the Journey Timeline. */
export interface AbroadMilestone {
  id: string;
  kind: AbroadMilestoneKind;
  periodId: string;
  /** Fractional year, on the Timeline's axis. */
  time: number;
  dateLabel: string;
  title: string;
  /** The period's own name ("TUM · MSc"), if any. */
  detail?: string;
}

export function abroadMilestones(periods: AbroadPeriod[] | undefined): AbroadMilestone[] {
  const out: AbroadMilestone[] = [];
  for (const p of periods ?? []) {
    const start = dateTimeFromString(p.startDate);
    if (start == null) continue;
    out.push({
      id: "abroad:" + p.id + ":arrive",
      kind: "arrive",
      periodId: p.id,
      time: start,
      dateLabel: formatMonthYear(p.startDate),
      title: t("Arrived abroad"),
      detail: p.label || undefined,
    });
    (p.homeTrips ?? []).forEach((h, i) => {
      const time = dateTimeFromString(h.startDate);
      if (time == null) return;
      out.push({
        id: "abroad:" + p.id + ":home:" + i,
        kind: "home",
        periodId: p.id,
        time,
        // Month precision keeps the small milestone label on one line.
        dateLabel: formatDateRange(h.startDate.slice(0, 7), h.endDate?.slice(0, 7)),
        title: t("Back home for a while"),
      });
    });
    const end = dateTimeFromString(p.endDate);
    if (end != null) {
      out.push({
        id: "abroad:" + p.id + ":return",
        kind: "return",
        periodId: p.id,
        time: end,
        dateLabel: formatMonthYear(p.endDate!),
        title: t("Moved back home"),
        detail: p.label || undefined,
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** A stay abroad as a stretch of the Timeline's axis (fractional years), with
 * the time back home cut out of it. An open period runs to `nowTime`. */
export interface AbroadBand {
  periodId: string;
  from: number;
  to: number;
  gaps: [number, number][];
}

export function abroadBands(periods: AbroadPeriod[] | undefined, nowTime: number): AbroadBand[] {
  const out: AbroadBand[] = [];
  for (const p of periods ?? []) {
    const from = dateTimeFromString(p.startDate);
    if (from == null) continue;
    const to = p.endDate ? dateTimeFromString(p.endDate) ?? nowTime : Math.max(from, nowTime);
    const gaps: [number, number][] = [];
    for (const h of p.homeTrips ?? []) {
      const a = dateTimeFromString(h.startDate);
      if (a == null) continue;
      const b = h.endDate ? dateTimeFromString(h.endDate) ?? a : Math.max(a, nowTime);
      if (b > from && a < to) gaps.push([Math.max(a, from), Math.min(b, to)]);
    }
    out.push({ periodId: p.id, from, to, gaps: gaps.sort((x, y) => x[0] - y[0]) });
  }
  return out;
}
