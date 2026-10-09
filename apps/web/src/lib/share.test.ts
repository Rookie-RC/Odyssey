import { describe, expect, test } from "vitest";
import {
  countryTicket,
  journeyTicket,
  placeCode,
  sharableCountries,
  sharableTrips,
  ticketNumber,
  tripTicket,
  visitDays,
} from "./share";
import { places, profile, visits, wishlist } from "./fixtures.test-helpers";

const records = { places, visits, wishlist, profile, media: [] };

describe("ticket data", () => {
  test("place codes read like an airport board", () => {
    expect(placeCode("Amsterdam")).toBe("AMS");
    expect(placeCode("Jülich / Aachen")).toBe("JUL");
    expect(placeCode("Île de Ré")).toBe("ILE");
    expect(placeCode("杭州")).toBe("杭州");
    expect(placeCode("Ys")).toBe("YS");
  });

  test("days only when both ends carry a day", () => {
    expect(visitDays({ startDate: "2025-11-10", endDate: "2025-11-15" })).toBe(6);
    expect(visitDays({ startDate: "2025-11", endDate: "2025-12" })).toBeNull();
    expect(visitDays({ startDate: "2025-11-10" })).toBeNull();
  });

  test("ticket numbers are stable and distinct", () => {
    expect(ticketNumber("trip:a")).toBe(ticketNumber("trip:a"));
    expect(ticketNumber("trip:a")).not.toBe(ticketNumber("trip:b"));
    expect(ticketNumber("x")).toMatch(/^YA-[0-9A-Z]{6}$/);
  });

  test("a trip sets out from the residence of its time", () => {
    const paris = tripTicket("v-paris", records)!;
    expect(paris.leg.from?.id).toBe("home");
    expect(paris.leg.mode).toBe("plane");
    expect(paris.leg.days).toBe(5);
    expect(tripTicket("v-kyoto", records)!.leg.from?.id).toBe("old-home");
    expect(tripTicket("v-rome", records)!.leg.from).toBeNull(); // undated: no origin is guessed
    expect(tripTicket("nope", records)).toBeNull();
  });

  test("a country pass lists every visit there, oldest first, cities once", () => {
    const fr = countryTicket("fr", records)!;
    expect(fr.legs.map((l) => l.visit.id)).toEqual(["v-paris", "v-paris2"]);
    expect(fr.cities.map((c) => c.id)).toEqual(["paris"]);
    expect(fr.since).toBe(2023);
    expect(countryTicket("NO", records)).toBeNull(); // wishlist only
  });

  test("the journey pass holds journeys, not residences, newest first", () => {
    const j = journeyTicket(records);
    expect(j.home?.id).toBe("home");
    expect(j.legs.some((l) => l.visitType === "lived")).toBe(false);
    expect(j.legs[0].visit.id).toBe("v-paris2");
    expect(j.facts.countries.length).toBe(5);
  });

  test("pickers: countries by size, trips by recency", () => {
    expect(sharableCountries(places, visits)[0]).toEqual({ code: "CN", name: "CN", places: 1 });
    expect(sharableTrips(places, visits)[0].visit.id).toBe("v-paris2");
  });
});
