import { describe, expect, test } from "vitest";
import {
  abroadFraction,
  getJourney,
  getTimelineItems,
  seasonFromMonth,
  timeFraction,
  visitDateTime,
  visitTimelineTime,
} from "./timeline";
import { abroadBands, abroadMilestones } from "./abroad";
import { places, profile, visits, wishlist } from "./fixtures.test-helpers";
import type { AbroadPeriod, Visit } from "./types";

const NOW = new Date(2026, 9, 8); // 8 Oct 2026

describe("getTimelineItems", () => {
  const nodes = getTimelineItems(places, visits, wishlist, profile, NOW);

  test("one past node per Visit, the current base becomes NOW", () => {
    const now = nodes.filter((n) => n.kind === "now");
    expect(now).toHaveLength(1);
    expect(now[0].place.id).toBe("home");
    expect(now[0].dateLabel).toBe("Now");
    expect(nodes.filter((n) => n.kind === "past").map((n) => n.visitId)).toEqual(
      expect.arrayContaining(["v-old", "v-kyoto", "v-paris", "v-paris2", "v-rome"])
    );
  });

  test("future nodes only for wishes with timing; untimed wishes stay off the line", () => {
    const future = nodes.filter((n) => n.kind === "future").map((n) => n.place.id);
    expect(future).toEqual(["lofoten", "kyoto"]);
    expect(future).not.toContain("lisbon");
  });

  test("a season-only wish lands on the next occurrence of that season", () => {
    const lofoten = nodes.find((n) => n.place.id === "lofoten")!;
    // October 2026 → next summer is 2027.
    expect(Math.floor(lofoten.time)).toBe(2027);
    expect(lofoten.dateLabel).toBe("Summer");
  });

  test("nodes are chronological and an undated visit sits far in the past", () => {
    const times = nodes.map((n) => n.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(nodes[0].visitId).toBe("v-rome");
    expect(nodes[0].dateLabel).toBe("Earlier");
  });

  test("dates carry month labels and seasons", () => {
    const paris = nodes.find((n) => n.visitId === "v-paris")!;
    expect(paris.dateLabel).toBe("Jun 2023");
    expect(paris.season).toBe("summer");
    expect(paris.mediaIds).toEqual(["m1"]);
  });

  test("a visit without a date is flagged, the others keep their own dates", () => {
    expect(nodes.filter((n) => !n.dated).map((n) => n.visitId)).toEqual(["v-rome"]);
    const paris = nodes.find((n) => n.visitId === "v-paris")!;
    expect([paris.startDate, paris.endDate]).toEqual(["2023-06-01", "2023-06-05"]);
  });

  test("trips carry how and why; residences do not", () => {
    const tagged: Visit[] = visits.map((v) =>
      v.id === "v-paris" ? { ...v, transport: "train", activities: ["museum", "food"] } : v
    );
    const items = getTimelineItems(places, tagged, wishlist, profile, NOW);
    const paris = items.find((n) => n.visitId === "v-paris")!;
    expect([paris.transport, paris.activity]).toEqual(["train", "museum"]);
    const kyoto = items.find((n) => n.visitId === "v-kyoto")!;
    expect([kyoto.transport, kyoto.activity]).toEqual(["plane", undefined]); // unset means plane
    const home = items.find((n) => n.kind === "now")!;
    expect([home.transport, home.activity]).toEqual([undefined, undefined]);
  });
});

describe("getJourney", () => {
  const nowTime = timeFraction(NOW);
  const nodes = getTimelineItems(places, visits, wishlist, profile, NOW);
  const journey = getJourney(nodes, nowTime);
  const ids = (list: { id: string }[]) => list.map((e) => e.id);

  test("NOW first, then the future nearest first", () => {
    expect(journey.now?.node?.place.id).toBe("home");
    expect(ids(journey.ahead)).toEqual(["wishlist:w-lofoten", "wishlist:w-kyoto"]);
  });

  test("the past runs newest first under year headings, undated visits last", () => {
    expect(journey.past.map((g) => g.year)).toEqual([2024, 2023, 2018, 2015, null]);
    expect(ids(journey.past.flatMap((g) => g.entries))).toEqual([
      "visit:v-paris2",
      "visit:v-paris",
      "visit:v-kyoto",
      "visit:v-old",
      "visit:v-rome",
    ]);
  });

  test("without a current base there is no NOW entry, and every visit is past", () => {
    const none = getJourney(getTimelineItems(places, visits, wishlist, null, NOW), nowTime);
    expect(none.now).toBeNull();
    expect(none.past.flatMap((g) => g.entries)).toHaveLength(visits.length);
  });

  test("a wish for later this year is ahead even though its mid-year has passed", () => {
    const thisYear = getTimelineItems(places, [], [{ id: "w", placeId: "lisbon", targetTime: { year: 2026 } }], null, NOW);
    expect(ids(getJourney(thisYear, nowTime).ahead)).toEqual(["wishlist:w"]);
  });

  test("another visit to the current base joins the past instead of vanishing", () => {
    const more: Visit[] = [...visits, { id: "v-home2", placeId: "home", visitType: "trip", startDate: "2022-05" }];
    const j = getJourney(getTimelineItems(places, more, wishlist, profile, NOW), nowTime);
    expect(j.now?.node?.visitId).toBe("v-home"); // the one you live in
    expect(ids(j.past.flatMap((g) => g.entries))).toContain("visit:v-home2");
  });

  test("a season is named where its run starts, not on every visit", () => {
    const summers: Visit[] = [
      { id: "a", placeId: "paris", visitType: "trip", startDate: "2023-06-10" },
      { id: "b", placeId: "rome", visitType: "trip", startDate: "2023-07-20" },
      { id: "c", placeId: "kyoto", visitType: "trip", startDate: "2023-03-02" },
    ];
    const j = getJourney(getTimelineItems(places, summers, [], null, NOW), nowTime);
    const entries = j.past.flatMap((g) => g.entries);
    expect(entries.map((e) => [e.id, e.seasonStart])).toEqual([
      ["visit:b", true], // July, the run's first in reading order
      ["visit:a", false], // June, same summer
      ["visit:c", true], // March
    ]);
  });

  test("December belongs to the following winter's run", () => {
    const winter: Visit[] = [
      { id: "jan", placeId: "paris", visitType: "trip", startDate: "2024-01-05" },
      { id: "dec", placeId: "rome", visitType: "trip", startDate: "2023-12-27" },
    ];
    const entries = getJourney(getTimelineItems(places, winter, [], null, NOW), nowTime).past.flatMap((g) => g.entries);
    expect(entries.map((e) => e.seasonStart)).toEqual([true, false]);
  });
});

describe("getJourney with a stay abroad", () => {
  const nowTime = timeFraction(NOW);
  const abroad: AbroadPeriod[] = [
    {
      id: "tum",
      label: "TUM · MSc",
      startDate: "2023-09",
      homeTrips: [{ startDate: "2024-12-20", endDate: "2025-01-10" }],
    },
  ];
  const withAbroad = { ...profile, abroad };
  const nodes = getTimelineItems(places, visits, wishlist, withAbroad, NOW);
  const journey = getJourney(nodes, nowTime, abroadMilestones(abroad), abroadBands(abroad, nowTime));
  const past = journey.past.flatMap((g) => g.entries);

  test("milestones take their place among the visits", () => {
    expect(past.map((e) => e.id)).toEqual([
      "abroad:tum:home:0",
      "visit:v-paris2",
      "abroad:tum:arrive",
      "visit:v-paris",
      "visit:v-kyoto",
      "visit:v-old",
      "visit:v-rome",
    ]);
    expect(journey.past.map((g) => g.year)).toEqual([2024, 2023, 2018, 2015, null]);
  });

  test("the line is tinted where the time was spent abroad", () => {
    const down = Object.fromEntries(past.map((e) => [e.id, e.abroadDown]));
    expect(down["abroad:tum:home:0"]).toBe(true); // down to the Paris stopover, in January 2024
    expect(down["visit:v-paris2"]).toBe(true); // down to the arrival
    expect(down["abroad:tum:arrive"]).toBe(false); // before the arrival: home
    expect(past[1].abroadUp).toBe(true); // the other end of the same stretch
    expect(past[3].abroadUp).toBe(false);
    expect(journey.now?.abroadDown).toBe(false); // the future is not time abroad yet
  });

  test("the trip home cuts the band, a short one does not unmake a long stretch", () => {
    const bands = abroadBands(abroad, nowTime);
    expect(abroadFraction(2024.98, 2025.01, bands)).toBe(0); // all of it at home
    expect(abroadFraction(2024.5, 2024.95, bands)).toBe(1); // up to the flight home
    expect(abroadFraction(2024.5, 2026.5, bands)).toBeGreaterThan(0.9);
  });
});

test("abroadFraction: a moment is abroad or it is not", () => {
  const bands = abroadBands([{ id: "a", startDate: "2023-09", endDate: "2024-06" }], 2026.77);
  expect(abroadFraction(2023.9, 2023.9, bands)).toBe(1);
  expect(abroadFraction(2022.5, 2022.5, bands)).toBe(0);
  expect(abroadFraction(2022.0, 2023.0, bands)).toBe(0);
  expect(abroadFraction(2023.0, 2024.0, [])).toBe(0);
});

test("seasonFromMonth uses meteorological seasons", () => {
  expect([12, 1, 2].map(seasonFromMonth)).toEqual(["winter", "winter", "winter"]);
  expect([3, 6, 9].map(seasonFromMonth)).toEqual(["spring", "summer", "autumn"]);
});

test("current-base visits anchor at now on the Timeline but keep their own date for routes", () => {
  const home = visits.find((v) => v.id === "v-home")!;
  expect(visitTimelineTime(home, "home", 2026.77)).toBe(2026.77);
  expect(Math.floor(visitDateTime(home)!)).toBe(2020);
});
