"use client";

import { useMemo } from "react";
import Flag from "./Flag";
import type { Media, Place, Profile, Season, Visit, Wishlist } from "../lib/types";
import {
  getJourney,
  getPrimaryMedia,
  getTimelineItems,
  seasonLabel,
  timeFraction,
  type JourneyEntry,
  type TimelineNode,
} from "../lib/timeline";
import { atlasFacts, atlasFactsLine, formatDateRange, getPrimaryMediaForPlace } from "../lib/domain";
import { mediaSrc } from "../lib/api";
import { abroadBands, abroadMilestones, summarizeAbroad, type AbroadMilestone, type AbroadSummary } from "../lib/abroad";
import { activityLabel } from "../lib/activity";
import { TRANSPORT_GLYPH, transportLabel } from "../lib/transport";
import { t, useLocale } from "../lib/i18n";
import { ActivityIcon, ArrowRight, HomeIcon, PlusIcon, SeasonIcon, TransportIcon } from "./Icons";

interface JourneyTimelineProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  /** False until the first data load finishes (no premature empty state). */
  loaded?: boolean;
  onOpenPlace?: (placeId: string) => void;
  /** The open "Where next?" entry at the end of what lies ahead. */
  onWhereNext?: () => void;
  /** Empty atlas + writable: start the first memory. */
  onAddFirst?: () => void;
}

/** The season's colour from the theme, or the neutral line colour. */
function seasonVar(season: Season | null | undefined): string {
  return season ? "var(--season-" + season + ")" : "var(--border-strong)";
}

/** "Jun 1 – 5, 2023", "Sep 2015 – Jul 2020"; a future wish says its own time,
 * a visit without a date nothing (it sits under "Earlier"). */
function dateText(node: TimelineNode): string {
  if (node.kind === "future") return node.dateLabel;
  const start = node.startDate ?? node.endDate;
  return start ? formatDateRange(start, node.startDate ? node.endDate : undefined) : "";
}

// --- The line ---
// Every entry draws its own stretch of the line (styles/journey.css): from the
// middle of the entry above, through its node, to the middle of the one below,
// shading from one season's colour into the next.

interface LineProps {
  /** Seasons of the neighbours, for shading (undefined at the ends). */
  prev?: Season | null;
  next?: Season | null;
  /** The ends of a thread: it starts at the first node and fades after the last. */
  first: boolean;
  last: boolean;
}

function lineAt(seasons: (Season | null)[], i: number): LineProps {
  return {
    prev: i > 0 ? seasons[i - 1] : undefined,
    next: i < seasons.length - 1 ? seasons[i + 1] : undefined,
    first: i === 0,
    last: i === seasons.length - 1,
  };
}

interface ItemProps {
  variant: "now" | "ahead" | "past" | "milestone" | "open";
  season: Season | null;
  line: LineProps;
  /** Weight of the node by how deep the visit was. */
  depth?: "strong" | "mid" | "faint";
  /** The stretch of line above / below runs through time abroad. */
  abroadUp?: boolean;
  abroadDown?: boolean;
  /** A year heading sits above: the line runs behind it. */
  yearStart?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function Item({ variant, season, line, depth, abroadUp, abroadDown, yearStart, icon, children }: ItemProps) {
  const className =
    "atlas-tl-item atlas-tl-item--" +
    variant +
    (season ? " atlas-tl-item--" + season : "") +
    (depth ? " atlas-tl-item--" + depth : "") +
    (line.first ? " atlas-tl-item--first" : "") +
    (line.last ? " atlas-tl-item--last" : "") +
    (yearStart ? " atlas-tl-item--year-start" : "") +
    (abroadUp ? " atlas-tl-item--band-up" : "") +
    (abroadDown ? " atlas-tl-item--band-down" : "");
  const style = {
    "--tl-prev": seasonVar(line.prev === undefined ? season : line.prev),
    "--tl-next": seasonVar(line.next === undefined ? season : line.next),
  } as React.CSSProperties;
  return (
    <li className={className} style={style}>
      <span className="atlas-tl-node" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  );
}

/** Landing for an arrival, take-off for the final return, a house for a trip
 * home (the plane is the map's own route glyph). */
function MilestoneIcon({ kind }: { kind: AbroadMilestone["kind"] }) {
  if (kind === "home") return <HomeIcon size={13} strokeWidth={1.8} />;
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d={TRANSPORT_GLYPH.plane}
        transform={"rotate(" + (kind === "arrive" ? 135 : 45) + " 12 12)"}
      />
    </svg>
  );
}

// --- Entries ---

/** "Day 412 · TUM · MSc": how long the current stay abroad has lasted. */
function AbroadLine({ abroad }: { abroad: AbroadSummary }) {
  return (
    <span className="atlas-tl-card__abroad">
      <span className="atlas-tl-chip">{t("Day {n}", { n: abroad.dayNumber ?? abroad.days })}</span>
      <span className="atlas-break">{abroad.period.label || t("Studying abroad")}</span>
    </span>
  );
}

function NodeEntry({
  node,
  photo,
  seasonStart = false,
  isNow = false,
  abroad = null,
  onOpen,
}: {
  node: TimelineNode;
  photo: Media | null;
  /** The list names the season here (a new run of it begins). */
  seasonStart?: boolean;
  /** The anchor at the top: current base, and how long the stay abroad has lasted. */
  isNow?: boolean;
  abroad?: AbroadSummary | null;
  onOpen?: (placeId: string) => void;
}) {
  const date = isNow ? t("Now") : dateText(node);
  const since = isNow && node.startDate && !node.endDate ? t("Since {date}", { date: formatDateRange(node.startDate) }) : "";
  const label = [
    node.place.name + ", " + node.place.country + (date ? " — " + date : ""),
    node.metaLabel,
    since,
    node.transport ? transportLabel(node.transport) : "",
    node.activity ? activityLabel(node.activity) : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button type="button" className="atlas-tl-entry" aria-label={label} onClick={() => onOpen?.(node.place.id)}>
      <span className="atlas-tl-stamp">
        {isNow ? (
          <span className="atlas-tl-stamp__now">{date}</span>
        ) : (
          <>
            {node.season ? <SeasonIcon season={node.season} size={13} className="atlas-tl-stamp__icon" /> : null}
            {seasonStart && node.season ? (
              <span className="atlas-tl-stamp__season">{seasonLabel(node.season)}</span>
            ) : null}
            {date ? <span className="atlas-date">{date}</span> : null}
          </>
        )}
      </span>
      <span className="atlas-tl-card">
        {photo ? (
          <span className="atlas-tl-card__thumb">
            <img className="atlas-photo" src={mediaSrc(photo, 160)} alt="" loading="lazy" draggable={false} />
          </span>
        ) : null}
        <span className="atlas-tl-card__body">
          <span className="atlas-tl-card__name atlas-break">
            {node.place.name}
            <Flag code={node.place.countryCode} size={13} className="atlas-tl-card__flag" />
          </span>
          <span className="atlas-tl-card__meta">
            <span>{node.metaLabel}</span>
            {since ? <span className="atlas-date">{since}</span> : null}
            {node.transport ? (
              <span>
                <TransportIcon mode={node.transport} size={13} />
              </span>
            ) : null}
            {node.activity ? (
              <span>
                <ActivityIcon activity={node.activity} size={13} />
                {activityLabel(node.activity)}
              </span>
            ) : null}
          </span>
          {isNow && abroad ? <AbroadLine abroad={abroad} /> : null}
        </span>
      </span>
    </button>
  );
}

/** The anchor when no current base is set: just the moment itself. */
function NowMarker({ abroad }: { abroad: AbroadSummary | null }) {
  return (
    <div className="atlas-tl-entry">
      <span className="atlas-tl-stamp">
        <span className="atlas-tl-stamp__now">{t("Now")}</span>
      </span>
      {abroad ? (
        <span className="atlas-tl-card atlas-tl-card--plain">
          <span className="atlas-tl-card__body">
            <AbroadLine abroad={abroad} />
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** Arriving, a trip home, the final return: context, not a memory. */
function MilestoneEntry({ milestone: m }: { milestone: AbroadMilestone }) {
  return (
    <div className="atlas-tl-entry atlas-tl-entry--static">
      <span className="atlas-tl-stamp">
        <span className="atlas-date">{m.dateLabel}</span>
      </span>
      <span className="atlas-tl-milestone">
        <span className="atlas-tl-milestone__title">{m.title}</span>
        {m.detail ? <span className="atlas-tl-card__meta atlas-break">{m.detail}</span> : null}
      </span>
    </div>
  );
}

export default function JourneyTimeline({
  places,
  visits,
  wishlist,
  profile,
  media,
  loaded = true,
  onOpenPlace,
  onWhereNext,
  onAddFirst,
}: JourneyTimelineProps) {
  const now = useMemo(() => new Date(), []);
  const locale = useLocale();
  const nowTime = useMemo(() => timeFraction(now), [now]);
  const nodes = useMemo(
    () => getTimelineItems(places, visits, wishlist, profile, now),
    [places, visits, wishlist, profile, now, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const journey = useMemo(
    () => getJourney(nodes, nowTime, abroadMilestones(profile?.abroad), abroadBands(profile?.abroad, nowTime)),
    [nodes, nowTime, profile]
  );

  // A visit's own photograph, else any the place has (the card opens the place).
  const photos = useMemo(() => {
    const out = new Map<string, Media>();
    for (const n of nodes) {
      const photo = getPrimaryMedia(n.mediaIds, media) ?? getPrimaryMediaForPlace(n.place.id, visits, wishlist, media);
      if (photo) out.set(n.id, photo);
    }
    return out;
  }, [nodes, media, visits, wishlist]);

  // The stay abroad you are in the middle of, if any.
  const abroad = useMemo(() => {
    const ongoing = (profile?.abroad ?? [])
      .map((p) => summarizeAbroad(p, [], [], now))
      .filter((s) => s.dayNumber != null)
      .sort((a, b) => b.period.startDate.localeCompare(a.period.startDate));
    return ongoing[0] ?? null;
  }, [profile, now]);

  const glance = useMemo(
    () => atlasFactsLine(atlasFacts(places, visits, wishlist)),
    [places, visits, wishlist, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const header = (
    <header className="atlas-journey__head">
      <h2 className="atlas-eyebrow atlas-section-head__title">{t("My journey")}</h2>
      {nodes.length > 0 && glance ? <p className="atlas-journey__glance">{glance}</p> : null}
    </header>
  );

  if (nodes.length === 0) {
    // Nothing to show: still loading, or a new atlas.
    if (!loaded) {
      return (
        <section className="atlas-journey" id="journey" aria-label={t("Journey timeline")} aria-busy="true">
          {header}
          <div className="atlas-journey__skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      );
    }
    return (
      <section className="atlas-journey" id="journey" aria-label={t("Journey timeline")}>
        {header}
        <div className="atlas-journey__empty">
          <div className="atlas-journey__empty-line" aria-hidden="true">
            <span className="atlas-journey__empty-now">{t("Now")}</span>
            <span />
          </div>
          <p className="atlas-display">{t("Your journey begins here.")}</p>
          <span className="atlas-journey__empty-sub">
            {t("Add a visit or a wish in Manage Atlas and it will take its place on the line.")}
          </span>
          {onAddFirst ? (
            <button type="button" className="atlas-btn atlas-btn--primary atlas-journey__empty-cta" onClick={onAddFirst}>
              <PlusIcon size={14} /> {t("Add your first place")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const renderEntry = (entry: JourneyEntry, line: LineProps, variant: "ahead" | "past", yearStart = false) => {
    const common = { season: entry.season, line, abroadUp: entry.abroadUp, abroadDown: entry.abroadDown, yearStart };
    if (entry.milestone) {
      return (
        <Item key={entry.id} variant="milestone" icon={<MilestoneIcon kind={entry.milestone.kind} />} {...common}>
          <MilestoneEntry milestone={entry.milestone} />
        </Item>
      );
    }
    const node = entry.node;
    const depth = node.depthRank >= 4 ? "strong" : node.depthRank === 3 ? "mid" : "faint";
    return (
      <Item key={entry.id} variant={variant} depth={variant === "past" ? depth : undefined} {...common}>
        <NodeEntry
          node={node}
          photo={photos.get(node.id) ?? null}
          seasonStart={entry.seasonStart}
          onOpen={onOpenPlace}
        />
      </Item>
    );
  };

  // Thread one: NOW, what lies ahead, and the open end of it.
  const aheadSeasons: (Season | null)[] = [
    journey.now?.season ?? null,
    ...journey.ahead.map((e) => e.season),
    ...(onWhereNext ? [null] : []),
  ];
  const nowNode = journey.now?.node;

  // Thread two: the past, a stretch of line running behind the year headings.
  const pastEntries = journey.past.flatMap((g) => g.entries);
  const pastSeasons = pastEntries.map((e) => e.season);
  let pastIndex = 0;

  return (
    <section className="atlas-journey" id="journey" aria-label={t("Journey timeline")}>
      {header}

      <ol className="atlas-tl-list atlas-tl-list--ahead">
        <Item variant="now" season={journey.now?.season ?? null} line={lineAt(aheadSeasons, 0)} abroadDown={journey.now?.abroadDown}>
          {nowNode ? (
            <NodeEntry node={nowNode} photo={photos.get(nowNode.id) ?? null} isNow abroad={abroad} onOpen={onOpenPlace} />
          ) : (
            <NowMarker abroad={abroad} />
          )}
        </Item>
        {journey.ahead.map((entry, i) => renderEntry(entry, lineAt(aheadSeasons, i + 1), "ahead"))}
        {onWhereNext ? (
          <Item variant="open" season={null} line={lineAt(aheadSeasons, aheadSeasons.length - 1)}>
            <button type="button" className="atlas-tl-entry" onClick={onWhereNext}>
              <span className="atlas-tl-stamp">
                <span className="atlas-date">{t("Future")}</span>
              </span>
              <span className="atlas-tl-card atlas-tl-card--open">
                <span className="atlas-tl-card__plus" aria-hidden="true">
                  <PlusIcon size={18} />
                </span>
                <span className="atlas-tl-card__body">
                  <span className="atlas-tl-card__name">{t("Where next?")}</span>
                  <span className="atlas-tl-card__meta">{t("Dreaming ahead. One season, many possibilities.")}</span>
                </span>
                <ArrowRight size={16} className="atlas-tl-card__go" />
              </span>
            </button>
          </Item>
        ) : null}
      </ol>

      {journey.past.length > 0 ? (
        <ol className="atlas-tl-list atlas-tl-list--past">
          {journey.past.map((group, gi) => (
            <li key={group.year ?? "earlier"} className="atlas-tl-year">
              <h3 className="atlas-tl-year__title">{group.year != null ? t("{year}", { year: group.year }) : t("Earlier")}</h3>
              <ol className="atlas-tl-list">
                {group.entries.map((entry, ei) =>
                  renderEntry(entry, lineAt(pastSeasons, pastIndex++), "past", gi > 0 && ei === 0)
                )}
              </ol>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
