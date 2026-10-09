import { describe, expect, test } from "vitest";
import { abroadBands, abroadMilestones, dayOf, summarizeAbroad, totalDaysAbroad } from "./abroad";
import { places, visits } from "./fixtures.test-helpers";
import type { AbroadPeriod, Visit } from "./types";

const now = new Date(2024, 0, 31); // 31 Jan 2024

describe("study abroad", () => {
  test("month-precision dates cover the whole month", () => {
    expect(dayOf("2024-02", "end")! - dayOf("2024-02", "start")!).toBe(28); // leap year
    expect(dayOf("2024-02-10", "start")).toBe(dayOf("2024-02-10", "end"));
    expect(dayOf("2024-13", "start")).toBeNull();
    expect(dayOf("soon", "start")).toBeNull();
  });

  test("days abroad leave out the time back home, overlaps counted once", () => {
    const p: AbroadPeriod = {
      id: "a",
      startDate: "2023-01-01",
      endDate: "2023-01-31",
      homeTrips: [
        { startDate: "2023-01-10", endDate: "2023-01-14" },
        { startDate: "2023-01-12", endDate: "2023-01-15" },
      ],
    };
    const s = summarizeAbroad(p, [], [], now);
    expect(s.status).toBe("done");
    expect(s.days).toBe(31 - 6);
    expect(s.dayNumber).toBeNull();
    expect(s.homeTrips).toBe(2);
  });

  test("an open period counts to today and knows its day number", () => {
    const s = summarizeAbroad({ id: "a", startDate: "2024-01-01" }, [], [], now);
    expect(s.status).toBe("ongoing");
    expect(s.days).toBe(31);
    expect(s.dayNumber).toBe(31);
    // Home right now: an open home trip runs to today.
    const home = summarizeAbroad({ id: "a", startDate: "2024-01-01", homeTrips: [{ startDate: "2024-01-21" }] }, [], [], now);
    expect(home.days).toBe(20);
  });

  test("a future departure counts nothing yet", () => {
    const s = summarizeAbroad({ id: "a", startDate: "2024-09" }, [], [], now);
    expect(s.status).toBe("upcoming");
    expect(s.days).toBe(0);
    expect(totalDaysAbroad([{ id: "a", startDate: "2024-09" }, { id: "b", startDate: "2023-12-02", endDate: "2023-12-31" }], now)).toBe(30);
  });

  test("places, countries, trips and activities within the period", () => {
    const tagged: Visit[] = visits.map((v) =>
      v.id === "v-paris" ? { ...v, activities: ["museum", "food"] } : v.id === "v-paris2" ? { ...v, activities: ["food"] } : v
    );
    const s = summarizeAbroad({ id: "de", startDate: "2020-08", endDate: "2024-06" }, places, tagged, now);
    expect(s.places.map((p) => p.id)).toEqual(["home", "paris"]); // Kyoto (2018) is before; Rome has no date
    expect(s.countries).toEqual(["DE", "FR"]);
    expect(s.trips).toBe(2); // the Paris trip and stopover; the residence is not a trip
    expect(s.activities).toEqual([
      { activity: "food", count: 2 },
      { activity: "museum", count: 1 },
    ]);
  });

  test("milestones: arrival, each trip home, the return — in time order", () => {
    const ms = abroadMilestones([
      { id: "b", startDate: "2025-10", label: "PhD" },
      { id: "a", startDate: "2023-10", endDate: "2025-09", label: "MSc", homeTrips: [{ startDate: "2024-07", endDate: "2024-09" }] },
    ]);
    expect(ms.map((m) => m.kind + ":" + m.periodId)).toEqual(["arrive:a", "home:a", "return:a", "arrive:b"]);
    expect(ms[0].detail).toBe("MSc");
  });

  test("bands run to now while open and cut out the home trips", () => {
    const [b] = abroadBands([{ id: "a", startDate: "2023-01", homeTrips: [{ startDate: "2023-07", endDate: "2023-08" }] }], 2024.5);
    expect(b.to).toBe(2024.5);
    expect(b.gaps).toHaveLength(1);
    expect(b.gaps[0][0]).toBeGreaterThan(b.from);
    expect(b.gaps[0][1]).toBeLessThan(b.to);
  });
});
