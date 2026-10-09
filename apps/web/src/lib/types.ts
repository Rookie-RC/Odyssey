// Core Yu's Atlas domain types. These mirror the PRODUCT_SPEC domain model and
// the Go types in apps/runtime/internal/domain/domain.go.
//
// Countries are metadata (country / countryCode) on a Place; they are not
// first-class Place records and never receive map pins.

export type PlaceType = "city" | "region" | "island" | "natural_area";

export interface Place {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  type: PlaceType;
  coordinates: { lat: number; lng: number };
}

export type VisitType =
  | "lived"
  | "trip"
  | "day_trip"
  | "stopover"
  | "transit";

export interface VisitHighlight {
  name: string;
  note?: string;
}

/** How a trip was travelled (lib/transport.ts); unset means plane. */
export type Transport = "plane" | "train" | "bus" | "car";

/** What a trip was for (lib/activity.ts). The first is the primary one. */
export type Activity =
  | "sightseeing"
  | "citywalk"
  | "museum"
  | "food"
  | "shopping"
  | "concert"
  | "themepark"
  | "hiking"
  | "ski"
  | "surf"
  | "beach"
  | "picnic"
  | "aurora"
  | "backpacking"
  | "study"
  | "visiting";

export interface Visit {
  id: string;
  placeId: string;
  visitType: VisitType;
  startDate?: string;
  endDate?: string;
  withFriends?: boolean;
  transport?: Transport;
  /** What the trip was for, primary first. Known ids are `Activity`s
   * (lib/activity.ts); ids from a newer app version are kept as they are. */
  activities?: string[];
  highlights?: VisitHighlight[];
  mediaIds?: string[];
  reflection?: string;
}

export type Season = "spring" | "summer" | "autumn" | "winter";

export type InspirationType =
  | "book"
  | "movie"
  | "video"
  | "social_media"
  | "article"
  | "friend"
  | "photo"
  | "music"
  | "other";

export interface Inspiration {
  type: InspirationType;
  title?: string;
  creator?: string;
  platform?: string;
  url?: string;
  note?: string;
}

export interface TargetTime {
  year?: number;
  season?: Season;
}

export interface Wishlist {
  id: string;
  placeId: string;
  seasons?: Season[];
  targetTime?: TargetTime;
  priority?: 1 | 2 | 3 | 4 | 5;
  why?: string;
  inspirations?: Inspiration[];
  mediaIds?: string[];
  note?: string;
}

export type MediaSource = "local" | "web";

export interface Media {
  id: string;
  type: "image";
  source: MediaSource;
  path: string;
  caption?: string;
  sourceUrl?: string;
  author?: string;
  license?: string;
}

export interface Profile {
  name: string;
  avatar?: string;
  currentBase?: { placeId: string };
  bio?: string;
  interests?: string[];
  links?: { label: string; url: string }[];
  /** Stretches of life spent studying abroad (lib/abroad.ts). */
  abroad?: AbroadPeriod[];
}

/** A start date ("YYYY-MM" or "YYYY-MM-DD") with an optional end. */
export interface DateSpan {
  startDate: string;
  endDate?: string;
}

/** One stay abroad — a degree, an exchange semester (留学). */
export interface AbroadPeriod {
  id: string;
  /** e.g. "TUM · MSc", "Erasmus in Lyon". */
  label?: string;
  /** Arrival abroad. */
  startDate: string;
  /** The final return home; unset while still abroad. */
  endDate?: string;
  /** Times back home in between (holidays). */
  homeTrips?: DateSpan[];
}

export interface Settings {
  /** Theme preference: "auto" | "light" | "night" | "journal" | "minimal" | "film". */
  theme?: string;
  geocodingProvider?: string;
  defaultMapPosition?: { lat: number; lng: number };
  lanSharing?: boolean;
  /** Chronological route layer visibility on the Hero Map (v1.2). */
  showRoutes?: boolean;
  /** Wishlist pins on the Hero Map (off by default: VISUAL_SPEC §3 keeps
   * future places off the default hero). */
  showWishlist?: boolean;
  /** Hide the visited-country fill. */
  hideCountries?: boolean;
  /** Interface language preference: "auto" | "en" | "zh". */
  language?: string;
}
