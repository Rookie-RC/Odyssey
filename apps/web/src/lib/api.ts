// Thin HTTP client for the local Go runtime API. The base URL defaults to the
// same origin (the Go runtime serves the static frontend), and can be overridden
// in dev with NEXT_PUBLIC_API_BASE=http://127.0.0.1:4317.
import type { Place, Profile, Visit, Wishlist, Media } from "./types";
import type { GeocodingResult } from "./geocode";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(res.status + " " + res.statusText + ": " + text);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export interface RuntimeInfo {
  mode: string;
  writable: boolean;
  port: number;
  dataDir: string;
  geocodingProvider: string;
}

export const api = {
  getRuntime: () => request<RuntimeInfo>("/api/runtime"),

  getProfile: () => request<Profile>("/api/profile"),
  saveProfile: (p: Profile) =>
    request<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(p) }),

  getPlaces: () => request<Place[]>("/api/places"),
  createPlace: (p: Place) =>
    request<Place>("/api/places", { method: "POST", body: JSON.stringify(p) }),
  updatePlace: (p: Place) =>
    request<Place>("/api/places/" + p.id, {
      method: "PUT",
      body: JSON.stringify(p),
    }),
  deletePlace: (id: string) =>
    request<{ deleted: string }>("/api/places/" + id, { method: "DELETE" }),

  getVisits: () => request<Visit[]>("/api/visits"),
  createVisit: (v: Visit) =>
    request<Visit>("/api/visits", { method: "POST", body: JSON.stringify(v) }),
  updateVisit: (v: Visit) =>
    request<Visit>("/api/visits/" + v.id, {
      method: "PUT",
      body: JSON.stringify(v),
    }),
  deleteVisit: (id: string) =>
    request<{ deleted: string }>("/api/visits/" + id, { method: "DELETE" }),

  getWishlist: () => request<Wishlist[]>("/api/wishlist"),
  createWishlist: (w: Wishlist) =>
    request<Wishlist>("/api/wishlist", { method: "POST", body: JSON.stringify(w) }),
  updateWishlist: (w: Wishlist) =>
    request<Wishlist>("/api/wishlist/" + w.id, {
      method: "PUT",
      body: JSON.stringify(w),
    }),
  deleteWishlist: (id: string) =>
    request<{ deleted: string }>("/api/wishlist/" + id, { method: "DELETE" }),

  getMedia: () => request<Media[]>("/api/media"),

  geocodeSearch: (q: string, limit = 8) =>
    request<GeocodingResult[]>(
      "/api/geocode/search?q=" + encodeURIComponent(q) + "&limit=" + limit
    ),
  geocodeReverse: (lat: number, lng: number) =>
    request<GeocodingResult | null>(
      "/api/geocode/reverse?lat=" + lat + "&lng=" + lng
    ),
};
