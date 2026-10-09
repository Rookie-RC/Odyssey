import { describe, expect, test } from "vitest";
import {
  atlasWordmark,
  flagEmoji,
  formatDateRange,
  getPlaceStory,
  getWhereNextItems,
  targetTimeLabel,
} from "./domain";
import { places, profile, visits, wishlist } from "./fixtures.test-helpers";

describe("formatDateRange", () => {
  test.each([
    ["2025-11-10", "2025-11-15", "Nov 10 – 15, 2025"],
    ["2025-07", "2025-08", "Jul – Aug 2025"],
    ["2025-07-04", "2025-08-09", "Jul 4 – Aug 9, 2025"],
    ["2024-12-28", "2025-01-03", "Dec 28, 2024 – Jan 3, 2025"],
    ["2021-05", undefined, "May 2021"],
    ["2025-07", "2025-07", "Jul 2025"],
    [undefined, undefined, ""],
  ])("%s → %s", (start, end, expected) => {
    expect(formatDateRange(start, end)).toBe(expected);
  });
});

test("targetTimeLabel", () => {
  expect(targetTimeLabel({ year: 2027, season: "summer" })).toBe("Summer 2027");
  expect(targetTimeLabel({ season: "winter" })).toBe("Winter");
  expect(targetTimeLabel({ year: 2028 })).toBe("2028");
  expect(targetTimeLabel(undefined)).toBe("Sometime");
});

describe("getWhereNextItems", () => {
  test("eligibility: listed season or timeless; ranking by priority", () => {
    expect(getWhereNextItems(wishlist, places, "summer").map((i) => i.place.id)).toEqual(["lofoten", "kyoto"]);
    expect(getWhereNextItems(wishlist, places, "spring").map((i) => i.place.id)).toEqual(["lisbon", "kyoto"]);
    expect(getWhereNextItems(wishlist, places, "winter").map((i) => i.place.id)).toEqual(["kyoto"]);
  });

  test("wishes referencing a missing Place are skipped", () => {
    const broken = [...wishlist, { id: "w-x", placeId: "nowhere", priority: 5 as const }];
    expect(getWhereNextItems(broken, places, "summer").map((i) => i.place.id)).not.toContain("nowhere");
  });
});

test("getPlaceStory orders visits strongest first and collects media", () => {
  const story = getPlaceStory("paris", places, visits, wishlist, profile, [
    { id: "m1", type: "image", source: "local", path: "/media/paris/a.jpg" },
  ])!;
  expect(story.visits.map((v) => v.visitType)).toEqual(["trip", "stopover"]);
  expect(story.primaryMedia?.id).toBe("m1");
  expect(story.isCurrent).toBe(false);
  expect(getPlaceStory("home", places, visits, wishlist, profile, [])!.isCurrent).toBe(true);
});

test("flagEmoji only for plausible ISO codes", () => {
  expect(flagEmoji("fr")).toBe("🇫🇷");
  expect(flagEmoji("")).toBe("");
  expect(flagEmoji("FRA")).toBe("");
});

test("atlasWordmark", () => {
  expect(atlasWordmark("Yu")).toBe("Yu’s Atlas");
  expect(atlasWordmark("James Smith")).toBe("James’ Atlas");
  expect(atlasWordmark("  ")).toBe("My Atlas");
});

describe("Chinese formatting", () => {
  test("date ranges, target times and labels follow Chinese conventions", async () => {
    const { setLocale } = await import("./i18n");
    setLocale("zh");
    try {
      expect(formatDateRange("2025-11-10", "2025-11-15")).toBe("2025年11月10日–15日");
      expect(formatDateRange("2025-07", "2025-08")).toBe("2025年7月–8月");
      expect(formatDateRange("2024-12-28", "2025-01-03")).toBe("2024年12月28日 – 2025年1月3日");
      expect(formatDateRange("2021-05")).toBe("2021年5月");
      expect(targetTimeLabel({ year: 2027, season: "summer" })).toBe("2027年夏季");
      expect(targetTimeLabel({ year: 2028 })).toBe("2028年");
      expect(targetTimeLabel(undefined)).toBe("时间未定");
      expect(atlasWordmark("Yu")).toBe("Yu 的地图集");
    } finally {
      setLocale("en");
    }
  });
});
