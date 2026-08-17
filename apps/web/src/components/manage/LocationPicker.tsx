"use client";

// LocationPicker is the primary Place input for Manage Atlas (PRODUCT_SPEC §13,
// VISUAL_SPEC §16): an online autocomplete search whose selected result fills
// name/country/countryCode/coordinates/suggested type, shown on a MiniMap the
// user can refine by dragging the marker or clicking. The picker also detects
// existing Places so a Visit/Wishlist reuses them instead of duplicating.
import { useCallback, useEffect, useRef, useState } from "react";
import type { GeocodingResult } from "../../lib/geocode";
import { HttpGeocodingProvider } from "../../lib/geocode";
import { findMatchingPlace, newPlaceFromResult, PLACE_TYPES, PLACE_TYPE_LABELS } from "../../lib/places";
import type { Place, PlaceType } from "../../lib/types";
import type { AtlasTheme } from "../../themes";
import MiniMap from "./MiniMap";
import { Field, Select } from "./FormUI";

export interface ResolvedLocation {
  /** Existing Place when one matched (reuse), otherwise null. */
  existing: Place | null;
  /** Draft Place fields used when creating a new Place. */
  draft: Omit<Place, "id">;
}

interface LocationPickerProps {
  places: Place[];
  theme: AtlasTheme;
  /** Initial location (when editing an existing entry). */
  initial?: ResolvedLocation | null;
  onChange: (loc: ResolvedLocation | null) => void;
}

const provider = new HttpGeocodingProvider();

export default function LocationPicker({
  places,
  theme,
  initial,
  onChange,
}: LocationPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [resolved, setResolved] = useState<ResolvedLocation | null>(initial ?? null);
  const [type, setType] = useState<PlaceType>(initial?.draft.type ?? "city");

  const seqRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-derive the draft when the Place type changes.
  useEffect(() => {
    if (!resolved) return;
    const next: ResolvedLocation = { ...resolved, draft: { ...resolved.draft, type } };
    setResolved(next);
    onChangeRef.current(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Debounced search (spec: 300–500 ms, min 2–3 chars, stale results cancelled).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setOpen(false);
      return;
    }
    seqRef.current += 1;
    const seq = seqRef.current;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const res = await provider.search(q, { limit: 8 });
        if (seq !== seqRef.current) return;
        setResults(res);
        setOpen(true);
      } catch (e) {
        if (seq !== seqRef.current) return;
        setSearchError(e instanceof Error ? e.message : String(e));
        setResults([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const selectResult = useCallback(
    (r: GeocodingResult) => {
      if (!r.suggestedType) return; // country-level/POI results are not Places
      setQuery("");
      setOpen(false);
      setResults([]);
      setHighlight(-1);
      const t = r.suggestedType;
      setType(t);
      const existing = findMatchingPlace(places, r);
      const draft = newPlaceFromResult(r, t);
      setResolved({ existing, draft });
      onChangeRef.current({ existing, draft });
    },
    [places]
  );

  // Refine coordinates from the mini-map.
  const onMapChange = useCallback(
    (v: { lat: number; lng: number }) => {
      setResolved((prev) => {
        if (!prev) return prev;
        const next: ResolvedLocation = {
          ...prev,
          draft: { ...prev.draft, coordinates: { lat: v.lat, lng: v.lng } },
        };
        onChangeRef.current(next);
        return next;
      });
    },
    []
  );

  const clear = useCallback(() => {
    setResolved(null);
    setQuery("");
    onChangeRef.current(null);
  }, []);

  const resolvedDraft = resolved?.draft ?? null;

  return (
    <div className="atlas-locpicker">
      <Field label="Search location" hint="Search for a city, region, island or natural area.">
        <div className="atlas-locpicker__search">
          <input
            className="atlas-form-input"
            type="search"
            placeholder="e.g. Lofoten, Sardinia, Dolomites…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const r = results[highlight >= 0 ? highlight : 0];
                if (r) selectResult(r);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            aria-expanded={open}
            aria-label="Search location"
          />
          {searching ? <span className="atlas-locpicker__spinner" aria-hidden="true" /> : null}
        </div>
      </Field>

      {searchError ? <p className="atlas-locpicker__error">{searchError}</p> : null}

      {open && results.length > 0 ? (
        <ul className="atlas-locpicker__results" role="listbox">
          {results.map((r, i) => (
            <li key={r.providerId ?? i} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                className={
                  "atlas-locpicker__result" + (i === highlight ? " atlas-locpicker__result--hl" : "")
                }
                onMouseEnter={() => setHighlight(i)}
                onClick={() => selectResult(r)}
              >
                <span className="atlas-locpicker__result-name">{r.name}</span>
                <span className="atlas-locpicker__result-meta">
                  {r.displayName}
                  {r.suggestedType ? " · " + PLACE_TYPE_LABELS[r.suggestedType] : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && !searching && results.length === 0 && !searchError ? (
        <p className="atlas-locpicker__empty">No destination-scale results. Try a city, region or island.</p>
      ) : null}

      {resolvedDraft ? (
        <div className="atlas-locpicker__resolved">
          <div className="atlas-locpicker__chosen">
            <div>
              <div className="atlas-locpicker__chosen-name">{resolvedDraft.name}</div>
              <div className="atlas-locpicker__chosen-meta">
                {resolvedDraft.country}
                {resolvedDraft.countryCode ? " (" + resolvedDraft.countryCode + ")" : ""}
                {" · " + PLACE_TYPE_LABELS[resolvedDraft.type]}
              </div>
            </div>
            <button type="button" className="atlas-form-icon-btn" onClick={clear} aria-label="Clear location">
              &times;
            </button>
          </div>

          {resolved?.existing ? (
            <p className="atlas-locpicker__reuse">Existing place reused — no duplicate will be created.</p>
          ) : null}

          <MiniMap
            theme={theme}
            value={resolvedDraft.coordinates}
            onChange={onMapChange}
            height={200}
          />

          <Field label="Place type" hint="Manually correct the type if the provider's guess is off.">
            <Select value={type} onChange={(e) => setType(e.target.value as PlaceType)}>
              {PLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLACE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
    </div>
  );
}
