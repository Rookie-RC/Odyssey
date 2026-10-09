// Small fixtures shared by the lib/ unit tests.
import type { Place, Profile, Visit, Wishlist } from "./types";

export const place = (id: string, cc: string, lat = 50, lng = 6, name = id): Place => ({
  id,
  name,
  country: cc,
  countryCode: cc,
  type: "city",
  coordinates: { lat, lng },
});

export const places: Place[] = [
  place("home", "DE", 50.9, 6.4, "Jülich"),
  place("old-home", "CN", 30.3, 120.2, "Hangzhou"),
  place("paris", "FR", 48.9, 2.35, "Paris"),
  place("rome", "IT", 41.9, 12.5, "Rome"),
  place("kyoto", "JP", 35.0, 135.8, "Kyoto"),
  place("lofoten", "NO", 68.2, 13.6, "Lofoten"),
  place("lisbon", "PT", 38.7, -9.1, "Lisbon"),
];

export const visits: Visit[] = [
  { id: "v-old", placeId: "old-home", visitType: "lived", startDate: "2015-09", endDate: "2020-07" },
  { id: "v-home", placeId: "home", visitType: "lived", startDate: "2020-08-01" },
  { id: "v-kyoto", placeId: "kyoto", visitType: "trip", startDate: "2018-04-02", endDate: "2018-04-09" },
  { id: "v-paris", placeId: "paris", visitType: "trip", startDate: "2023-06-01", endDate: "2023-06-05", mediaIds: ["m1"] },
  { id: "v-paris2", placeId: "paris", visitType: "stopover", startDate: "2024-01-10" },
  { id: "v-rome", placeId: "rome", visitType: "day_trip" },
];

export const wishlist: Wishlist[] = [
  { id: "w-lofoten", placeId: "lofoten", seasons: ["summer"], targetTime: { season: "summer" }, priority: 5 },
  { id: "w-lisbon", placeId: "lisbon", seasons: ["spring", "autumn"], priority: 4 },
  { id: "w-kyoto", placeId: "kyoto", targetTime: { year: 2027, season: "autumn" }, priority: 2 },
];

export const profile: Profile = { name: "Yu", currentBase: { placeId: "home" } };
