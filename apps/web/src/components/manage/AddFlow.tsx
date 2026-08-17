"use client";

// AddFlow is the primary creation flow (PRODUCT_SPEC §27): "+ Add" →
// "I've been here" / "I want to go here" → search location → details → save.
// Saving reuses an existing Place when possible, then creates the Visit or
// Wishlist entry, then reloads so the main Atlas updates immediately.
import { useState } from "react";
import type { Media, Place } from "../../lib/types";
import type { AtlasRepository } from "../../lib/repository";
import type { AtlasTheme } from "../../themes";
import LocationPicker, { type ResolvedLocation } from "./LocationPicker";
import VisitForm from "./VisitForm";
import WishlistForm from "./WishlistForm";
import { emptyVisitDraft, emptyWishlistDraft, type VisitDraft, type WishlistDraft } from "./drafts";
import { resolvePlaceId, visitFromDraft, wishlistFromDraft } from "./save";
import { Btn } from "./FormUI";

export type AddKind = "visit" | "wishlist";

interface AddFlowProps {
  kind: AddKind;
  places: Place[];
  media: Media[];
  theme: AtlasTheme;
  repo: AtlasRepository;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export default function AddFlow({ kind, places, media, theme, repo, onDone, onCancel }: AddFlowProps) {
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null);
  const [visit, setVisit] = useState<VisitDraft>(emptyVisitDraft);
  const [wishlist, setWishlist] = useState<WishlistDraft>(emptyWishlistDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isVisit = kind === "visit";

  const save = async () => {
    if (!resolved) {
      setError("Search and select a location first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { placeId, placeCreated } = await resolvePlaceId(repo, resolved);
      if (isVisit) {
        const visitRec = visitFromDraft(visit, placeId);
        await repo.createVisit(visitRec);
      } else {
        const item = wishlistFromDraft(wishlist, placeId);
        await repo.createWishlist(item);
      }
      onDone(
        (isVisit ? "Visit" : "Wishlist") +
          " saved" +
          (placeCreated ? " · new place created" : " · existing place reused") +
          "."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="atlas-addflow">
      <div className="atlas-addflow__head">
        <div>
          <div className="atlas-addflow__title">{isVisit ? "I've been here" : "I want to go here"}</div>
          <p className="atlas-form-hint">
            {isVisit
              ? "Record a visit — the Atlas adds the place to the map and timeline."
              : "Save a future destination — it appears in Where Next and the timeline when timed."}
          </p>
        </div>
        <button type="button" className="atlas-form-icon-btn" onClick={onCancel} aria-label="Close">
          &times;
        </button>
      </div>

      <LocationPicker places={places} theme={theme} onChange={setResolved} />

      {resolved ? (
        isVisit ? (
          <VisitForm
            value={visit}
            onChange={setVisit}
            media={media}
            placeId={resolved.existing?.id ?? null}
          />
        ) : (
          <WishlistForm
            value={wishlist}
            onChange={setWishlist}
            media={media}
            placeId={resolved.existing?.id ?? null}
          />
        )
      ) : null}

      {error ? <p className="atlas-locpicker__error">{error}</p> : null}

      <div className="atlas-addflow__actions">
        <Btn kind="primary" onClick={save} disabled={saving || !resolved}>
          {saving ? "Saving…" : "Save"}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}
