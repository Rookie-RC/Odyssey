import { describe, expect, test } from "vitest";
import { getTimelineItems, seasonFromMonth, visitDateTime, visitTimelineTime } from "./timeline";
import { places, profile, visits, wishlist } from "./fixtures.test-helpers";

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
