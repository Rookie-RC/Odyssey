"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import {
  formatDateRange,
  getPlaceStory,
  inspirationTypeLabel,
  targetTimeLabel,
  visitTypeLabel,
} from "../lib/domain";
import { getTimelineItems, seasonFromMonth, seasonLabel } from "../lib/timeline";
import { mediaSrc } from "../lib/api";
import type { AtlasRepository } from "../lib/repository";
import { t } from "../lib/i18n";
import { useSheetDrag } from "../lib/sheet-drag";
import { transportLabel, transportOf } from "../lib/transport";
import type { AtlasTheme } from "../themes";
import DirectEdit from "./edit/DirectEdit";
import Lightbox from "./Lightbox";
import { Btn } from "./manage/FormUI";
import { activitiesOf, activityLabel } from "../lib/activity";
import {
  ActivityIcon,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  EditIcon,
  ExternalIcon,
  HomeIcon,
  InspirationIcon,
  PeopleIcon,
  PinIcon,
  SeasonIcon,
  ShareIcon,
  TransportIcon,
} from "./Icons";

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
  /** Runtime writable mode: the Edit entry only appears when writable. */
  writable: boolean;
  /** Repository used by Direct Edit — the same layer Manage Atlas uses. */
  repo: AtlasRepository;
  onSaved: () => void;
  onClose: () => void;
  /** Move to another place in journey order (prev/next). */
  onNavigate?: (placeId: string) => void;
  onShowOnMap?: (placeId: string) => void;
  /** Share this place's trip (or its country) as a ticket. */
  onShare?: (visitId: string, countryCode: string) => void;
}

function formatCoord(v: number, pos: string, neg: string): string {
  return Math.abs(v).toFixed(2) + "° " + (v >= 0 ? pos : neg);
}

/** Right-side spatial sheet (bottom sheet on small screens). The page stays
 * visible behind a subtle dim — a continuation of the Atlas, not a modal page.
 * While editing, Escape and the close action are intercepted so unsaved
 * changes are never silently discarded. */
export default function PlaceDetailSheet({
  placeId,
  places,
  visits,
  wishlist,
  profile,
  media,
  closing,
  writable,
  repo,
  onSaved,
  onClose,
  onNavigate,
  onShowOnMap,
  onShare,
}: PlaceDetailSheetProps) {
  const story = useMemo(
    () => getPlaceStory(placeId, places, visits, wishlist, profile, media),
    [placeId, places, visits, wishlist, profile, media]
  );

  // Journey order for prev/next: the Timeline's chronology, then any place
  // only reachable from Where Next (untimed wishes).
  const order = useMemo(() => {
    const ids: string[] = [];
    for (const n of getTimelineItems(places, visits, wishlist, profile)) {
      if (!ids.includes(n.place.id)) ids.push(n.place.id);
    }
    for (const w of wishlist) if (!ids.includes(w.placeId) && places.some((p) => p.id === w.placeId)) ids.push(w.placeId);
    return ids;
  }, [places, visits, wishlist, profile]);
  const pos = order.indexOf(placeId);
  const prevId = pos > 0 ? order[pos - 1] : null;
  const nextId = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;

  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const pendingAfterDiscard = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the sheet on open and restore it on close.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    return () => {
      prev?.focus?.();
    };
  }, []);

  // On a phone the sheet can be dragged down to close. Not while editing:
  // that has its own discard prompt, and the form's scrolling matters more.
  useSheetDrag(shellRef, { enabled: !editing && !closing, onDismiss: onClose });

  const canEdit = writable && story != null && (story.primaryVisit != null || story.wishlist != null);

  useEffect(() => {
    if (editing && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [editing]);

  // While editing, Escape cancels the edit instead of closing the sheet; a
  // second Escape answers the discard prompt with "Keep editing".
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (confirmDiscard) {
        pendingAfterDiscard.current = null;
        setConfirmDiscard(false);
      } else {
        requestCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, confirmDiscard, dirty]);

  // ← / → move through the journey (not while editing or viewing photos).
  useEffect(() => {
    if (editing || lightbox != null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft" && prevId) onNavigate?.(prevId);
      if (e.key === "ArrowRight" && nextId) onNavigate?.(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, lightbox, prevId, nextId, onNavigate]);

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
  const gallery = story.media;
  const visitSeason =
    primaryVisit?.startDate && /^\d{4}-(\d{2})/.test(primaryVisit.startDate)
      ? seasonFromMonth(Number(primaryVisit.startDate.slice(5, 7)))
      : null;
  const stateLabel = isCurrent ? t("Current base") : visited ? t("Memory") : t("Wishlist");

  return (
    <div
      className={"atlas-overlay" + (closing ? " atlas-overlay--closing" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={shellRef}
        tabIndex={-1}
        className={"atlas-sheet atlas-detail-sheet" + (closing ? " atlas-sheet--closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={place.name + ", " + place.country}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="atlas-sheet__grabber" aria-hidden="true" />
        <div className="atlas-sheet__toolbar">
          <div className="atlas-sheet__nav">
            <button
              type="button"
              className="atlas-icon-btn atlas-icon-btn--sm atlas-glass atlas-glass--over-photo"
              onClick={() => prevId && onNavigate?.(prevId)}
              disabled={!prevId || editing}
              aria-label={t("Previous place")}
              title={t("Previous (←)")}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="atlas-icon-btn atlas-icon-btn--sm atlas-glass atlas-glass--over-photo"
              onClick={() => nextId && onNavigate?.(nextId)}
              disabled={!nextId || editing}
              aria-label={t("Next place")}
              title={t("Next (→)")}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="atlas-sheet__actions">
            {onShare && story?.primaryVisit && !editing ? (
              <button
                type="button"
                className="atlas-sheet__pill atlas-glass atlas-glass--over-photo"
                onClick={() => onShare(story.primaryVisit!.id, place.countryCode)}
                title={t("Share as a ticket")}
              >
                <ShareIcon size={14} /> {t("Share")}
              </button>
            ) : null}
            {canEdit && !editing ? (
              <button type="button" className="atlas-sheet__pill atlas-glass atlas-glass--over-photo" onClick={() => setEditing(true)}>
                <EditIcon size={14} /> {t("Edit")}
              </button>
            ) : null}
            <button
              ref={closeBtnRef}
              type="button"
              className="atlas-icon-btn atlas-icon-btn--sm atlas-glass atlas-glass--over-photo"
              onClick={requestClose}
              aria-label={t("Close")}
            >
              <CloseIcon size={15} />
            </button>
          </div>
        </div>

        <div className="atlas-sheet__scroll" ref={scrollRef}>
          <div className={"atlas-detail__hero" + (heroImage ? "" : " atlas-detail__hero--plain")}>
            {heroImage ? (
              <button
                type="button"
                className="atlas-detail__hero-btn"
                onClick={() => setLightbox(0)}
                aria-label={t("View photos")}
              >
                <img className="atlas-detail__hero-img atlas-photo" src={mediaSrc(heroImage, 1280)} alt={heroImage.caption ?? place.name} draggable={false} />
              </button>
            ) : null}
            <div className="atlas-detail__hero-shade" aria-hidden="true" />
            <div className="atlas-detail__hero-title">
              <span className={"atlas-detail__state" + (isCurrent ? " atlas-detail__state--now" : "")}>
                {isCurrent ? <HomeIcon size={12} /> : null}
                {stateLabel}
                {!visited && w?.targetTime?.season ? " · " + seasonLabel(w.targetTime.season) : ""}
              </span>
              <h2 className="atlas-detail__name atlas-break">{place.name}</h2>
              <div className="atlas-detail__country">
                <Flag code={place.countryCode} size={14} className="atlas-detail__flag" />
                {place.country}
              </div>
            </div>
          </div>

          {editing && canEdit ? (
            <div className="atlas-detail__body atlas-detail__body--editing">
              <div className="atlas-detail__editing-label">{visited ? t("Editing memory") : t("Editing wishlist")}</div>
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
              {/* --- facts row --- */}
              <div className="atlas-detail__facts">
                {visited && primaryVisit ? (
                  <>
                    <span className="atlas-detail__fact">
                      <CalendarIcon size={14} />
                      <span className="atlas-date">
                        {isCurrent && primaryVisit.startDate && !primaryVisit.endDate
                          ? t("Since {date}", { date: formatDateRange(primaryVisit.startDate) })
                          : formatDateRange(primaryVisit.startDate, primaryVisit.endDate) || t("Earlier")}
                      </span>
                    </span>
                    <span className="atlas-detail__fact">
                      {visitSeason ? <SeasonIcon season={visitSeason} size={14} className={"atlas-season-ink--" + visitSeason} /> : null}
                      {visitTypeLabel(primaryVisit.visitType)}
                    </span>
                    {primaryVisit.visitType !== "lived" ? (
                      <span className="atlas-detail__fact">
                        <TransportIcon mode={transportOf(primaryVisit)} size={14} />
                        {transportLabel(transportOf(primaryVisit))}
                      </span>
                    ) : null}
                    {primaryVisit.visitType !== "lived"
                      ? activitiesOf(primaryVisit).map((a) => (
                          <span key={a} className="atlas-detail__fact atlas-detail__fact--activity">
                            <ActivityIcon activity={a} size={14} />
                            {activityLabel(a)}
                          </span>
                        ))
                      : null}
                    {primaryVisit.withFriends ? (
                      <span className="atlas-detail__fact">
                        <PeopleIcon size={14} /> {t("With friends")}
                      </span>
                    ) : null}
                  </>
                ) : w ? (
                  <>
                    <span className="atlas-detail__fact">
                      {w.targetTime?.season ? (
                        <SeasonIcon season={w.targetTime.season} size={14} className={"atlas-season-ink--" + w.targetTime.season} />
                      ) : (
                        <CalendarIcon size={14} />
                      )}
                      {targetTimeLabel(w.targetTime)}
                    </span>
                    {w.seasons &&
                    w.seasons.length > 0 &&
                    !(w.seasons.length === 1 && w.seasons[0] === w.targetTime?.season) ? (
                      <span className="atlas-detail__fact">
                        {t("Best in {seasons}", { seasons: w.seasons.map((s) => seasonLabel(s)).join(t(", ")) })}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>

              {/* --- visited memory --- */}
              {visited && primaryVisit ? (
                <>
                  {primaryVisit.reflection ? (
                    <blockquote className="atlas-detail__reflection">{primaryVisit.reflection}</blockquote>
                  ) : null}

                  {primaryVisit.highlights && primaryVisit.highlights.length > 0 ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">{t("Highlights")}</h3>
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

                  {story.visits.length > 1 ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">{t("Every visit")}</h3>
                      <ol className="atlas-detail__visits">
                        {[...story.visits]
                          .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
                          .map((v) => (
                            <li key={v.id}>
                              <span className="atlas-date">{formatDateRange(v.startDate, v.endDate) || t("Earlier")}</span>
                              <span>{visitTypeLabel(v.visitType)}</span>
                              {v.visitType !== "lived" && activitiesOf(v).length > 0 ? (
                                <span className="atlas-activity-tags">
                                  {activitiesOf(v).map((a) => (
                                    <span key={a} className="atlas-activity-tag">
                                      <ActivityIcon activity={a} size={13} />
                                      {activityLabel(a)}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                            </li>
                          ))}
                      </ol>
                    </section>
                  ) : null}
                </>
              ) : null}

              {/* --- wishlist intention --- */}
              {w ? (
                <>
                  {w.why ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">{visited ? t("Why go back") : t("Why")}</h3>
                      <p className="atlas-detail__why">{w.why}</p>
                    </section>
                  ) : null}

                  {w.inspirations && w.inspirations.length > 0 ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">{t("Inspired by")}</h3>
                      <ul className="atlas-detail__inspirations">
                        {w.inspirations.map((i, idx) => (
                          <li key={idx} className="atlas-detail__inspiration">
                            <span className="atlas-detail__inspiration-icon">
                              <InspirationIcon type={i.type} size={15} />
                            </span>
                            <span className="atlas-detail__inspiration-text">
                              <span className="atlas-detail__inspiration-type">{inspirationTypeLabel(i.type)}</span>
                              {i.title ? <span className="atlas-detail__inspiration-title">{i.title}</span> : null}
                              {i.creator || i.platform ? (
                                <span className="atlas-detail__inspiration-meta">
                                  {[i.creator, i.platform].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                              {i.note ? <span className="atlas-detail__inspiration-note">{i.note}</span> : null}
                              {i.url ? (
                                <a className="atlas-detail__inspiration-link" href={i.url} target="_blank" rel="noreferrer">
                                  {t("Open source")} <ExternalIcon size={12} />
                                </a>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {w.note ? (
                    <section className="atlas-detail__section">
                      <h3 className="atlas-detail__label">{t("Notes")}</h3>
                      <p className="atlas-detail__note">{w.note}</p>
                    </section>
                  ) : null}
                </>
              ) : null}

              {/* --- photographs --- */}
              {gallery.length > 1 ? (
                <section className="atlas-detail__section">
                  <h3 className="atlas-detail__label">{t("Photographs · {n}", { n: gallery.length })}</h3>
                  <div className="atlas-detail__gallery">
                    {gallery.map((m, i) => (
                      <button
                        key={m.id}
                        type="button"
                        className="atlas-detail__gallery-item"
                        onClick={() => setLightbox(i)}
                        aria-label={t("View photo {n}", { n: i + 1 }) + (m.caption ? ": " + m.caption : "")}
                      >
                        <img className="atlas-photo" src={mediaSrc(m, 640)} alt="" loading="lazy" draggable={false} />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* --- location --- */}
              <section className="atlas-detail__section atlas-detail__where">
                <div className="atlas-detail__coords">
                  <PinIcon size={14} />
                  <span>
                    {formatCoord(place.coordinates.lat, "N", "S")}, {formatCoord(place.coordinates.lng, "E", "W")}
                  </span>
                </div>
                {onShowOnMap ? (
                  <button type="button" className="atlas-text-link" onClick={() => onShowOnMap(place.id)}>
                    {t("Show on map")} <ChevronRight size={14} />
                  </button>
                ) : null}
              </section>

              {heroImage && (heroImage.author || heroImage.license) ? (
                <p className="atlas-detail__credit">
                  {heroImage.author ? t("Photo · {author}", { author: heroImage.author }) : t("Photo")}
                  {heroImage.license ? ` · ${heroImage.license}` : ""}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {confirmDiscard ? (
          <div className="atlas-detail__discard" role="alertdialog" aria-label={t("Discard unsaved changes?")}>
            <div className="atlas-detail__discard-text">
              <strong>{t("Discard unsaved changes?")}</strong>
              <span>{t("Your edits to this memory will not be saved.")}</span>
            </div>
            <div className="atlas-detail__discard-actions">
              <Btn onClick={() => setConfirmDiscard(false)}>{t("Keep editing")}</Btn>
              <Btn kind="danger" onClick={discardConfirmed}>
                {t("Discard")}
              </Btn>
            </div>
          </div>
        ) : null}
      </div>

      {lightbox != null && gallery.length > 0 ? (
        <Lightbox items={gallery} startIndex={lightbox} title={place.name} onClose={() => setLightbox(null)} />
      ) : null}
    </div>
  );
}
