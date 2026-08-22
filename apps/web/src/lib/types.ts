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

export interface Visit {
  id: string;
  placeId: string;
  visitType: VisitType;
  startDate?: string;
  endDate?: string;
  withFriends?: boolean;
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
}

export interface Settings {
  theme?: string;
  geocodingProvider?: string;
  defaultMapPosition?: { lat: number; lng: number };
  lanSharing?: boolean;
  /** Chronological route layer visibility on the Hero Map (v1.2). */
  showRoutes?: boolean;
}
