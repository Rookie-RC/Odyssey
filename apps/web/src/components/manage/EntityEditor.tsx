"use client";

// EntityEditor handles the "edit existing entry" flow for Visits, Wishlist
// items and Places. Visit/Wishlist editors show the current location (with the
// option to change it via LocationPicker) plus the entity form; saving reuses
// the existing Place unless the location actually changed.
import { useMemo, useState } from "react";
import { getPlace } from "../../lib/domain";
import type { Visit, Wishlist } from "../../lib/types";
import LocationPicker, { type ResolvedLocation } from "./LocationPicker";
import VisitForm from "./VisitForm";
import WishlistForm from "./WishlistForm";
import { emptyVisitDraft, emptyWishlistDraft, type VisitDraft, type WishlistDraft } from "./drafts";
import { resolvePlaceId, visitFromDraft, wishlistFromDraft } from "./save";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Field, Select, TextInput } from "./FormUI";
import MiniMap from "./MiniMap";
import { PLACE_TYPES, PLACE_TYPE_LABELS } from "../../lib/places";
import type { PlaceType } from "../../lib/types";

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
    existingVisit ? visitFromDraftToUi(existingVisit) : emptyVisitDraft()
  );
  const [wishlist, setWishlist] = useState<WishlistDraft>(() =>
    existingWishlist ? wishlistFromDraftToUi(existingWishlist) : emptyWishlistDraft()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // --- Place editor state ---
  const [placeName, setPlaceName] = useState(existingPlace?.name ?? "");
  const [placeCountry, setPlaceCountry] = useState(existingPlace?.country ?? "");
  const [placeType, setPlaceType] = useState<PlaceType>(existingPlace?.type ?? "city");
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lng: number } | null>(
    existingPlace
      ? { lat: existingPlace.coordinates.lat, lng: existingPlace.coordinates.lng }
      : null
  );

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (kind === "place") {
        if (!existingPlace) throw new Error("place not found");
        if (!placeName.trim()) throw new Error("name is required");
        if (!placeCoords) throw new Error("pick a location on the map");
        await repo.updatePlace({
          ...existingPlace,
          name: placeName.trim(),
          country: placeCountry.trim(),
          type: placeType,
          coordinates: placeCoords,
        });
        onDone("Place updated.");
        return;
      }
      if (!resolved) throw new Error("a location is required");
      const { placeId, placeCreated } = await resolvePlaceId(repo, resolved);
      if (kind === "visit") {
        const rec = visitFromDraft(visit, placeId, existingVisit ?? undefined);
        await repo.updateVisit(rec);
        onDone("Visit updated" + (placeCreated ? " · new place created." : "."));
      } else {
        const rec = wishlistFromDraft(wishlist, placeId, existingWishlist ?? undefined);
        await repo.updateWishlist(rec);
        onDone("Wishlist updated" + (placeCreated ? " · new place created." : "."));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  if (kind === "place") {
    return (
      <div className="atlas-entity-form">
        <Field label="Name">
          <TextInput value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
        </Field>
        <div className="atlas-form-grid">
          <Field label="Country">
            <TextInput value={placeCountry} onChange={(e) => setPlaceCountry(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={placeType} onChange={(e) => setPlaceType(e.target.value as PlaceType)}>
              {PLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLACE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Location" hint="Drag the marker to refine the coordinates.">
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
            {saving ? "Saving…" : "Save"}
          </Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
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
          {saving ? "Saving…" : "Save"}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// --- draft conversions (UI strings back to drafts for editing) ---

function visitFromDraftToUi(v: Visit): VisitDraft {
  return {
    visitType: v.visitType,
    startDate: v.startDate ?? "",
    endDate: v.endDate ?? "",
    withFriends: v.withFriends ?? false,
    highlights: (v.highlights ?? []).map((h) => ({ name: h.name, note: h.note ?? "" })),
    reflection: v.reflection ?? "",
    mediaIds: v.mediaIds ?? [],
  };
}

function wishlistFromDraftToUi(w: Wishlist): WishlistDraft {
  return {
    seasons: w.seasons ?? [],
    targetYear: w.targetTime?.year != null ? String(w.targetTime.year) : "",
    targetSeason: w.targetTime?.season ?? "",
    priority: w.priority != null ? String(w.priority) : "",
    why: w.why ?? "",
    note: w.note ?? "",
    inspirations: (w.inspirations ?? []).map((i) => ({
      type: i.type,
      title: i.title ?? "",
      creator: i.creator ?? "",
      platform: i.platform ?? "",
      url: i.url ?? "",
      note: i.note ?? "",
    })),
    mediaIds: w.mediaIds ?? [],
  };
}
