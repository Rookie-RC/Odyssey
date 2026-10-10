"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import { formatDateRange, getPrimaryMediaForPlace, targetTimeLabel, visitTypeLabel } from "../lib/domain";
import { mediaSrc } from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { CompassIcon, PinIcon, SearchIcon, StarIcon, HomeIcon } from "./Icons";

interface SearchPanelProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  media: Media[];
  profile: Profile | null;
  onClose: () => void;
  onOpenPlace: (placeId: string) => void;
  onShowOnMap: (placeId: string) => void;
}

interface Result {
  place: Place;
  role: "current" | "memory" | "wish";
  subtitle: string;
  matched?: string;
  score: number;
  thumb: Media | null;
}

/** Lowercase and strip diacritics: "jülich" matches "julich", "Ålesund" "alesund". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function scoreText(text: string | undefined, q: string): number {
  if (!text) return 0;
  const t = norm(text);
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s,/·-]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  return 0;
}

/** Search every place, memory and wish: by name and country, then by what was
 * written about it (highlights, reflections, why, inspirations). A full screen
 * on phones, a dialog on wide screens. */
export default function SearchPanel({
  places,
  visits,
  wishlist,
  media,
  profile,
  onClose,
  onOpenPlace,
  onShowOnMap,
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const locale = useLocale();
  const placeIndex = useMemo(() => {
    const currentId = profile?.currentBase?.placeId ?? null;
    return places.map((place) => {
      const pv = visits.filter((v) => v.placeId === place.id);
      const w = wishlist.find((x) => x.placeId === place.id) ?? null;
      const role: Result["role"] = place.id === currentId ? "current" : pv.length > 0 ? "memory" : "wish";
      const latest = [...pv].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];
      const subtitle =
        role === "current"
          ? t("Current base")
          : latest
            ? [formatDateRange(latest.startDate, latest.endDate), visitTypeLabel(latest.visitType)].filter(Boolean).join(" · ")
            : w
              ? t("Wishlist · {when}", { when: targetTimeLabel(w.targetTime) })
              : t("Place");
      const extra: { label: string; text: string }[] = [];
      for (const v of pv) {
        for (const h of v.highlights ?? []) extra.push({ label: h.name, text: h.name + " " + (h.note ?? "") });
        if (v.reflection) extra.push({ label: v.reflection, text: v.reflection });
      }
      if (w?.why) extra.push({ label: w.why, text: w.why });
      for (const i of w?.inspirations ?? []) {
        const s = [i.title, i.creator, i.platform, i.note].filter(Boolean).join(" ");
        if (s) extra.push({ label: s, text: s });
      }
      return {
        place,
        role,
        subtitle,
        extra,
        latest: latest?.startDate ?? "",
        thumb: getPrimaryMediaForPlace(place.id, visits, wishlist, media),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, visits, wishlist, media, profile, locale]);

  const results = useMemo<Result[]>(() => {
    const q = norm(query.trim());
    if (!q) {
      // Nothing typed: the current base and recent memories.
      return placeIndex
        .filter((p) => p.role !== "wish")
        .sort((a, b) => (a.role === "current" ? -1 : b.role === "current" ? 1 : b.latest.localeCompare(a.latest)))
        .slice(0, 6)
        .map<Result>((p) => ({ place: p.place, role: p.role, subtitle: p.subtitle, score: 1, thumb: p.thumb }));
    }
    const out: Result[] = [];
    for (const p of placeIndex) {
      let score = Math.max(scoreText(p.place.name, q) * 1.2, scoreText(p.place.country, q) * 0.8);
      let matched: string | undefined;
      if (score === 0) {
        for (const e of p.extra) {
          const s = scoreText(e.text, q) * 0.5;
          if (s > score) {
            score = s;
            matched = e.label;
          }
        }
      }
      if (score > 0) out.push({ place: p.place, role: p.role, subtitle: p.subtitle, matched, score, thumb: p.thumb });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 40);
  }, [query, placeIndex]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Arrow keys and Enter for computers; on a phone every row is a button.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      if (r) onOpenPlace(r.place.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="atlas-dialog-backdrop atlas-search-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="atlas-search" role="dialog" aria-modal="true" aria-label={t("Search the atlas")} onKeyDown={onKeyDown}>
        <div className="atlas-search__bar">
          <label className="atlas-search__input">
            <SearchIcon size={18} />
            <input
              ref={inputRef}
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search places, memories, wishes…")}
              aria-label={t("Search")}
              aria-controls="atlas-search-list"
              aria-activedescendant={results[active] ? "search-item-" + active : undefined}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="button" className="atlas-search__cancel" onClick={onClose}>
            {t("Cancel")}
          </button>
        </div>
        <div className="atlas-search__list" id="atlas-search-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="atlas-search__empty">
              <CompassIcon size={22} />
              <span>{t("Nothing in this atlas matches “{q}”.", { q: query })}</span>
            </div>
          ) : (
            <>
              <div className="atlas-search__group">{hasQuery ? t("Places") : t("Recent")}</div>
              {results.map((r, i) => (
                <div
                  key={r.place.id}
                  id={"search-item-" + i}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={"atlas-search__item" + (i === active ? " is-active" : "")}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onOpenPlace(r.place.id)}
                >
                  <span className="atlas-search__thumb">
                    {r.thumb ? (
                      <img className="atlas-photo" src={mediaSrc(r.thumb, 160)} alt="" draggable={false} />
                    ) : (
                      <span>{/^[A-Za-z]{2}$/.test(r.place.countryCode) ? <Flag code={r.place.countryCode} size={14} /> : <PinIcon size={14} />}</span>
                    )}
                  </span>
                  <span className="atlas-search__text">
                    <span className="atlas-search__label">
                      {r.place.name}
                      <span className="atlas-search__country">{r.place.country}</span>
                    </span>
                    <span className="atlas-search__sub">{r.matched ? "“" + r.matched + "”" : r.subtitle}</span>
                  </span>
                  <span className={"atlas-search__role atlas-search__role--" + r.role}>
                    {r.role === "current" ? <HomeIcon size={12} /> : r.role === "wish" ? <StarIcon size={12} /> : <PinIcon size={12} />}
                    {r.role === "current" ? t("Now") : r.role === "wish" ? t("Wish") : t("Memory")}
                  </span>
                  {r.role !== "wish" ? (
                    <button
                      type="button"
                      className="atlas-search__map"
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowOnMap(r.place.id);
                      }}
                      aria-label={t("Show {name} on the map", { name: r.place.name })}
                    >
                      {t("Map")}
                    </button>
                  ) : null}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
