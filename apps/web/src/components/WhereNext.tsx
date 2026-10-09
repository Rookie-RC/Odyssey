"use client";

import { useMemo } from "react";
import Flag from "./Flag";
import type { Inspiration, Media, Place, Season, Wishlist } from "../lib/types";
import { getPrimaryMedia, seasonLabel } from "../lib/timeline";
import {
  getWhereNextItems,
  inspirationTypeLabel,
  targetTimeLabel,
  type WhereNextItem,
} from "../lib/domain";
import { mediaSrc } from "../lib/api";
import type { AtlasTheme } from "../themes";
import { t } from "../lib/i18n";
import { ArrowRight, ChevronRight, CompassIcon, InspirationIcon, PlusIcon, SeasonIcon } from "./Icons";

export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

interface WhereNextProps {
  wishlist: Wishlist[];
  places: Place[];
  media: Media[];
  theme: AtlasTheme;
  season: Season;
  onSeasonChange: (s: Season) => void;
  onOpenPlace: (placeId: string) => void;
  onViewAll?: () => void;
  /** Writable atlas with no wishes yet: start the first one. */
  onAddWish?: () => void;
}

/** "Summer 2027 target", "Summer idea", "Any season". */
export function wishBadge(w: Wishlist, season: Season): string {
  if (w.targetTime && (w.targetTime.year != null || w.targetTime.season != null)) {
    return t("{when} target", { when: targetTimeLabel(w.targetTime) });
  }
  if (w.seasons && w.seasons.length > 0) return t("{season} idea", { season: seasonLabel(season) });
  return t("Any season");
}

/** The inspiration worth showing on a card: a titled one first. */
export function leadInspiration(w: Wishlist): Inspiration | null {
  const list = w.inspirations ?? [];
  return (
    list.find((i) => i.type === "video" && i.title) ??
    list.find((i) => i.title) ??
    list.find((i) => i.creator || i.platform || i.note) ??
    null
  );
}

export default function WhereNext({
  wishlist,
  places,
  media,
  season,
  onSeasonChange,
  onOpenPlace,
  onViewAll,
  onAddWish,
}: WhereNextProps) {
  const items = useMemo(() => getWhereNextItems(wishlist, places, season), [wishlist, places, season]);
  const counts = useMemo(() => {
    const out = {} as Record<Season, number>;
    for (const s of SEASONS) out[s] = getWhereNextItems(wishlist, places, s).length;
    return out;
  }, [wishlist, places]);
  const primary = items[0] ?? null;
  const secondaries = items.slice(1, 3);
  const more = items.slice(3);

  return (
    <section className="atlas-wherenext" id="where-next" aria-label={t("Where next")}>
      <header className="atlas-wherenext__head">
        <div className="atlas-wherenext__intro">
          <h2 className="atlas-eyebrow atlas-section-head__title">{t("Where next?")}</h2>
          <p className="atlas-wherenext__tagline">{t("Dreaming ahead. One season, many possibilities.")}</p>
        </div>
        <div className="atlas-season-tabs" role="tablist" aria-label={t("Season")}>
          {SEASONS.map((s) => {
            const selected = s === season;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={selected}
                className={"atlas-season-tab atlas-season-tab--" + s + (selected ? " is-selected" : "")}
                onClick={() => onSeasonChange(s)}
              >
                <SeasonIcon season={s} size={16} className="atlas-season-tab__icon" />
                <span>{seasonLabel(s)}</span>
                {counts[s] > 0 ? <span className="atlas-season-tab__count">{counts[s]}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="atlas-wherenext__all">
          {onViewAll && wishlist.length > 0 ? (
            <button type="button" className="atlas-text-link" onClick={onViewAll}>
              {t("View all ideas")} <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="atlas-wherenext__empty">
          <span className={"atlas-wherenext__empty-icon atlas-season-ink--" + season}>
            <SeasonIcon season={season} size={30} strokeWidth={1.2} />
          </span>
          <p className="atlas-display">
            {t("Nothing dreamt up for {season} yet.", {
              season: t("Spring") === "Spring" ? seasonLabel(season).toLowerCase() : seasonLabel(season),
            })}
          </p>
          {wishlist.length === 0 && onAddWish ? (
            <button type="button" className="atlas-btn atlas-btn--primary" onClick={onAddWish}>
              <PlusIcon size={14} /> {t("Add a place you want to go")}
            </button>
          ) : null}
          <div className="atlas-wherenext__empty-alt">
            {SEASONS.filter((s) => s !== season && counts[s] > 0).map((s) => (
              <button key={s} type="button" className="atlas-text-link" onClick={() => onSeasonChange(s)}>
                {t(counts[s] === 1 ? "{season} has {n} idea" : "{season} has {n} ideas", {
                  season: seasonLabel(s),
                  n: counts[s],
                })}{" "}
                <ArrowRight size={13} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div
            className={
              "atlas-wherenext__grid atlas-wherenext__grid--" + (1 + secondaries.length)
            }
            key={season}
          >
            {primary ? (
              <PrimaryCard item={primary} media={media} season={season} onOpen={() => onOpenPlace(primary.place.id)} />
            ) : null}
            {secondaries.map((item, i) => (
              <SecondaryCard
                key={item.wishlist.id}
                item={item}
                media={media}
                index={i}
                onOpen={() => onOpenPlace(item.place.id)}
              />
            ))}
          </div>
          {more.length > 0 ? (
            <div className="atlas-wherenext__more">
              <span className="atlas-wherenext__more-label">{t("Also dreaming of")}</span>
              <div className="atlas-wherenext__more-list">
                {more.map((item) => {
                  const img = getPrimaryMedia(item.wishlist.mediaIds ?? [], media);
                  return (
                    <button
                      key={item.wishlist.id}
                      type="button"
                      className="atlas-wn-mini"
                      onClick={() => onOpenPlace(item.place.id)}
                    >
                      {img ? (
                        <img className="atlas-photo" src={mediaSrc(img, 160)} alt="" loading="lazy" draggable={false} />
                      ) : (
                        <span className="atlas-wn-mini__flag"><Flag code={item.place.countryCode} size={12} /></span>
                      )}
                      <span className="atlas-wn-mini__name">{item.place.name}</span>
                      <span className="atlas-wn-mini__country">{item.place.country}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// --- Dominant destination: a large cinematic photograph ---

function PrimaryCard({
  item,
  media,
  season,
  onOpen,
}: {
  item: WhereNextItem;
  media: Media[];
  season: Season;
  onOpen: () => void;
}) {
  const { wishlist, place } = item;
  const image = getPrimaryMedia(wishlist.mediaIds ?? [], media);
  const inspiration = leadInspiration(wishlist);
  const timeless = !wishlist.targetTime?.season && !(wishlist.seasons && wishlist.seasons.length);
  const badgeSeason = wishlist.targetTime?.season ?? season;

  return (
    <button type="button" className="atlas-wn-primary" onClick={onOpen} aria-label={t("Open wish: {place}", { place: place.name })}>
      {image ? (
        <img className="atlas-wn-primary__img atlas-photo" src={mediaSrc(image, 1280)} alt="" draggable={false} />
      ) : (
        <span className="atlas-wn-primary__fallback" aria-hidden="true" />
      )}
      <span className="atlas-wn-primary__shade" aria-hidden="true" />
      <span className="atlas-wn-badge">
        {timeless ? <CompassIcon size={14} /> : <SeasonIcon season={badgeSeason} size={14} />}
        {wishBadge(wishlist, season)}
      </span>
      <span className="atlas-wn-primary__body">
        <span className="atlas-wn-primary__title atlas-break">
          {place.name}
          {place.country && place.country !== place.name ? ", " + place.country : ""}
          <Flag code={place.countryCode} size={20} className="atlas-wn-primary__flag" />
        </span>
        {wishlist.why ? <span className="atlas-wn-primary__why">{wishlist.why}</span> : null}
        {inspiration ? (
          <span className="atlas-wn-inspo">
            <span className="atlas-wn-inspo__icon">
              <InspirationIcon type={inspiration.type} size={14} />
            </span>
            <span className="atlas-wn-inspo__text">
              <span className="atlas-wn-inspo__title">
                {t("Inspiration: {title}", { title: inspiration.title ?? inspiration.note ?? inspiration.creator ?? "" })}
              </span>
              <span className="atlas-wn-inspo__meta">
                {[inspiration.platform, inspiration.creator, inspirationTypeLabel(inspiration.type)]
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(" · ")}
              </span>
            </span>
          </span>
        ) : null}
      </span>
      <span className="atlas-wn-primary__go" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

// --- Secondary destinations ---

function SecondaryCard({
  item,
  media,
  index,
  onOpen,
}: {
  item: WhereNextItem;
  media: Media[];
  index: number;
  onOpen: () => void;
}) {
  const { wishlist, place } = item;
  const image = getPrimaryMedia(wishlist.mediaIds ?? [], media);

  return (
    <button
      type="button"
      className="atlas-wn-secondary"
      onClick={onOpen}
      style={{ animationDelay: 60 + index * 70 + "ms" }}
      aria-label={t("Open wish: {place}", { place: place.name })}
    >
      <span className="atlas-wn-secondary__media">
        {image ? (
          <img className="atlas-photo" src={mediaSrc(image, 640)} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="atlas-wn-secondary__fallback" aria-hidden="true">
            <Flag code={place.countryCode} size={28} />
          </span>
        )}
      </span>
      <span className="atlas-wn-secondary__body">
        <span className="atlas-wn-chip">{place.country}</span>
        <span className="atlas-wn-secondary__name atlas-break">{place.name}</span>
        {wishlist.why ? <span className="atlas-wn-secondary__why">{wishlist.why}</span> : null}
        <span className="atlas-wn-secondary__go" aria-hidden="true">
          <ChevronRight size={16} />
        </span>
      </span>
    </button>
  );
}
