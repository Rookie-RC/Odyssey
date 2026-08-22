"use client";

// Direct Edit (v1.1): edit the content of an open Detail Sheet in place.
// View mode → Edit → change fields → Save → back to View mode. No separate
// edit page and no contenteditable: the form is a set of explicit controls
// bound to the existing domain layer, and Save goes through the exact same
// repository/API path Manage Atlas uses (repo.updateVisit / updateWishlist /
// updateMedia → Go runtime → atlas-data). The parent reloads after Save so
// derived views (Timeline, Where Next, Map) refresh from the same data.
//
// The form reuses the Manage Atlas field forms (VisitForm / WishlistForm) with
// their built-in media picker hidden, plus a dedicated media section offering
// the lightweight actions the spec asks for: add, remove association,
// replace/select cover (order in the mediaIds list — the existing model's
// cover rule), edit captions (via updateMedia), and reorder. Media files are
// never deleted here; only associations change.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Media, Visit, Wishlist } from "../../lib/types";
import type { PlaceStory } from "../../lib/domain";
import type { AtlasRepository } from "../../lib/repository";
import VisitForm from "../manage/VisitForm";
import WishlistForm from "../manage/WishlistForm";
import MediaPicker from "../manage/MediaPicker";
import { Btn, TextInput } from "../manage/FormUI";
import {
  visitToDraft,
  wishlistToDraft,
  visitDraftEquals,
  wishlistDraftEquals,
  type VisitDraft,
  type WishlistDraft,
} from "../manage/drafts";
import { visitFromDraft, wishlistFromDraft } from "../manage/save";

export interface DirectEditProps {
  story: PlaceStory;
  /** Full media library (used by the add-photos picker). */
  media: Media[];
  repo: AtlasRepository;
  /** Reports whether the form currently holds unsaved changes. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called after a successful save (parent reloads and exits edit mode). */
  onSaved: () => void;
  /** Called when the user presses Cancel (the sheet decides whether a
   * discard confirmation is needed). */
  onCancel: () => void;
}

function combinedMediaIds(visit: Visit | null, wishlist: Wishlist | null): string[] {
  const out: string[] = [];
  if (visit) (visit.mediaIds ?? []).forEach((id) => out.push(id));
  if (wishlist) (wishlist.mediaIds ?? []).forEach((id) => out.push(id));
  return out;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export default function DirectEdit({
  story,
  media,
  repo,
  onDirtyChange,
  onSaved,
  onCancel,
}: DirectEditProps) {
  const { place, primaryVisit, wishlist } = story;

  const [visit, setVisit] = useState<VisitDraft | null>(() =>
    primaryVisit ? visitToDraft(primaryVisit) : null
  );
  const [wl, setWl] = useState<WishlistDraft | null>(() =>
    wishlist ? wishlistToDraft(wishlist) : null
  );

  // The media association is edited as one ordered list for the place (the
  // view already displays a place's media as a flat, ordered set, and the
  // first item is the cover). Saving writes the same list to the visit and/or
  // wishlist record so the derived cover rule stays consistent.
  const [mediaIds, setMediaIds] = useState<string[]>(() =>
    combinedMediaIds(primaryVisit, wishlist)
  );
  // Caption drafts for the currently associated media (persisted on Save via
  // updateMedia; discarded on Cancel like every other edit).
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const id of combinedMediaIds(primaryVisit, wishlist)) {
      const m = media.find((x) => x.id === id);
      if (m) out[id] = m.caption ?? "";
    }
    return out;
  });

  // Local media library = the prop plus anything uploaded during this edit
  // (uploads persist to the runtime immediately, like Manage Atlas; the local
  // list only keeps the picker in sync without a full reload).
  const [lib, setLib] = useState<Media[]>(media);
  const mediaById = useMemo(() => new Map(lib.map((m) => [m.id, m])), [lib]);

  const initialVisit = useRef(visit);
  const initialWl = useRef(wl);
  const initialMediaIds = useRef(mediaIds);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const dirty = useMemo(() => {
    if (visit && initialVisit.current && !visitDraftEquals(visit, initialVisit.current)) return true;
    if (wl && initialWl.current && !wishlistDraftEquals(wl, initialWl.current)) return true;
    if (!arraysEqual(mediaIds, initialMediaIds.current)) return true;
    // Captions only count as dirty when the user actually edited them (an
    // entry exists in the drafts map); untouched captions never mark the form
    // dirty and are never written on Save.
    for (const id of mediaIds) {
      const m = mediaById.get(id);
      const draftCap = captions[id];
      if (!m || draftCap === undefined) continue;
      if (draftCap.trim() !== (m.caption ?? "")) return true;
    }
    return false;
  }, [visit, wl, mediaIds, captions, mediaById]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const moveMedia = (id: string, dir: -1 | 1) => {
    const i = mediaIds.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= mediaIds.length) return;
    const next = [...mediaIds];
    const [x] = next.splice(i, 1);
    next.splice(j, 0, x);
    setMediaIds(next);
  };

  const setCover = (id: string) => {
    setMediaIds([id, ...mediaIds.filter((x) => x !== id)]);
  };

  const removeMedia = (id: string) => {
    setMediaIds(mediaIds.filter((x) => x !== id));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // Caption/metadata edits for the still-associated media (shared Media
      // records — updateMedia is safe because we never delete files here).
      // Only caption entries the user actually edited are written, so simply
      // associating an existing photo never touches its existing metadata.
      for (const id of mediaIds) {
        const m = mediaById.get(id);
        const draftCap = captions[id];
        if (!m || draftCap === undefined) continue;
        const cap = draftCap.trim();
        if ((m.caption ?? "") !== cap) {
          await repo.updateMedia({ ...m, caption: cap || undefined });
        }
      }
      // Only touch the association lists when the user actually changed them:
      // editing text fields alone must not rewrite another entity's mediaIds.
      const mediaChanged = !arraysEqual(mediaIds, initialMediaIds.current);
      if (visit && primaryVisit) {
        const rec = mediaChanged
          ? visitFromDraft({ ...visit, mediaIds }, primaryVisit.placeId, primaryVisit)
          : visitFromDraft(visit, primaryVisit.placeId, primaryVisit);
        await repo.updateVisit(rec);
      }
      if (wl && wishlist) {
        const rec = mediaChanged
          ? wishlistFromDraft({ ...wl, mediaIds }, wishlist.placeId, wishlist)
          : wishlistFromDraft(wl, wishlist.placeId, wishlist);
        await repo.updateWishlist(rec);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="atlas-entity-form atlas-direct">
      {visit && primaryVisit ? (
        <div className="atlas-direct__group">
          {wl ? <h4 className="atlas-direct__group-title">Memory</h4> : null}
          <VisitForm
            value={visit}
            onChange={setVisit}
            media={lib}
            placeId={place.id}
            hidePhotos
          />
        </div>
      ) : null}

      {wl && wishlist ? (
        <div className="atlas-direct__group">
          {visit ? <h4 className="atlas-direct__group-title">Wishlist</h4> : null}
          <WishlistForm
            value={wl}
            onChange={setWl}
            media={lib}
            placeId={place.id}
            hideImages
          />
        </div>
      ) : null}

      {/* --- photos: add / remove / cover / caption / reorder --- */}
      <div className="atlas-direct__group">
        <h4 className="atlas-direct__group-title">Photos</h4>
        {mediaIds.length === 0 ? (
          <p className="atlas-form-hint">No photos associated yet.</p>
        ) : (
          <div className="atlas-direct-media">
            {mediaIds.map((id, i) => {
              const m = mediaById.get(id);
              if (!m) return null;
              return (
                <div key={id} className="atlas-direct-media__item">
                  <img
                    src={m.path}
                    alt={m.caption ?? ""}
                    draggable={false}
                    loading="lazy"
                  />
                  <div className="atlas-direct-media__meta">
                    <TextInput
                      placeholder="Caption"
                      value={captions[id] ?? m.caption ?? ""}
                      onChange={(e) => setCaptions({ ...captions, [id]: e.target.value })}
                      aria-label={"Caption for " + (m.caption ?? "photo")}
                    />
                    <div className="atlas-direct-media__actions">
                      <button
                        type="button"
                        className="atlas-direct-media__btn"
                        title="Move earlier"
                        aria-label="Move earlier"
                        disabled={i === 0}
                        onClick={() => moveMedia(id, -1)}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        className="atlas-direct-media__btn"
                        title="Move later"
                        aria-label="Move later"
                        disabled={i === mediaIds.length - 1}
                        onClick={() => moveMedia(id, 1)}
                      >
                        →
                      </button>
                      {i === 0 ? (
                        <span className="atlas-direct-media__cover-label">Cover</span>
                      ) : (
                        <button
                          type="button"
                          className="atlas-direct-media__btn atlas-direct-media__btn--cover"
                          title="Use as cover"
                          aria-label="Use as cover"
                          onClick={() => setCover(id)}
                        >
                          Cover
                        </button>
                      )}
                      <button
                        type="button"
                        className="atlas-direct-media__btn atlas-direct-media__btn--remove"
                        title="Remove from this place"
                        aria-label="Remove photo"
                        onClick={() => removeMedia(id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="atlas-direct-media__add">
          <Btn onClick={() => setShowPicker((v) => !v)}>
            {showPicker ? "Close media library" : "+ Add photos"}
          </Btn>
          {showPicker ? (
            <MediaPicker
              media={lib}
              placeId={place.id}
              selectedIds={mediaIds}
              onChange={setMediaIds}
              onUploaded={(m) =>
                setLib((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
              }
            />
          ) : null}
        </div>
      </div>

      {error ? <p className="atlas-locpicker__error">{error}</p> : null}

      <div className="atlas-direct__actions">
        <Btn onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
        <Btn kind="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Btn>
      </div>
    </div>
  );
}
