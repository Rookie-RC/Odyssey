"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import { getPlaceStory, formatDateRange, inspirationSourceLabel, inspirationTypeLabel, targetTimeLabel, visitTypeLabel } from "../lib/domain";
import type { AtlasRepository } from "../lib/repository";
import type { AtlasTheme } from "../themes";
import DirectEdit from "./edit/DirectEdit";
import { Btn } from "./manage/FormUI";

interface PlaceDetailSheetProps {
  placeId: string;
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  theme: AtlasTheme;
  /** True while the parent is animating the overlay away. */
  closing: boolean;
  /** Runtime writable mode: the Edit entry only appears when the runtime
   * reports writable (read-only runtimes keep normal viewing only). */
  writable: boolean;
  /** Repository used by Direct Edit — the same layer Manage Atlas uses, so
   * inline editing never creates a second persistence path. */
  repo: AtlasRepository;
  /** Called after a successful inline save so the parent reloads data and the
   * derived views (Timeline, Where Next, Map) refresh consistently. */
  onSaved: () => void;
  onClose: () => void;
}

/** Right-side spatial sheet (bottom sheet on small screens). The page stays
 * visible behind a subtle dim — this is a continuation of the Atlas, not a
 * modal page. Focus → Expand → Explore → Collapse. Escape and backdrop click
 * are handled by the parent overlay lifecycle; while editing, Escape and the
 * close action are intercepted here so unsaved changes are never silently
 * discarded. */
export default function PlaceDetailSheet({
  placeId,
  places,
  visits,
  wishlist,
  profile,
  media,
  theme,
  closing,
  writable,
  repo,
  onSaved,
  onClose,
}: PlaceDetailSheetProps) {
  const story = useMemo(
    () => getPlaceStory(placeId, places, visits, wishlist, profile, media),
    [placeId, places, visits, wishlist, profile, media]
  );

  // --- direct editing (v1.1) ---
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // What to do after the user confirms "Discard": either close the sheet or
  // just leave edit mode (both are triggered through the same confirmation).
  const pendingAfterDiscard = useRef<(() => void) | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the sheet on open and restore it on close (keyboard use).
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      prev?.focus?.();
    };
  }, []);

  const canEdit = writable && story != null && (story.primaryVisit != null || story.wishlist != null);

  // Entering edit mode starts at the top of the form (the hero stays put, so
  // the sheet remains visually recognizable while editing).
  useEffect(() => {
    if (editing && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [editing]);

  // While editing, Escape cancels the edit instead of closing the sheet; a
  // dirty form asks for confirmation before discarding. The listener runs in
  // the capture phase so the parent's sheet-close handler never sees it.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || confirmDiscard) return;
      e.preventDefault();
      e.stopPropagation();
      requestCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, confirmDiscard, dirty]);

  const requestClose = () => {
    if (editing && dirty) {
      pendingAfterDiscard.current = onClose;
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const requestCancel = () => {
    if (dirty) {
      pendingAfterDiscard.current = () => setEditing(false);
      setConfirmDiscard(true);
      return;
    }
    setEditing(false);
  };

  const discardConfirmed = () => {
    setConfirmDiscard(false);
    setEditing(false);
    setDirty(false);
    const action = pendingAfterDiscard.current;
    pendingAfterDiscard.current = null;
    action?.();
  };

  const handleSaved = () => {
    setEditing(false);
    setDirty(false);
    onSaved();
  };

  if (!story) return null;
  const { place, primaryVisit, wishlist: w, isCurrent } = story;
  const visited = story.visits.length > 0;
  const heroImage = story.primaryMedia;
  const extraPhotos = story.media.filter((m) => m.id !== heroImage?.id).slice(0, 3);
  const inspiration = w?.inspirations?.[0];

  return (
    <div
      className={"atlas-overlay" + (closing ? " atlas-overlay--closing" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <aside
        className={"atlas-detail-sheet" + (closing ? " atlas-detail-sheet--closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={place.name + ", " + place.country}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          ref={closeBtnRef}
          type="button"
          className="atlas-sheet__close"
          onClick={requestClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {canEdit && !editing ? (
          <button type="button" className="atlas-detail__edit" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}

        <div className="atlas-detail-sheet__scroll" ref={scrollRef}>
          <div className={"atlas-detail__hero" + (heroImage ? "" : " atlas-detail__hero--plain")}>
            {heroImage ? (
              <img
                className="atlas-detail__hero-img"
                src={heroImage.path}
                alt={heroImage.caption ?? place.name}
                draggable={false}
              />
            ) : null}
            <div className="atlas-detail__hero-gradient" aria-hidden="true" />
            <div className="atlas-detail__hero-title">
              {isCurrent ? (
                <span className="atlas-detail__badge" style={{ color: theme.markers.current }}>
                  Current base
                </span>
              ) : null}
              <div className="atlas-detail__hero-name">{place.name}</div>
              <div className="atlas-detail__hero-country">{place.country}</div>
            </div>
          </div>

          {editing && canEdit ? (
            <div className="atlas-detail__body atlas-detail__body--editing">
              <div className="atlas-detail__editing-label">
                {visited ? "Editing memory" : "Editing wishlist"}
              </div>
              <DirectEdit
                story={story}
                media={media}
                repo={repo}
                onDirtyChange={setDirty}
                onSaved={handleSaved}
                onCancel={requestCancel}
              />
            </div>
          ) : (
            <div className="atlas-detail__body">
              {/* --- meta row --- */}
              {visited && primaryVisit ? (
                <div className="atlas-detail__meta">
                  <span>{formatDateRange(primaryVisit.startDate, primaryVisit.endDate) || "Earlier"}</span>
                  <span className="atlas-detail__meta-sep"> · </span>
                  <span>{visitTypeLabel(primaryVisit.visitType)}</span>
                  {primaryVisit.withFriends ? (
                    <>
                      <span className="atlas-detail__meta-sep"> · </span>
                      <span>With friends</span>
                    </>
                  ) : null}
                </div>
              ) : w ? (
                <div className="atlas-detail__meta">
                  <span
                    className="atlas-detail__season"
                    style={w.targetTime?.season ? { color: theme.seasons[w.targetTime.season] } : undefined}
                  >
                    {targetTimeLabel(w.targetTime)}
                  </span>
                  <span className="atlas-detail__meta-sep"> · </span>
                  <span>Wishlist</span>
                </div>
              ) : null}

              {/* --- visited memory --- */}
              {visited && primaryVisit ? (
                <>
                  {primaryVisit.highlights && primaryVisit.highlights.length > 0 ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">Highlights</h3>
                      <ul className="atlas-detail__highlights">
                        {primaryVisit.highlights.map((h, i) => (
                          <li key={i}>
                            <span className="atlas-detail__highlight-name">{h.name}</span>
                            {h.note ? <span className="atlas-detail__highlight-note">{h.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {primaryVisit.reflection ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">Reflection</h3>
                      <p className="atlas-detail__reflection">{primaryVisit.reflection}</p>
                    </section>
                  ) : null}

                  {story.visits.length > 1 ? (
                    <p className="atlas-detail__again">
                      Visited again ·{" "}
                      {story.visits
                        .slice(1)
                        .map((v) => formatDateRange(v.startDate, v.endDate) || "earlier")
                        .join(", ")}
                    </p>
                  ) : null}
                </>
              ) : null}

              {/* --- wishlist intention --- */}
              {w ? (
                <>
                  {w.why ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">Why</h3>
                      <p className="atlas-detail__why">{w.why}</p>
                    </section>
                  ) : null}

                  {w.inspirations && w.inspirations.length > 0 ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">Inspired by</h3>
                      <ul className="atlas-detail__inspirations">
                        {w.inspirations.map((i, idx) => (
                          <li key={idx} className="atlas-detail__inspiration">
                            <span className="atlas-detail__inspiration-type">
                              {inspirationTypeLabel(i.type)}
                            </span>
                            {i.title ? (
                              <span className="atlas-detail__inspiration-title">{i.title}</span>
                            ) : null}
                            {i.creator ? (
                              <span className="atlas-detail__inspiration-creator">{i.creator}</span>
                            ) : null}
                            {i.platform ? (
                              <span className="atlas-detail__inspiration-meta">{i.platform}</span>
                            ) : null}
                            {i.note ? (
                              <span className="atlas-detail__inspiration-note">{i.note}</span>
                            ) : null}
                            {i.url ? (
                              <a
                                className="atlas-detail__inspiration-link"
                                href={i.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open source ↗
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {w.note ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">Notes</h3>
                      <p className="atlas-detail__note">{w.note}</p>
                    </section>
                  ) : null}
                </>
              ) : null}

              {/* --- photos (beyond the hero) --- */}
              {extraPhotos.length > 0 ? (
                <section className="atlas-detail__section">
                  <h3 className="atlas-detail__label">Photos</h3>
                  <div className="atlas-detail__photos">
                    {extraPhotos.map((m) => (
                      <figure key={m.id} className="atlas-detail__photo">
                        <img
                          src={m.path}
                          alt={m.caption ?? place.name}
                          loading="lazy"
                          draggable={false}
                        />
                        {m.caption ? <figcaption>{m.caption}</figcaption> : null}
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}

              {heroImage && heroImage.source === "local" && (heroImage.author || heroImage.license) ? (
                <p className="atlas-detail__credit">
                  {heroImage.author ? `Photo · ${heroImage.author}` : "Photo"}
                  {heroImage.license ? ` · ${heroImage.license}` : ""}
                </p>
              ) : null}

              <div className="atlas-detail__foot">
                {inspiration ? (
                  <span className="atlas-detail__footline">
                    Inspired by {inspirationSourceLabel(inspiration)}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {confirmDiscard ? (
          <div className="atlas-detail__discard" role="alertdialog" aria-label="Discard unsaved changes">
            <div className="atlas-detail__discard-text">
              <strong>Discard unsaved changes?</strong>
              <span>Your edits to this memory will not be saved.</span>
            </div>
            <div className="atlas-detail__discard-actions">
              <Btn onClick={() => setConfirmDiscard(false)}>Keep editing</Btn>
              <Btn kind="danger" onClick={discardConfirmed}>
                Discard
              </Btn>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
