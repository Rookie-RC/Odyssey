"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import { formatDateRange, getPrimaryMediaForPlace, targetTimeLabel, visitTypeLabel } from "../lib/domain";
import { mediaSrc } from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { ArrowRight, CompassIcon, PinIcon, SearchIcon, StarIcon, HomeIcon } from "./Icons";

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  detail?: string;
  hint?: string;
  active?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  media: Media[];
  profile: Profile | null;
  commands: PaletteCommand[];
  onClose: () => void;
  onOpenPlace: (placeId: string) => void;
  onShowOnMap: (placeId: string) => void;
}

interface PlaceResult {
  kind: "place";
  place: Place;
  role: "current" | "memory" | "wish";
  subtitle: string;
  matched?: string;
  score: number;
  thumb: Media | null;
}

interface CommandResult {
  kind: "command";
  command: PaletteCommand;
  score: number;
}

type Result = PlaceResult | CommandResult;

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

/** ⌘K / "/" — jump to any place, memory or wish, or run an Atlas command.
 * Enter opens the place; Shift+Enter shows it on the map. */
export default function CommandPalette({
  places,
  visits,
  wishlist,
  media,
  profile,
  commands,
  onClose,
  onOpenPlace,
  onShowOnMap,
}: CommandPaletteProps) {
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
      const role: PlaceResult["role"] = place.id === currentId ? "current" : pv.length > 0 ? "memory" : "wish";
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
      // Nothing typed: the current base and recent memories, then commands.
      const recent = placeIndex
        .filter((p) => p.role !== "wish")
        .sort((a, b) => (a.role === "current" ? -1 : b.role === "current" ? 1 : b.latest.localeCompare(a.latest)))
        .slice(0, 5)
        .map<PlaceResult>((p) => ({ kind: "place", place: p.place, role: p.role, subtitle: p.subtitle, score: 1, thumb: p.thumb }));
      return [...recent, ...commands.map<CommandResult>((c) => ({ kind: "command", command: c, score: 0 }))];
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
      if (score > 0) {
        out.push({ kind: "place", place: p.place, role: p.role, subtitle: p.subtitle, matched, score, thumb: p.thumb });
      }
    }
    for (const c of commands) {
      const s = Math.max(scoreText(c.label, q), scoreText(c.group + " " + c.label, q) * 0.8, scoreText(c.detail, q) * 0.5);
      if (s > 0) out.push({ kind: "command", command: c, score: s * 0.9 });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 40);
  }, [query, placeIndex, commands]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (r: Result, alt = false) => {
    if (r.kind === "place") {
      if (alt && r.role !== "wish") onShowOnMap(r.place.id);
      else onOpenPlace(r.place.id);
    } else {
      onClose();
      r.command.run();
    }
  };

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
      if (r) run(r, e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  // Group headings in display order.
  let lastGroup = "";
  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="atlas-dialog-backdrop atlas-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="atlas-palette" role="dialog" aria-modal="true" aria-label={t("Search the atlas")} onKeyDown={onKeyDown}>
        <div className="atlas-palette__input">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search places, memories, wishes… or type a command")}
            aria-label={t("Search")}
            aria-controls="atlas-palette-list"
            aria-activedescendant={results[active] ? "palette-item-" + active : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="atlas-kbd">Esc</span>
        </div>
        <div className="atlas-palette__list" id="atlas-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="atlas-palette__empty">
              <CompassIcon size={22} />
              <span>{t("Nothing in this atlas matches “{q}”.", { q: query })}</span>
            </div>
          ) : (
            results.map((r, i) => {
              const group =
                r.kind === "place" ? (hasQuery ? t("Places") : t("Recent")) : r.command.group;
              const heading = group !== lastGroup ? group : null;
              lastGroup = group;
              return (
                <div key={(r.kind === "place" ? "p-" + r.place.id : "c-" + r.command.id) + i}>
                  {heading ? <div className="atlas-palette__group">{heading}</div> : null}
                  <div
                    id={"palette-item-" + i}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className={"atlas-palette__item" + (i === active ? " is-active" : "")}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => run(r, e.shiftKey)}
                  >
                    {r.kind === "place" ? (
                      <>
                        <span className="atlas-palette__thumb">
                          {r.thumb ? (
                            <img className="atlas-photo" src={mediaSrc(r.thumb, 160)} alt="" draggable={false} />
                          ) : (
                            <span>{/^[A-Za-z]{2}$/.test(r.place.countryCode) ? <Flag code={r.place.countryCode} size={14} /> : <PinIcon size={14} />}</span>
                          )}
                        </span>
                        <span className="atlas-palette__text">
                          <span className="atlas-palette__label">
                            {r.place.name}
                            <span className="atlas-palette__country">{r.place.country}</span>
                          </span>
                          <span className="atlas-palette__sub">{r.matched ? "“" + r.matched + "”" : r.subtitle}</span>
                        </span>
                        <span className={"atlas-palette__role atlas-palette__role--" + r.role}>
                          {r.role === "current" ? <HomeIcon size={12} /> : r.role === "wish" ? <StarIcon size={12} /> : <PinIcon size={12} />}
                          {r.role === "current" ? t("Now") : r.role === "wish" ? t("Wish") : t("Memory")}
                        </span>
                        {i === active && r.role !== "wish" ? (
                          <button
                            type="button"
                            className="atlas-palette__map"
                            onClick={(e) => {
                              e.stopPropagation();
                              run(r, true);
                            }}
                            title={t("Show on map (Shift+Enter)")}
                          >
                            {t("Map")}
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="atlas-palette__thumb atlas-palette__thumb--cmd">
                          <ArrowRight size={14} />
                        </span>
                        <span className="atlas-palette__text">
                          <span className="atlas-palette__label">
                            {r.command.label}
                            {r.command.active ? <span className="atlas-palette__check">{t("Current")}</span> : null}
                          </span>
                          {r.command.detail ? <span className="atlas-palette__sub">{r.command.detail}</span> : null}
                        </span>
                        {r.command.hint ? <span className="atlas-kbd">{r.command.hint}</span> : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="atlas-palette__foot">
          <span>
            <span className="atlas-kbd">↑</span>
            <span className="atlas-kbd">↓</span> {t("move")}
          </span>
          <span>
            <span className="atlas-kbd">↵</span> {t("open")}
          </span>
          <span>
            <span className="atlas-kbd">⇧</span>
            <span className="atlas-kbd">↵</span> {t("show on map")}
          </span>
        </div>
      </div>
    </div>
  );
}
