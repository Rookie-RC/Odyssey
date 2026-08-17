// Provider-neutral geocoding abstraction for the frontend. The UI depends on
// this interface (and the normalized GeocodingResult), never on a vendor.
import type { PlaceType } from "./types";
import { api } from "./api";

export interface GeocodingSearchOptions {
  limit?: number;
}

export interface GeocodingResult {
  name: string;
  displayName: string;
  country?: string;
  countryCode?: string;
  suggestedType?: PlaceType;
  coordinates: { lat: number; lng: number };
  bbox?: [number, number, number, number];
  provider: string;
  providerId?: string;
}

export interface GeocodingProvider {
  id: string;
  search(
    query: string,
    options?: GeocodingSearchOptions
  ): Promise<GeocodingResult[]>;
  reverse?(lat: number, lng: number): Promise<GeocodingResult | null>;
}

// HttpGeocodingProvider talks to the local Go runtime, which in turn talks to
// the configured provider (Photon by default). No vendor logic lives here.
export class HttpGeocodingProvider implements GeocodingProvider {
  readonly id = "runtime";

  search(query: string, options?: GeocodingSearchOptions): Promise<GeocodingResult[]> {
    return api.geocodeSearch(query, options?.limit);
  }

  reverse(lat: number, lng: number): Promise<GeocodingResult | null> {
    return api.geocodeReverse(lat, lng);
  }
}
