"use client";

// Phase 1 development UI: proves the frontend <-> Go runtime integration.
// This is intentionally minimal; the final Atlas visual product is out of scope.
import { useCallback, useEffect, useState } from "react";
import { api, type RuntimeInfo } from "../lib/api";
import type { GeocodingResult } from "../lib/geocode";
import type { Place, Profile, Visit, Wishlist } from "../lib/types";

function placeName(places: Place[], id: string): string {
  const p = places.find((x) => x.id === id);
  return p ? p.name : id;
}

export default function DevDashboard() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [wishlist, setWishlist] = useState<Wishlist[]>([]);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [r, p, pl, v, w] = await Promise.all([
        api.getRuntime(),
        api.getProfile(),
        api.getPlaces(),
        api.getVisits(),
        api.getWishlist(),
      ]);
      setRuntime(r);
      setProfile(p);
      setPlaces(pl);
      setVisits(v);
      setWishlist(w);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Debounced geocode search (~400ms, minimum 2 chars).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.geocodeSearch(q);
        setResults(res);
      } catch (e) {
        setResults([]);
        setNotice("Geocode error: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function saveAsPlace(r: GeocodingResult) {
    if (!r.suggestedType) {
      setNotice("Country-level results cannot be saved as Places.");
      return;
    }
    try {
      const place: Place = {
        id: "",
        name: r.name,
        country: r.country ?? "",
        countryCode: r.countryCode ?? "",
        type: r.suggestedType,
        coordinates: r.coordinates,
      };
      const created = await api.createPlace(place);
      setNotice(
        "Saved place: " + created.name + " (" + created.country + ", " + created.countryCode + ")"
      );
      setQuery("");
      setResults([]);
      await loadData();
    } catch (e) {
      setNotice("Save failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 border-b pb-6" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-3xl font-semibold tracking-tight">Yu's Atlas</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Phase 1 foundation &mdash; local runtime integration
        </p>
      </header>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          {notice}
        </div>
      ) : null}

      {/* Runtime */}
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Runtime</h2>
        {runtime ? (
          <dl className="grid grid-cols-2 gap-2 rounded-lg border p-4 text-sm sm:grid-cols-5" style={{ borderColor: "var(--border)" }}>
            <div>
              <dt className="text-xs uppercase" style={{ color: "var(--text-secondary)" }}>Mode</dt>
              <dd>{runtime.mode}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase" style={{ color: "var(--text-secondary)" }}>Writable</dt>
              <dd>{runtime.writable ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase" style={{ color: "var(--text-secondary)" }}>Port</dt>
              <dd>{runtime.port}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase" style={{ color: "var(--text-secondary)" }}>Geocoder</dt>
              <dd>{runtime.geocodingProvider}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs uppercase" style={{ color: "var(--text-secondary)" }}>Data dir</dt>
              <dd className="truncate">{runtime.dataDir}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm">Loading&hellip;</p>
        )}
      </section>

      {/* Geocode search + write */}
      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Add a place (online geocode)</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          Search Photon via the local runtime. Country-level results are filtered out and
          cannot be saved as Places; country metadata is preserved on every result.
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search location (e.g. Bordeaux, Sardinia, Dolomites)"
          className="w-full rounded-lg border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
          style={{ borderColor: "var(--border)" }}
        />
        {searching ? (
          <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>Searching&hellip;</p>
        ) : null}
        {results.length > 0 ? (
          <ul className="mt-3 divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
            {results.map((r) => (
              <li key={r.providerId ?? r.displayName + r.coordinates.lat + r.coordinates.lng} className="flex items-center justify-between gap-4 p-3">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {r.displayName} &middot; {r.countryCode} &middot;{" "}
                    {r.suggestedType ?? "country (not saveable)"}
                  </div>
                </div>
                <button
                  onClick={() => saveAsPlace(r)}
                  disabled={!r.suggestedType}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Save as Place
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim().length >= 2 && !searching ? (
          <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            No destination-scale results.
          </p>
        ) : null}
      </section>

      {/* Data */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <DataColumn
          title={"Places (" + places.length + ")"}
          rows={places.map((p) => ({
            key: p.id,
            head: p.name,
            meta: p.country + " (" + p.countryCode + ") &middot; " + p.type,
            sub: p.coordinates.lat.toFixed(3) + ", " + p.coordinates.lng.toFixed(3),
          }))}
        />
        <DataColumn
          title={"Visits (" + visits.length + ")"}
          rows={visits.map((v) => ({
            key: v.id,
            head: placeName(places, v.placeId),
            meta: v.visitType + (v.startDate ? " &middot; " + v.startDate : ""),
            sub: v.reflection ?? "",
          }))}
        />
        <DataColumn
          title={"Wishlist (" + wishlist.length + ")"}
          rows={wishlist.map((w) => ({
            key: w.id,
            head: placeName(places, w.placeId),
            meta: (w.seasons ?? []).join(", ") + (w.priority ? " &middot; P" + w.priority : ""),
            sub: w.why ?? "",
          }))}
        />
      </section>

      {profile ? (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-semibold">Profile</h2>
          <div className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="font-medium">{profile.name}</div>
            <div style={{ color: "var(--text-secondary)" }}>{profile.bio}</div>
            {profile.currentBase ? (
              <div className="mt-1 text-xs">
                Base: {placeName(places, profile.currentBase.placeId)}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function DataColumn({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; head: string; meta: string; sub?: string }[];
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">{title}</h2>
      <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
        {rows.map((row) => (
          <li key={row.key} className="p-3">
            <div className="text-sm font-medium">{row.head}</div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <span dangerouslySetInnerHTML={{ __html: row.meta }} />
            </div>
            {row.sub ? (
              <div className="mt-1 text-xs italic" style={{ color: "var(--text-secondary)" }}>
                {row.sub}
              </div>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? <li className="p-3 text-sm">None</li> : null}
      </ul>
    </div>
  );
}
