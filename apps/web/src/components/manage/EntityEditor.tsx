"use client";

// EntityEditor handles the "edit existing entry" flow for Visits, Wishlist
// items and Places. Visit/Wishlist editors show the current location (with the
// option to change it via LocationPicker) plus the entity form; saving reuses
// the existing Place unless the location actually changed.
import { useEffect, useMemo, useRef, useState } from "react";
import { getPlace } from "../../lib/domain";
import type { Visit, Wishlist } from "../../lib/types";
import LocationPicker, { type ResolvedLocation } from "./LocationPicker";
import VisitForm from "./VisitForm";
import WishlistForm from "./WishlistForm";
import { emptyVisitDraft, emptyWishlistDraft, visitToDraft, wishlistToDraft, type VisitDraft, type WishlistDraft } from "./drafts";
import { resolvePlaceId, visitFromDraft, wishlistFromDraft } from "./save";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Field, Select, TextInput } from "./FormUI";
import MiniMap from "./MiniMap";
import { PLACE_TYPES, PLACE_TYPE_LABELS } from "../../lib/places";
import type { PlaceType } from "../../lib/types";
import { HttpGeocodingProvider, type GeocodingResult } from "../../lib/geocode";
import { t } from "../../lib/i18n";

const geocodeProvider = new HttpGeocodingProvider();

type EditorKind = "visit" | "wishlist" | "place";

interface EntityEditorProps {
  kind: EditorKind;
  id: string;
  ctx: ManageContext;
  onDone: (msg: string) => void;
  onCancel: () => void;
}

export default function EntityEditor({ kind, id, ctx, onDone, onCancel }: EntityEditorProps) {
  const { places, media, theme, repo } = ctx;

  const existingVisit = useMemo(
    () => (kind === "visit" ? ctx.visits.find((v) => v.id === id) ?? null : null),
    [kind, id, ctx.visits]
  );
  const existingWishlist = useMemo(
    () => (kind === "wishlist" ? ctx.wishlist.find((w) => w.id === id) ?? null : null),
    [kind, id, ctx.wishlist]
  );
  const existingPlace = useMemo(
    () => (kind === "place" ? getPlace(places, id) : null),
    [kind, id, places]
  );

  // For visit/wishlist editing the location starts as the existing Place.
  const initialLocation = useMemo<ResolvedLocation | null>(() => {
    if (kind === "place") return null;
    const place = kind === "visit" ? (existingVisit ? getPlace(places, existingVisit.placeId) : null) : existingWishlist ? getPlace(places, existingWishlist.placeId) : null;
    if (!place) return null;
    return {
      existing: place,
      draft: {
        name: place.name,
        country: place.country,
        countryCode: place.countryCode,
        type: place.type,
        coordinates: { lat: place.coordinates.lat, lng: place.coordinates.lng },
      },
    };
  }, [kind, places, existingVisit, existingWishlist]);

  const [resolved, setResolved] = useState<ResolvedLocation | null>(initialLocation);
  const [visit, setVisit] = useState<VisitDraft>(() =>
    existingVisit ? visitToDraft(existingVisit) : emptyVisitDraft()
  );
  const [wishlist, setWishlist] = useState<WishlistDraft>(() =>
    existingWishlist ? wishlistToDraft(existingWishlist) : emptyWishlistDraft()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // --- Place editor state ---
  const [placeName, setPlaceName] = useState(existingPlace?.name ?? "");
  const [placeCountry, setPlaceCountry] = useState(existingPlace?.country ?? "");
  const [placeCountryCode, setPlaceCountryCode] = useState(existingPlace?.countryCode ?? "");
  const [placeType, setPlaceType] = useState<PlaceType>(existingPlace?.type ?? "city");
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(
    existingPlace
      ? { lat: existingPlace.coordinates.lat, lng: existingPlace.coordinates.lng }
      : null
  );

  // Search-to-update location (PRODUCT_SPEC §13: online search is the primary
  // Place input, including when editing). Country and countryCode must only
  // ever change together, or the two silently disagree (the country text is
  // freeform display metadata; countryCode drives matching/flags), so the
  // free-text Country field below is read-only and can only be updated by
  // picking a search result here.
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<GeocodingResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeSearchError, setPlaceSearchError] = useState("");
  const placeSeqRef = useRef(0);

  useEffect(() => {
    if (kind !== "place") return;
    const q = placeQuery.trim();
    if (q.length < 2) {
      setPlaceResults([]);
      setPlaceSearching(false);
      return;
    }
    placeSeqRef.current += 1;
    const seq = placeSeqRef.current;
    setPlaceSearching(true);
    setPlaceSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const res = await geocodeProvider.search(q, { limit: 8 });
        if (seq !== placeSeqRef.current) return;
        setPlaceResults(res);
      } catch (e) {
        if (seq !== placeSeqRef.current) return;
        setPlaceSearchError(e instanceof Error ? e.message : String(e));
        setPlaceResults([]);
      } finally {
        if (seq === placeSeqRef.current) setPlaceSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [placeQuery, kind]);

  const selectPlaceResult = (r: GeocodingResult) => {
    if (!r.suggestedType) return; // country-level/POI results are not Places
    setPlaceName(r.name);
    setPlaceCountry(r.country ?? "");
    setPlaceCountryCode(r.countryCode ?? "");
    setPlaceType(r.suggestedType);
    setPlaceCoords({ lat: r.coordinates.lat, lng: r.coordinates.lng });
    setPlaceQuery("");
    setPlaceResults([]);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (kind === "place") {
        if (!existingPlace) throw new Error(t("place not found"));
        if (!placeName.trim()) throw new Error(t("name is required"));
        if (!placeCoords) throw new Error(t("pick a location on the map"));
        await repo.updatePlace({
          ...existingPlace,
          name: placeName.trim(),
          country: placeCountry.trim(),
          countryCode: placeCountryCode.trim(),
          type: placeType,
          coordinates: placeCoords,
        });
        onDone(t("Place updated."));
        return;
      }
      if (!resolved) throw new Error(t("a location is required"));
      const { placeId, placeCreated } = await resolvePlaceId(repo, resolved);
      if (kind === "visit") {
        const rec = visitFromDraft(visit, placeId, existingVisit ?? undefined);
        await repo.updateVisit(rec);
        onDone(placeCreated ? t("Visit updated · new place created.") : t("Visit updated."));
      } else {
        const rec = wishlistFromDraft(wishlist, placeId, existingWishlist ?? undefined);
        await repo.updateWishlist(rec);
        onDone(placeCreated ? t("Wishlist updated · new place created.") : t("Wishlist updated."));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  if (kind === "place") {
    return (
      <div className="atlas-entity-form">
        <Field
          label={t("Search to update location")}
          hint={t("Optional — search and pick a result to update name, country and coordinates together.")}
        >
          <div className="atlas-locpicker__search">
            <input
              className="atlas-form-input"
              type="search"
              placeholder={t("e.g. Lofoten, Sardinia, Dolomites…")}
              value={placeQuery}
              onChange={(e) => setPlaceQuery(e.target.value)}
              aria-label={t("Search location")}
            />
            {placeSearching ? <span className="atlas-locpicker__spinner" aria-hidden="true" /> : null}
          </div>
        </Field>
        {placeSearchError ? <p className="atlas-locpicker__error">{placeSearchError}</p> : null}
        {placeResults.length > 0 ? (
          <ul className="atlas-locpicker__results" role="listbox">
            {placeResults.map((r, i) => (
              <li key={r.providerId ?? i} role="option">
                <button type="button" className="atlas-locpicker__result" onClick={() => selectPlaceResult(r)}>
                  <span className="atlas-locpicker__result-name">{r.name}</span>
                  <span className="atlas-locpicker__result-meta">
                    {r.displayName}
                    {r.suggestedType ? " · " + t(PLACE_TYPE_LABELS[r.suggestedType]) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <Field label={t("Name")}>
          <TextInput value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
        </Field>
        <div className="atlas-form-grid">
          <Field
            label={t("Country")}
            hint={t("Search above to change the country (code: {code}).", { code: placeCountryCode || "—" })}
          >
            <TextInput value={placeCountry} readOnly disabled />
          </Field>
          <Field label={t("Type")}>
            <Select value={placeType} onChange={(e) => setPlaceType(e.target.value as PlaceType)}>
              {PLACE_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {t(PLACE_TYPE_LABELS[pt])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("Location")} hint={t("Drag the marker or click the map to refine the coordinates.")}>
          <MiniMap
            theme={theme}
            value={placeCoords}
            onChange={(v) => setPlaceCoords(v)}
            height={220}
          />
        </Field>
        {error ? <p className="atlas-locpicker__error">{error}</p> : null}
        <div className="atlas-addflow__actions">
          <Btn kind="primary" onClick={save} disabled={saving}>
            {saving ? t("Saving…") : t("Save")}
          </Btn>
          <Btn onClick={onCancel}>{t("Cancel")}</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-entity-form">
      <LocationPicker places={places} theme={theme} initial={initialLocation} onChange={setResolved} />
      {kind === "visit" ? (
        <VisitForm
          value={visit}
          onChange={setVisit}
          media={media}
          placeId={resolved?.existing?.id ?? null}
        />
      ) : (
        <WishlistForm
          value={wishlist}
          onChange={setWishlist}
          media={media}
          placeId={resolved?.existing?.id ?? null}
        />
      )}
      {error ? <p className="atlas-locpicker__error">{error}</p> : null}
      <div className="atlas-addflow__actions">
        <Btn kind="primary" onClick={save} disabled={saving}>
          {saving ? t("Saving…") : t("Save")}
        </Btn>
        <Btn onClick={onCancel}>{t("Cancel")}</Btn>
      </div>
    </div>
  );
}
