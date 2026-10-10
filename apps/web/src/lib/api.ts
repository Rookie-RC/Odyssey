// Thin HTTP client for the local Go runtime API. The base URL defaults to the
// same origin (the Go runtime serves the static frontend), and can be overridden
// in dev with NEXT_PUBLIC_API_BASE=http://127.0.0.1:4317.
import type { Place, Profile, Visit, Wishlist, Media, Settings } from "./types";
import type { GeocodingResult } from "./geocode";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** Fired on window whenever a data request answers 401: in cloud mode the
 * session has ended (signed out elsewhere, expired, account deleted), and
 * CloudGate returns to the sign-in screen. Never fired in local mode. */
export const UNAUTHORIZED_EVENT = "atlas:unauthorized";

function checkUnauthorized(res: Response): void {
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  checkUnauthorized(res);
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
  /** "local": one Atlas on this computer; "cloud": the multi-user web
   * service, one Atlas per signed-in account (docs/DEPLOY.md). */
  mode: "local" | "cloud";
  /** False for read-only runtimes, for requests from another device, and in
   * cloud mode while signed out. */
  writable: boolean;
  /** Local mode only. */
  port?: number;
  /** Local mode only, and only for clients on this device. */
  dataDir?: string;
  geocodingProvider: string;
  /** Cloud mode: whether this browser has a session, and for whom. */
  authenticated?: boolean;
  user?: AccountUser;
  /** Cloud mode: whether new accounts can be created. */
  allowSignup?: boolean;
}

/** The signed-in account (cloud mode). */
export interface AccountUser {
  id: string;
  email: string;
}

export interface AccountUsage {
  bytes: number;
  /** 0 = unlimited. */
  quotaBytes: number;
}

/** Account calls answer {error} on failure; surface that text as is (it is
 * shown on the sign-in screen), and never treat a wrong password (401) as
 * a lost session. */
async function authRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = (parsed as { error?: string } | null)?.error;
    throw new AuthError(msg || res.status + " " + res.statusText, res.status);
  }
  return parsed as T;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export const api = {
  getRuntime: () => request<RuntimeInfo>("/api/runtime"),

  // --- accounts (cloud mode) ---
  auth: {
    register: (email: string, password: string) =>
      authRequest<{ user: AccountUser }>("/api/auth/register", "POST", { email, password }),
    login: (email: string, password: string) =>
      authRequest<{ user: AccountUser }>("/api/auth/login", "POST", { email, password }),
    /** everywhere: also end every other session of this account. */
    logout: (everywhere = false) => authRequest<{ ok: boolean }>("/api/auth/logout", "POST", { everywhere }),
    me: () => authRequest<{ user: AccountUser; usage: AccountUsage }>("/api/auth/me", "GET"),
    changePassword: (currentPassword: string, newPassword: string) =>
      authRequest<{ user: AccountUser }>("/api/auth/password", "POST", { currentPassword, newPassword }),
    /** Permanently deletes the account and its whole Atlas. */
    deleteAccount: (password: string) =>
      authRequest<{ deleted: boolean }>("/api/auth/account", "DELETE", { password }),
  },

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
  // uploadMedia sends an image to the local runtime; the returned Media record
  // is already persisted in media.json.
  uploadMedia: (opts: {
    file: File;
    placeId?: string;
    caption?: string;
    sourceUrl?: string;
    author?: string;
    license?: string;
  }) => {
    const form = new FormData();
    form.append("file", opts.file);
    if (opts.placeId) form.append("placeId", opts.placeId);
    if (opts.caption) form.append("caption", opts.caption);
    if (opts.sourceUrl) form.append("sourceUrl", opts.sourceUrl);
    if (opts.author) form.append("author", opts.author);
    if (opts.license) form.append("license", opts.license);
    return fetch(API_BASE + "/api/media", { method: "POST", body: form }).then((res) => {
      checkUnauthorized(res);
      if (!res.ok) {
        return res.text().then((t) => {
          throw new Error(res.status + " " + res.statusText + ": " + t);
        });
      }
      return res.json() as Promise<Media>;
    });
  },
  updateMedia: (m: Media) =>
    request<Media>("/api/media/" + m.id, { method: "PUT", body: JSON.stringify(m) }),
  deleteMedia: (id: string) =>
    request<{ deleted: string }>("/api/media/" + id, { method: "DELETE" }),

  getSettings: () => request<Settings>("/api/settings"),
  saveSettings: (s: Settings) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),

  geocodeSearch: (q: string, limit = 8) =>
    request<GeocodingResult[]>(
      "/api/geocode/search?q=" + encodeURIComponent(q) + "&limit=" + limit
    ),
  geocodeReverse: (lat: number, lng: number) =>
    request<GeocodingResult | null>(
      "/api/geocode/reverse?lat=" + lat + "&lng=" + lng
    ),

  // --- portability (.atlas export / import / new) ---
  exportAtlas: async (): Promise<Blob> => {
    const res = await fetch(API_BASE + "/api/atlas/export", { method: "POST" });
    checkUnauthorized(res);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(res.status + " " + res.statusText + ": " + text);
    }
    return res.blob();
  },
  importAtlas: async (file: File): Promise<{ imported: boolean; backup: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(API_BASE + "/api/atlas/import", { method: "POST", body: form });
    checkUnauthorized(res);
    const text = await res.text();
    if (!res.ok) {
      // The runtime always creates a backup before attempting the swap, and
      // rolls back on failure, so a failed import never loses the existing
      // Atlas — the backup name is included for reference when available.
      let parsed: { error?: string; backup?: string } | null = null;
      try {
        parsed = JSON.parse(text) as { error?: string; backup?: string };
      } catch {
        // not JSON — fall through to the raw message below
      }
      if (parsed?.error) {
        throw new Error(parsed.error + (parsed.backup ? " (backup kept: " + parsed.backup + ")" : ""));
      }
      throw new Error(res.status + " " + res.statusText + ": " + text);
    }
    return JSON.parse(text) as { imported: boolean; backup: string };
  },
  newAtlas: () => request<{ created: boolean; backup: string }>("/api/atlas/new", { method: "POST" }),

  // --- automatic backups ---
  listBackups: () => request<BackupInfo[]>("/api/atlas/backups"),
  restoreBackup: (name: string) =>
    request<{ restored: boolean; backup: string }>(
      "/api/atlas/backups/" + encodeURIComponent(name) + "/restore",
      { method: "POST" }
    ),
  deleteBackup: (name: string) =>
    request<{ deleted: string }>("/api/atlas/backups/" + encodeURIComponent(name), { method: "DELETE" }),
};

/** Downscaled variant of a local media path (served by the runtime's
 * thumbnail cache). Web (remote URL) media is returned unchanged. */
export function mediaSrc(m: { path: string; source?: string }, width?: 160 | 320 | 640 | 960 | 1280 | 1920): string {
  if (!width || m.source === "web" || !m.path.startsWith("/media/")) return m.path;
  return m.path + (m.path.includes("?") ? "&" : "?") + "w=" + width;
}
