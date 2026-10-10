"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Media, Place, Season, Wishlist } from "../lib/types";
import { getPrimaryMedia, seasonLabel } from "../lib/timeline";
import { targetTimeLabel } from "../lib/domain";
import { mediaSrc } from "../lib/api";
import { CloseIcon, SeasonIcon } from "./Icons";
import { leadInspiration } from "./WhereNext";
import { t, tn } from "../lib/i18n";
import { useSheetDrag } from "../lib/sheet-drag";

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

type Filter = "all" | Season | "anytime";
type Sort = "priority" | "soonest" | "name";

interface IdeasBoardProps {
  wishlist: Wishlist[];
  places: Place[];
  media: Media[];
  initialSeason: Season | null;
  closing: boolean;
  onClose: () => void;
  onOpenPlace: (placeId: string) => void;
}

function targetSortKey(w: Wishlist): number {
  const tt = w.targetTime;
  if (!tt || (tt.year == null && tt.season == null)) return Infinity;
  const order: Record<Season, number> = { winter: 0.05, spring: 0.3, summer: 0.55, autumn: 0.8 };
  return (tt.year ?? 3000) + (tt.season ? order[tt.season] : 0.5);
}

/** Every Wishlist idea at once — the "View all ideas" companion to the
 * seasonal Where Next shelf. Still aspirational rather than a database: a
 * gallery filtered by season, not a table. */
export default function IdeasBoard({
  wishlist,
  places,
  media,
  initialSeason,
  closing,
  onClose,
  onOpenPlace,
}: IdeasBoardProps) {
  const [filter, setFilter] = useState<Filter>(initialSeason ?? "all");
  const [sort, setSort] = useState<Sort>("priority");
  const shellRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  // On a phone the board can be dragged down to close.
  useSheetDrag(shellRef, { enabled: !closing, onDismiss: onClose });

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const items = useMemo(() => {
    const list = wishlist
      .map((w) => ({ w, place: byId.get(w.placeId) }))
      .filter((x): x is { w: Wishlist; place: Place } => Boolean(x.place))
      .filter(({ w }) => {
        if (filter === "all") return true;
        const seasons = w.seasons ?? [];
        if (filter === "anytime") return seasons.length === 0;
        return seasons.includes(filter) || w.targetTime?.season === filter;
      });
    list.sort((a, b) => {
      if (sort === "soonest") return targetSortKey(a.w) - targetSortKey(b.w) || a.place.name.localeCompare(b.place.name);
      if (sort === "name") return a.place.name.localeCompare(b.place.name);
      return (b.w.priority ?? 0) - (a.w.priority ?? 0) || a.place.name.localeCompare(b.place.name);
    });
    return list;
  }, [wishlist, byId, filter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, anytime: 0, spring: 0, summer: 0, autumn: 0, winter: 0 };
    for (const w of wishlist) {
      if (!byId.has(w.placeId)) continue;
      c.all++;
      const seasons = w.seasons ?? [];
      if (seasons.length === 0) c.anytime++;
      for (const s of SEASONS) if (seasons.includes(s) || w.targetTime?.season === s) c[s]++;
    }
    return c;
  }, [wishlist, byId]);

  const filters: Filter[] = ["all", ...SEASONS, "anytime"];

  return (
    <div
      className={"atlas-overlay" + (closing ? " atlas-overlay--closing" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        tabIndex={-1}
        className={"atlas-sheet atlas-ideas" + (closing ? " atlas-sheet--closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={t("All ideas")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="atlas-sheet__grabber" aria-hidden="true" />
        <div className="atlas-ideas__head">
          <div>
            <span className="atlas-eyebrow atlas-ideas__eyebrow">{t("Where next · all ideas")}</span>
            <h2 className="atlas-ideas__title atlas-display">
              {tn(counts.all, "{n} place I dream of", "{n} places I dream of")}
            </h2>
          </div>
          <button ref={closeRef} type="button" className="atlas-icon-btn atlas-icon-btn--sm" onClick={onClose} aria-label={t("Close")}>
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="atlas-ideas__controls">
          <div className="atlas-ideas__filters" role="tablist" aria-label={t("Filter by season")}>
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={"atlas-filter-chip" + (filter === f ? " is-active" : "")}
                onClick={() => setFilter(f)}
                disabled={f !== "all" && counts[f] === 0}
              >
                {f !== "all" && f !== "anytime" ? (
                  <SeasonIcon season={f} size={14} className={"atlas-season-ink--" + f} />
                ) : null}
                {f === "all" ? t("All") : f === "anytime" ? t("Any time") : seasonLabel(f)}
                <span className="atlas-filter-chip__count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <label className="atlas-ideas__sort">
            <span>{t("Sort")}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="priority">{t("Most wanted")}</option>
              <option value="soonest">{t("Soonest")}</option>
              <option value="name">{t("A–Z")}</option>
            </select>
          </label>
        </div>

        <div className="atlas-sheet__scroll atlas-ideas__scroll">
          {items.length === 0 ? (
            <p className="atlas-ideas__empty">{t("No ideas here yet.")}</p>
          ) : (
            <div className="atlas-ideas__grid">
              {items.map(({ w, place }, i) => {
                const img = getPrimaryMedia(w.mediaIds ?? [], media);
                const insp = leadInspiration(w);
                return (
                  <button
                    key={w.id}
                    type="button"
                    className="atlas-idea"
                    onClick={() => onOpenPlace(place.id)}
                    style={{ animationDelay: Math.min(i, 12) * 40 + "ms" }}
                  >
                    <span className="atlas-idea__media">
                      {img ? (
                        <img className="atlas-photo" src={mediaSrc(img, 640)} alt="" loading="lazy" draggable={false} />
                      ) : (
                        <span className="atlas-idea__fallback"><Flag code={place.countryCode} size={28} /></span>
                      )}
                      <span className="atlas-idea__when">
                        {w.targetTime?.season ? <SeasonIcon season={w.targetTime.season} size={12} /> : null}
                        {targetTimeLabel(w.targetTime)}
                      </span>
                    </span>
                    <span className="atlas-idea__body">
                      <span className="atlas-idea__name atlas-break">
                        {place.name} <Flag code={place.countryCode} size={13} className="atlas-idea__flag" />
                      </span>
                      <span className="atlas-idea__country">{place.country}</span>
                      {w.why ? <span className="atlas-idea__why">{w.why}</span> : null}
                      <span className="atlas-idea__foot">
                        {(w.seasons ?? []).length > 0 ? (
                          <span className="atlas-idea__seasons">
                            {(w.seasons ?? []).map((s) => (
                              <SeasonIcon key={s} season={s} size={13} className={"atlas-season-ink--" + s} />
                            ))}
                          </span>
                        ) : (
                          <span className="atlas-idea__seasons atlas-idea__seasons--any">{t("Any season")}</span>
                        )}
                        {insp ? (
                          <span className="atlas-idea__insp">{insp.title ?? insp.creator ?? insp.platform ?? insp.note}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
