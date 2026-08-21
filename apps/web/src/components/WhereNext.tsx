"use client";

import { useMemo } from "react";
import type { Media, Place, Season, Wishlist } from "../lib/types";
import { getPrimaryMedia, seasonLabel } from "../lib/timeline";
import {
  flagEmoji,
  getWhereNextItems,
  inspirationSourceLabel,
  targetTimeLabel,
  type WhereNextItem,
} from "../lib/domain";
import type { AtlasTheme } from "../themes";

export const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

interface WhereNextProps {
  wishlist: Wishlist[];
  places: Place[];
  media: Media[];
  theme: AtlasTheme;
  season: Season;
  onSeasonChange: (s: Season) => void;
  onOpenPlace: (placeId: string) => void;
}

export default function WhereNext({
  wishlist,
  places,
  media,
  theme,
  season,
  onSeasonChange,
  onOpenPlace,
}: WhereNextProps) {
  const items = useMemo(
    () => getWhereNextItems(wishlist, places, season),
    [wishlist, places, season]
  );
  const primary = items[0] ?? null;
  const secondaries = items.slice(1);

  return (
    <section className="atlas-wherenext" aria-label="Where next">
      <header className="atlas-wherenext__head">
        <div className="atlas-wherenext__head-left">
          <h2 className="atlas-journey__title">Where next</h2>
          <p className="atlas-wherenext__subtitle">The future is seasonal.</p>
        </div>
        <div className="atlas-season-selector" role="group" aria-label="Season">
          {SEASONS.map((s) => {
            const selected = s === season;
            return (
              <button
                key={s}
                type="button"
                className="atlas-season-selector__item"
                aria-pressed={selected}
                onClick={() => onSeasonChange(s)}
              >
                <span className="atlas-season-selector__label">{seasonLabel(s)}</span>
                <span
                  className="atlas-season-selector__line"
                  style={selected ? { background: theme.seasons[s] } : undefined}
                />
              </button>
            );
          })}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="atlas-wherenext__empty">
          <p>Nothing planned for {seasonLabel(season).toLowerCase()} yet.</p>
          <p className="atlas-wherenext__empty-sub">Try another season — the future is still open.</p>
        </div>
      ) : (
        <div className="atlas-wherenext__grid">
          {primary ? (
            <PrimaryCard
              item={primary}
              media={media}
              season={season}
              theme={theme}
              onOpen={() => onOpenPlace(primary.place.id)}
            />
          ) : null}
          {secondaries.length > 0 ? (
            <div className="atlas-wherenext__secondaries">
              {secondaries.map((item) => (
                <SecondaryCard
                  key={item.wishlist.id}
                  item={item}
                  media={media}
                  theme={theme}
                  onOpen={() => onOpenPlace(item.place.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

// --- Dominant destination ---

function PrimaryCard({
  item,
  media,
  season,
  theme,
  onOpen,
}: {
  item: WhereNextItem;
  media: Media[];
  season: Season;
  theme: AtlasTheme;
  onOpen: () => void;
}) {
  const { wishlist, place } = item;
  const image = getPrimaryMedia(wishlist.mediaIds ?? [], media);
  const inspiration = wishlist.inspirations?.find((i) => i.title || i.creator || i.platform || i.note);

  return (
    <button type="button" className="atlas-wn-primary" onClick={onOpen}>
      <div className="atlas-wn-primary__media">
        {image ? (
          <img
            className="atlas-wn-primary__img"
            src={image.path}
            alt={image.caption ?? place.name}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="atlas-wn-primary__fallback" aria-hidden="true" />
        )}
        <div className="atlas-wn-primary__gradient" aria-hidden="true" />
        <div className="atlas-wn-primary__place">
          <div className="atlas-wn-primary__name">
            {place.name}
            {flagEmoji(place.countryCode) ? (
              <span className="atlas-wn-primary__flag" aria-hidden="true">
                {" " + flagEmoji(place.countryCode)}
              </span>
            ) : null}
          </div>
          <div className="atlas-wn-primary__country">
            {place.country}
            {" · "}
            <span
              className="atlas-wn-primary__time"
              style={{ color: theme.seasons[season] }}
            >
              {targetTimeLabel(wishlist.targetTime)}
            </span>
          </div>
        </div>
      </div>
      <div className="atlas-wn-primary__body">
        {wishlist.why ? <p className="atlas-wn-primary__why">{wishlist.why}</p> : null}
        {inspiration ? (
          <p className="atlas-wn-primary__inspiration">
            Inspired by {inspirationSourceLabel(inspiration)}
            {inspiration.platform ? " · " + inspiration.platform : ""}
          </p>
        ) : null}
        <span className="atlas-wn-primary__open">
          Explore
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M2 8h11M9 3.5 13.5 8 9 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </button>
  );
}

// --- Secondary destinations ---

function SecondaryCard({
  item,
  media,
  theme,
  onOpen,
}: {
  item: WhereNextItem;
  media: Media[];
  theme: AtlasTheme;
  onOpen: () => void;
}) {
  const { wishlist, place } = item;
  const image = getPrimaryMedia(wishlist.mediaIds ?? [], media);

  return (
    <button type="button" className="atlas-wn-secondary" onClick={onOpen}>
      {image ? (
        <img
          className="atlas-wn-secondary__thumb"
          src={image.path}
          alt={image.caption ?? place.name}
          loading="lazy"
          draggable={false}
        />
      ) : (
        <div className="atlas-wn-secondary__thumb atlas-wn-secondary__thumb--plain" aria-hidden="true" />
      )}
      <span className="atlas-wn-secondary__info">
        <span className="atlas-wn-secondary__name">{place.name}</span>
        <span className="atlas-wn-secondary__country">{place.country}</span>
        {wishlist.why ? (
          <span className="atlas-wn-secondary__why">{wishlist.why}</span>
        ) : null}
      </span>
    </button>
  );
}
