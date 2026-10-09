"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Media, Place, Profile, Season, Visit, Wishlist } from "../lib/types";
import {
  getTimelineItems,
  getPrimaryMedia,
  seasonLabel,
  timeFraction,
  type TimelineNode,
} from "../lib/timeline";
import { mediaSrc } from "../lib/api";
import { abroadBands, abroadMilestones, type AbroadBand, type AbroadMilestone } from "../lib/abroad";
import { TRANSPORT_GLYPH } from "../lib/transport";
import type { SyncFocus } from "../lib/sync";
import { t, useLocale } from "../lib/i18n";
import type { AtlasTheme } from "../themes";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  HomeIcon,
  LongArrowLeft,
  LongArrowRight,
  PlusIcon,
  SeasonIcon,
} from "./Icons";

interface JourneyTimelineProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  theme: AtlasTheme;
  /** False until the first data load finishes (no premature empty state). */
  loaded?: boolean;
  /** Season selected in Where Next; matching future nodes get a subtle
   * emphasis so the shelf and the Timeline speak to each other. */
  emphasizedSeason?: Season | null;
  overlayOpen: boolean;
  /** Shared Map ↔ Timeline focus (v1.3). The Timeline responds when the map
   * initiated (`source === "map"`): it brings the focused node into view. */
  focus?: SyncFocus | null;
  onSelectNode?: (node: TimelineNode) => void;
  onOpenPlace?: (placeId: string) => void;
  /** The open "Where next?" node at the end of the line. */
  onWhereNext?: () => void;
  /** Empty atlas + writable: start the first memory. */
  onAddFirst?: () => void;
}

// Temporal-axis geometry. Nodes are laid out proportionally to time, then
// pushed apart to a minimum gap, so the line reads as a continuous temporal
// landscape rather than a strict ruler (VISUAL_SPEC §7). Seasons label the
// line from above; memory fragments hang below it (reference composition).
const PX_PER_YEAR = 230;
const MIN_NODE_GAP = 178;
const SIDE_PADDING = 120;
const LINE_Y = 96;
const TRACK_HEIGHT = 330;
const CARD_W = 150;
const OPEN_NODE_GAP = 190;
/** Gap next to a study-abroad milestone (its card is narrower). */
const MILESTONE_GAP = 145;

const PREVIEW_FADE_MS = 140;

interface PositionedNode {
  node: TimelineNode;
  x: number;
}

interface PositionedMilestone {
  milestone: AbroadMilestone;
  x: number;
}

interface SeasonMark {
  x: number;
  season: Season;
  year: number;
}

interface TimelineLayout {
  positions: PositionedNode[];
  milestones: PositionedMilestone[];
  /** Stretches of the line spent abroad (home trips cut out), in px. */
  abroadSegments: { x1: number; x2: number }[];
  seasonMarks: SeasonMark[];
  firstX: number;
  lastX: number;
  openX: number;
  trackWidth: number;
  nowX: number;
  minTranslate: number;
  maxTranslate: number;
  initialTranslate: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function seasonYear(node: TimelineNode): number {
  // Winter spans New Year; December belongs to the following winter's label.
  const y = Math.floor(node.time);
  const month = Math.floor((node.time - y) * 12) + 1;
  return node.season === "winter" && month === 12 ? y + 1 : y;
}

function computeLayout(
  nodes: TimelineNode[],
  viewportWidth: number,
  nowTime: number,
  milestones: AbroadMilestone[] = [],
  bands: AbroadBand[] = []
): TimelineLayout | null {
  if (nodes.length === 0 || viewportWidth <= 0) return null;

  // Place nodes and study-abroad milestones share one axis and one spacing
  // rule. The nodes keep their own order (getTimelineItems' tie-breaks); a
  // milestone goes before the nodes at a later time — and, for an arrival,
  // before those at the same time (you land, then you live there).
  type Item = { time: number; x: number; node?: TimelineNode; milestone?: AbroadMilestone };
  const items: Item[] = [];
  const pending = [...milestones].sort((a, b) => a.time - b.time);
  for (const node of nodes) {
    while (pending.length > 0 && (pending[0].time < node.time || (pending[0].time === node.time && pending[0].kind === "arrive"))) {
      const m = pending.shift()!;
      items.push({ time: m.time, x: 0, milestone: m });
    }
    items.push({ time: node.time, x: 0, node });
  }
  for (const m of pending) items.push({ time: m.time, x: 0, milestone: m });

  const minTime = Math.min(...items.map((i) => i.time));
  let prev: Item | null = null;
  for (const it of items) {
    const gap = !prev ? 0 : prev.node && it.node ? MIN_NODE_GAP : MILESTONE_GAP;
    it.x = Math.max(SIDE_PADDING + (it.time - minTime) * PX_PER_YEAR, prev ? prev.x + gap : -Infinity);
    prev = it;
  }
  const positions: PositionedNode[] = items.filter((i) => i.node).map((i) => ({ node: i.node!, x: i.x }));
  const placedMilestones: PositionedMilestone[] = items
    .filter((i) => i.milestone)
    .map((i) => ({ milestone: i.milestone!, x: i.x }));

  // Season header: one mark where the season (or its year) changes along the
  // line. The NOW column carries the NOW pill instead.
  const seasonMarks: SeasonMark[] = [];
  let last: string | null = null;
  for (const p of positions) {
    if (!p.node.season) continue;
    const key = p.node.season + seasonYear(p.node);
    if (key === last) continue;
    last = key;
    if (p.node.kind === "now") continue;
    seasonMarks.push({ x: p.x, season: p.node.season, year: seasonYear(p.node) });
  }

  const firstX = items[0].x;
  const lastX = items[items.length - 1].x;
  const openX = lastX + OPEN_NODE_GAP;
  const runway = Math.max(200, Math.round(viewportWidth / 2 - CARD_W));
  const trackWidth = openX + CARD_W / 2 + runway;

  const nowNode = positions.find((p) => p.node.kind === "now");
  const nowX = nowNode ? nowNode.x : SIDE_PADDING + (nowTime - minTime) * PX_PER_YEAR;

  // A time's x on the pushed-apart axis: interpolated between its laid-out
  // neighbours (the NOW anchor included), proportional beyond the ends.
  const anchors = [...items.map((i) => ({ time: i.time, x: i.x })), { time: nowTime, x: nowX }].sort(
    (a, b) => a.time - b.time || a.x - b.x
  );
  const xAt = (time: number): number => {
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (time <= first.time) return first.x - (first.time - time) * PX_PER_YEAR;
    if (time >= last.time) return last.x + (time - last.time) * PX_PER_YEAR;
    let i = 0;
    while (anchors[i + 1].time < time) i++;
    const a = anchors[i];
    const b = anchors[i + 1];
    return b.time === a.time ? b.x : a.x + ((time - a.time) / (b.time - a.time)) * (b.x - a.x);
  };
  const abroadSegments: { x1: number; x2: number }[] = [];
  for (const band of bands) {
    let from = band.from;
    for (const [g1, g2] of band.gaps) {
      if (g1 > from) abroadSegments.push({ x1: xAt(from), x2: xAt(g1) });
      from = Math.max(from, g2);
    }
    if (band.to > from) abroadSegments.push({ x1: xAt(from), x2: xAt(band.to) });
  }

  const maxTranslate = 0;
  const minTranslate = Math.min(0, viewportWidth - trackWidth);
  const initialTranslate = clamp(viewportWidth / 2 - nowX, minTranslate, maxTranslate);

  return {
    positions,
    milestones: placedMilestones,
    abroadSegments,
    seasonMarks,
    firstX,
    lastX,
    openX,
    trackWidth,
    nowX,
    minTranslate,
    maxTranslate,
    initialTranslate,
  };
}

interface PreviewAnchor {
  cx: number;
  cy: number;
  cardRect: { left: number; right: number; top: number; bottom: number } | null;
}

export default function JourneyTimeline({
  places,
  visits,
  wishlist,
  profile,
  media,
  theme,
  loaded = true,
  emphasizedSeason = null,
  overlayOpen,
  focus = null,
  onSelectNode,
  onOpenPlace,
  onWhereNext,
  onAddFirst,
}: JourneyTimelineProps) {
  const now = useMemo(() => new Date(), []);
  const locale = useLocale();
  const nodes = useMemo(
    () => getTimelineItems(places, visits, wishlist, profile, now),
    [places, visits, wishlist, profile, now, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nowTime = useMemo(() => timeFraction(now), [now]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<PreviewAnchor | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);

  const milestones = useMemo(
    () => abroadMilestones(profile?.abroad),
    [profile, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const bands = useMemo(() => abroadBands(profile?.abroad, nowTime), [profile, nowTime]);
  const layout = useMemo(
    () => computeLayout(nodes, viewportWidth, nowTime, milestones, bands),
    [nodes, viewportWidth, nowTime, milestones, bands]
  );

  const userDraggedRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startClientX: number; startTranslate: number; moved: boolean } | null>(
    null
  );
  const fadeTimerRef = useRef<number | null>(null);

  // --- preview: immediate show / short fade-out ---
  const keepPreview = useCallback(() => {
    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setPreviewClosing(false);
  }, []);

  const closeNow = useCallback(() => {
    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setPreviewId(null);
    setPreviewAnchor(null);
    setPreviewClosing(false);
  }, []);

  useEffect(() => {
    if (overlayOpen) closeNow();
  }, [overlayOpen, closeNow]);

  const openDetail = useCallback(
    (placeId: string) => {
      closeNow();
      onOpenPlace?.(placeId);
    },
    [closeNow, onOpenPlace]
  );

  const showPreview = useCallback(
    (id: string, el: HTMLElement) => {
      keepPreview();
      const dot = el.querySelector(".atlas-tl-node__dot") ?? el;
      const r = dot.getBoundingClientRect();
      const card = el.querySelector(".atlas-tl-card");
      const cr = card ? card.getBoundingClientRect() : null;
      setPreviewAnchor({
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        cardRect: cr ? { left: cr.left, right: cr.right, top: cr.top, bottom: cr.bottom } : null,
      });
      setPreviewId(id);
    },
    [keepPreview]
  );

  const hidePreview = useCallback(() => {
    if (fadeTimerRef.current != null) return;
    setPreviewClosing(true);
    fadeTimerRef.current = window.setTimeout(() => {
      setPreviewId(null);
      setPreviewAnchor(null);
      setPreviewClosing(false);
      fadeTimerRef.current = null;
    }, PREVIEW_FADE_MS);
  }, []);

  useEffect(() => () => {
    if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow();
    };
    const onScroll = () => closeNow();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [previewId, closeNow]);

  // Measure the viewport (NOW centring and pan clamping).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes.length]);

  // Centre on NOW on first layout; keep the user's position once they pan.
  useEffect(() => {
    if (layout && !userDraggedRef.current) setTranslateX(layout.initialTranslate);
  }, [layout]);

  // --- smooth pans (Map → Timeline sync, arrows); manual input cancels ---
  const animTimerRef = useRef<number | null>(null);
  const translateXRef = useRef(0);
  translateXRef.current = translateX;
  const cancelAnim = useCallback(() => {
    if (animTimerRef.current != null) {
      window.clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    trackRef.current?.classList.remove("atlas-timeline__track--animate");
  }, []);

  const animateTo = useCallback(
    (target: number) => {
      if (!layout) return;
      cancelAnim();
      trackRef.current?.classList.add("atlas-timeline__track--animate");
      setTranslateX(clamp(target, layout.minTranslate, layout.maxTranslate));
      animTimerRef.current = window.setTimeout(() => {
        trackRef.current?.classList.remove("atlas-timeline__track--animate");
        animTimerRef.current = null;
      }, 620);
    },
    [layout, cancelAnim]
  );

  useEffect(() => {
    if (!focus || focus.source !== "map" || !layout) return;
    const p = layout.positions.find((x) => x.node.id === focus.nodeId);
    if (!p) return;
    const target = clamp(viewportWidth / 2 - p.x, layout.minTranslate, layout.maxTranslate);
    if (Math.abs(translateXRef.current - target) < viewportWidth * 0.1) return;
    userDraggedRef.current = true;
    animateTo(target);
  }, [focus, layout, viewportWidth, animateTo]);

  const panBy = useCallback(
    (delta: number, animate = false) => {
      if (!layout) return;
      userDraggedRef.current = true;
      if (animate) animateTo(translateXRef.current + delta);
      else setTranslateX((cur) => clamp(cur + delta, layout.minTranslate, layout.maxTranslate));
    },
    [layout, animateTo]
  );

  // Drag via window-level pointer listeners (no capture) so a plain click on a
  // node still dispatches; a 4px threshold separates click from drag and the
  // click after a real drag is swallowed.
  const DRAG_THRESHOLD = 4;
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!layout || e.button !== 0) return;
      cancelAnim();
      dragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startTranslate: translateX, moved: false };
      const move = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        const dx = ev.clientX - drag.startClientX;
        if (!drag.moved && Math.abs(dx) > DRAG_THRESHOLD) {
          drag.moved = true;
          userDraggedRef.current = true;
          closeNow();
          viewportRef.current?.classList.add("atlas-timeline__viewport--dragging");
        }
        if (drag.moved) {
          setTranslateX(clamp(drag.startTranslate + dx, layout.minTranslate, layout.maxTranslate));
        }
      };
      const end = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || ev.pointerId !== drag.pointerId) return;
        const wasDrag = drag.moved;
        dragRef.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (wasDrag) {
          viewportRef.current?.classList.remove("atlas-timeline__viewport--dragging");
          if (ev.type === "pointerup") {
            const suppress = (cev: MouseEvent) => {
              cev.preventDefault();
              cev.stopPropagation();
              window.removeEventListener("click", suppress, true);
            };
            window.addEventListener("click", suppress, true);
            setTimeout(() => window.removeEventListener("click", suppress, true), 500);
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [layout, translateX, closeNow, cancelAnim]
  );

  // Horizontal wheel (trackpad / shift+wheel) pans; vertical wheel scrolls the page.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const dx = e.shiftKey && Math.abs(e.deltaX) < 1 ? e.deltaY : e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      if (!layout) return;
      e.preventDefault();
      cancelAnim();
      closeNow();
      panBy(-dx);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout, panBy, closeNow, cancelAnim]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!layout) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        panBy(220, true);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        panBy(-220, true);
      } else if (e.key === "Home") {
        e.preventDefault();
        userDraggedRef.current = true;
        animateTo(layout.maxTranslate);
      } else if (e.key === "End") {
        e.preventDefault();
        userDraggedRef.current = true;
        animateTo(layout.minTranslate);
      } else if (e.key === "n" || e.key === "N") {
        animateTo(layout.initialTranslate);
      }
    },
    [layout, panBy, animateTo]
  );

  const lineGradient = useMemo(() => {
    if (!layout) return null;
    const ps = layout.positions;
    const neutral = theme.colors.borderStrong;
    const colorOf = (p: PositionedNode) => (p.node.season ? theme.seasons[p.node.season] : neutral);
    const span = Math.max(1, layout.lastX - layout.firstX);
    const stops: { offset: string; color: string }[] = [{ offset: "0%", color: colorOf(ps[0]) }];
    for (let i = 1; i < ps.length; i++) {
      const prev = ps[i - 1];
      const cur = ps[i];
      const t = Math.min(56, (cur.x - prev.x) * 0.3);
      stops.push({ offset: (((cur.x - t - layout.firstX) / span) * 100).toFixed(2) + "%", color: colorOf(prev) });
      stops.push({ offset: (((cur.x + t - layout.firstX) / span) * 100).toFixed(2) + "%", color: colorOf(cur) });
    }
    return stops;
  }, [layout, theme]);

  const previewNode = useMemo(() => nodes.find((n) => n.id === previewId) ?? null, [nodes, previewId]);
  const focusedNodeId = focus?.nodeId ?? null;

  // Scroll indicator geometry.
  const indicator = useMemo(() => {
    if (!layout || viewportWidth <= 0) return null;
    const total = layout.trackWidth;
    if (total <= viewportWidth + 1) return null;
    const frac = viewportWidth / total;
    const range = layout.maxTranslate - layout.minTranslate;
    const pos = range > 0 ? (layout.maxTranslate - translateX) / range : 0;
    return { frac, pos };
  }, [layout, viewportWidth, translateX]);

  const atStart = !layout || translateX >= layout.maxTranslate - 1;
  const atEnd = !layout || translateX <= layout.minTranslate + 1;

  const header = (
    <header className="atlas-section-head atlas-journey__head">
      <h2 className="atlas-eyebrow atlas-section-head__title">{t("My journey")}</h2>
      <div className="atlas-journey__hint" aria-hidden="true">
        <span>{t("Past")}</span>
        <LongArrowLeft size={34} />
        <span className="atlas-journey__hint-mid">{t("Drag or scroll")}</span>
        <LongArrowRight size={34} />
        <span>{t("Future")}</span>
      </div>
    </header>
  );

  if (loaded && nodes.length === 0) {
    return (
      <section className="atlas-journey" id="journey" aria-label={t("Journey timeline")}>
        {header}
        <div className="atlas-timeline__empty">
          <div className="atlas-timeline__empty-line" aria-hidden="true">
            <span />
            <span className="atlas-timeline__empty-now">{t("Now")}</span>
            <span />
          </div>
          <p className="atlas-display">{t("Your journey begins here.")}</p>
          <span className="atlas-timeline__empty-sub">
            {t(
              "Add a visit or a wish in Manage Atlas and it will take its place on the line — past to the left, future to the right."
            )}
          </span>
          {onAddFirst ? (
            <button type="button" className="atlas-btn atlas-btn--primary atlas-timeline__empty-cta" onClick={onAddFirst}>
              <PlusIcon size={14} /> {t("Add your first place")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="atlas-journey" id="journey" aria-label={t("Journey timeline")}>
      {header}

      <div className="atlas-timeline">
        <button
          type="button"
          className="atlas-icon-btn atlas-timeline__arrow"
          onClick={() => panBy(Math.round(viewportWidth * 0.6), true)}
          disabled={atStart}
          aria-label={t("Earlier")}
        >
          <ChevronLeft size={18} />
        </button>

        <div
          ref={viewportRef}
          className="atlas-timeline__viewport"
          onPointerDown={onPointerDown}
          role="region"
          aria-label={t("Horizontal timeline — use arrow keys to move through time")}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {layout ? (
            <div
              ref={trackRef}
              className="atlas-timeline__track"
              style={{ width: layout.trackWidth, height: TRACK_HEIGHT, transform: "translateX(" + translateX + "px)" }}
            >
              <svg className="atlas-timeline__svg" width={layout.trackWidth} height={TRACK_HEIGHT} aria-hidden="true">
                <defs>
                  {lineGradient ? (
                    <linearGradient
                      id="tl-season-line"
                      gradientUnits="userSpaceOnUse"
                      x1={layout.firstX}
                      y1={LINE_Y}
                      x2={layout.lastX}
                      y2={LINE_Y}
                    >
                      {lineGradient.map((s, i) => (
                        <stop key={i} offset={s.offset} stopColor={s.color} />
                      ))}
                    </linearGradient>
                  ) : null}
                </defs>
                {/* Time spent abroad: a soft band under the line. */}
                {layout.abroadSegments.map((seg, i) => (
                  <rect
                    key={i}
                    className="atlas-tl-abroad-band"
                    x={seg.x1}
                    y={LINE_Y - 7}
                    width={Math.max(0, seg.x2 - seg.x1)}
                    height={14}
                    rx={7}
                  />
                ))}
                {/* Earlier: a faint lead-in from the past. */}
                <line
                  x1={24}
                  y1={LINE_Y}
                  x2={layout.firstX}
                  y2={LINE_Y}
                  stroke={theme.colors.borderStrong}
                  strokeWidth={1.5}
                  strokeDasharray="2 6"
                  strokeLinecap="round"
                />
                <line
                  x1={layout.firstX}
                  y1={LINE_Y}
                  x2={Math.max(layout.lastX, layout.firstX + 1)}
                  y2={LINE_Y}
                  stroke="url(#tl-season-line)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                {/* The open future: a dashed continuation of time. */}
                <line
                  x1={layout.lastX}
                  y1={LINE_Y}
                  x2={layout.trackWidth - 24}
                  y2={LINE_Y}
                  stroke={theme.colors.borderStrong}
                  strokeWidth={1.5}
                  strokeDasharray="3 7"
                  strokeLinecap="round"
                />
              </svg>

              {layout.seasonMarks.map((m) => (
                <span
                  key={m.x + m.season}
                  className={"atlas-tl-season atlas-season-ink--" + m.season}
                  style={{ left: m.x, top: LINE_Y }}
                  aria-hidden="true"
                >
                  <SeasonIcon season={m.season} size={17} />
                  <span className="atlas-tl-season__name">{seasonLabel(m.season)}</span>
                  <span className="atlas-tl-season__year">{m.year}</span>
                </span>
              ))}

              <span className="atlas-tl-now" style={{ left: layout.nowX, top: LINE_Y }} aria-hidden="true">
                <span className="atlas-tl-now__pill">{t("Now")}</span>
                <span className="atlas-tl-now__rule" />
              </span>

              {layout.milestones.map(({ milestone: m, x }) => (
                <span
                  key={m.id}
                  className={"atlas-tl-milestone atlas-tl-milestone--" + m.kind}
                  style={{ left: x, top: LINE_Y }}
                >
                  <span className="atlas-tl-milestone__dot" aria-hidden="true">
                    <MilestoneIcon kind={m.kind} />
                  </span>
                  <span className="atlas-tl-node__stem" aria-hidden="true" />
                  <span className="atlas-tl-milestone__card">
                    <span className="atlas-tl-card__date atlas-date">{m.dateLabel}</span>
                    <span className="atlas-tl-milestone__title">{m.title}</span>
                    {m.detail ? <span className="atlas-tl-card__meta atlas-break">{m.detail}</span> : null}
                  </span>
                </span>
              ))}

              {layout.positions.map((p) => (
                <NodeColumn
                  key={p.node.id}
                  positioned={p}
                  media={media}
                  active={previewId === p.node.id}
                  focused={focusedNodeId === p.node.id}
                  emphasizedSeason={emphasizedSeason}
                  onShow={(el) => showPreview(p.node.id, el)}
                  onHide={hidePreview}
                  onSelect={(node) => onSelectNode?.(node)}
                  onOpen={(node) => openDetail(node.place.id)}
                />
              ))}

              <button
                type="button"
                className="atlas-tl-open"
                style={{ left: layout.openX, top: LINE_Y }}
                onClick={onWhereNext}
              >
                <span className="atlas-tl-open__dot" aria-hidden="true" />
                <span className="atlas-tl-open__card">
                  <span className="atlas-tl-open__box" aria-hidden="true">
                    <PlusIcon size={18} />
                  </span>
                  <span className="atlas-tl-card__date atlas-date">
                    {t("{year}", {
                      year: Math.max(now.getFullYear() + 1, Math.ceil(layout.positions[layout.positions.length - 1].node.time)),
                    })}
                  </span>
                  <span className="atlas-tl-open__label">
                    {t("Where next?")} <ArrowRight size={13} />
                  </span>
                  <span className="atlas-tl-card__meta">{t("Future")}</span>
                </span>
              </button>
            </div>
          ) : (
            <div className="atlas-timeline__skeleton" aria-hidden="true">
              <span />
            </div>
          )}
        </div>

        <button
          type="button"
          className="atlas-icon-btn atlas-timeline__arrow"
          onClick={() => panBy(-Math.round(viewportWidth * 0.6), true)}
          disabled={atEnd}
          aria-label={t("Later")}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="atlas-timeline__indicator" aria-hidden="true">
        {indicator ? (
          <span
            className="atlas-timeline__indicator-thumb"
            style={{
              width: indicator.frac * 100 + "%",
              left: indicator.pos * (1 - indicator.frac) * 100 + "%",
            }}
          />
        ) : null}
      </div>

      {previewNode && previewAnchor ? (
        <TimelinePreviewCard
          node={previewNode}
          media={media}
          anchor={previewAnchor}
          closing={previewClosing}
          onMouseEnter={keepPreview}
          onMouseLeave={hidePreview}
          onOpenDetail={() => openDetail(previewNode.place.id)}
        />
      ) : null}
    </section>
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

interface NodeColumnProps {
  positioned: PositionedNode;
  media: Media[];
  active: boolean;
  focused: boolean;
  emphasizedSeason?: Season | null;
  onShow: (el: HTMLElement) => void;
  onHide: () => void;
  onSelect: (node: TimelineNode) => void;
  onOpen: (node: TimelineNode) => void;
}

function NodeColumn({
  positioned,
  media,
  active,
  focused,
  emphasizedSeason = null,
  onShow,
  onHide,
  onSelect,
  onOpen,
}: NodeColumnProps) {
  const { node, x } = positioned;
  const photo = getPrimaryMedia(node.mediaIds, media);
  const seasonEmphasis = node.kind === "future" && node.season != null && node.season === emphasizedSeason;
  const sizeClass =
    node.kind === "now"
      ? "atlas-tl-node--now"
      : node.kind === "future"
        ? "atlas-tl-node--future"
        : node.depthRank >= 4
          ? "atlas-tl-node--strong"
          : node.depthRank === 3
            ? "atlas-tl-node--mid"
            : "atlas-tl-node--faint";

  return (
    <button
      type="button"
      className={
        "atlas-tl-node " +
        sizeClass +
        (node.season ? " atlas-tl-node--" + node.season : "") +
        (active ? " atlas-tl-node--active" : "") +
        (focused ? " atlas-tl-node--focused" : "") +
        (seasonEmphasis ? " atlas-tl-node--season-emphasis" : "")
      }
      style={{ left: x, top: LINE_Y } as React.CSSProperties}
      aria-label={node.place.name + ", " + node.place.country + " — " + node.dateLabel + ", " + node.metaLabel}
      onMouseEnter={(e) => onShow(e.currentTarget)}
      onMouseLeave={onHide}
      onFocus={(e) => onShow(e.currentTarget)}
      onBlur={onHide}
      onClick={(e) => {
        onShow(e.currentTarget);
        onSelect(node);
      }}
      onDoubleClick={() => onOpen(node)}
    >
      <span className="atlas-tl-node__dot" aria-hidden="true" />
      <span className="atlas-tl-node__stem" aria-hidden="true" />
      <span className="atlas-tl-card">
        <span className="atlas-tl-card__media">
          {photo ? (
            <img
              className="atlas-tl-card__img atlas-photo"
              src={mediaSrc(photo, 320)}
              alt=""
              loading="lazy"
              draggable={false}
            />
          ) : (
            <span className="atlas-tl-card__placeholder" aria-hidden="true">
              <span className="atlas-tl-card__initial">{Array.from(node.place.name)[0]}</span>
              <Flag code={node.place.countryCode} size={12} className="atlas-tl-card__flag" />
            </span>
          )}
        </span>
        <span className="atlas-tl-card__date">
          <span className="atlas-tl-card__season-dot" aria-hidden="true" />
          <span className="atlas-date">{node.dateLabel}</span>
        </span>
        <span className="atlas-tl-card__name atlas-break">{node.place.name}</span>
        <span className="atlas-tl-card__meta">{node.kind === "now" ? t("Living here") : node.metaLabel}</span>
      </span>
    </button>
  );
}

// --- Anchored preview card ---
// Cards hang below the line, so the preview opens above the node when there
// is room (never under the collapsed map strip), else below — shifted
// sideways until it clears the node's own card.

const PREVIEW_GAP = 16;
const PREVIEW_EDGE = 12;

function computePreviewPlacement(anchor: PreviewAnchor, cardW: number, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const band = document.querySelector(".atlas-map-band");
  const topBoundary = Math.min((band ? band.getBoundingClientRect().bottom : 0) + 8, vh - PREVIEW_EDGE);
  let hMin = PREVIEW_EDGE;
  let hMax = vw - PREVIEW_EDGE;
  const tl = document.querySelector(".atlas-timeline");
  if (tl) {
    const r = tl.getBoundingClientRect();
    hMin = Math.max(hMin, r.left);
    hMax = Math.min(hMax, r.right);
  }
  const aboveTop = anchor.cy - PREVIEW_GAP - cardH;
  let side: "above" | "below" = "above";
  let center = anchor.cx;
  let top = aboveTop;
  if (aboveTop < topBoundary) {
    side = "below";
    top = anchor.cy + PREVIEW_GAP;
    // Clear the node's own card (it hangs directly below the dot).
    const cr = anchor.cardRect;
    if (cr) {
      const rightC = cr.right + 12 + cardW / 2;
      const leftC = cr.left - 12 - cardW / 2;
      center = rightC + cardW / 2 <= hMax ? rightC : leftC;
    }
  }
  const left = clamp(center, hMin + cardW / 2, hMax - cardW / 2);
  const caret = clamp(anchor.cx - left, -(cardW / 2 - 18), cardW / 2 - 18);
  return { left, top, side, caret, detached: Math.abs(center - anchor.cx) > 2 };
}

function TimelinePreviewCard({
  node,
  media,
  anchor,
  closing,
  onMouseEnter,
  onMouseLeave,
  onOpenDetail,
}: {
  node: TimelineNode;
  media: Media[];
  anchor: PreviewAnchor;
  closing: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenDetail: () => void;
}) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const cardW = Math.min(290, vw - 24);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(0);
  const [bump, setBump] = useState(0);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => {
      setCardH(el.offsetHeight);
      setBump((b) => b + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const placement = useMemo(
    () => computePreviewPlacement(anchor, cardW, cardH),
    [anchor, cardW, cardH, bump] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const photo = getPrimaryMedia(node.mediaIds, media);
  const stateLabel = node.kind === "now" ? t("Current") : node.kind === "past" ? t("Visited") : t("Wishlist");
  const context = node.why ?? node.reflection ?? null;
  const inspiration = node.inspirations?.find((i) => i.title || i.creator || i.platform || i.note);

  return (
    <div
      ref={cardRef}
      className={
        "atlas-tl-preview" +
        (closing ? " atlas-tl-preview--closing" : "") +
        (placement.side === "below" ? " atlas-tl-preview--below" : "") +
        (placement.detached ? " atlas-tl-preview--detached" : "")
      }
      style={
        {
          left: placement.left,
          top: placement.top,
          width: cardW,
          "--tl-caret": placement.caret + "px",
        } as React.CSSProperties
      }
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {photo ? (
        <img className="atlas-tl-preview__img atlas-photo" src={mediaSrc(photo, 640)} alt="" draggable={false} />
      ) : null}
      <div className="atlas-tl-preview__body">
        <div className={"atlas-tl-preview__state" + (node.season ? " atlas-season-ink--" + node.season : "")}>
          {node.season ? <SeasonIcon season={node.season} size={13} /> : null}
          {stateLabel}
          {node.season ? " · " + seasonLabel(node.season) : ""}
        </div>
        <div className="atlas-tl-preview__name atlas-break">{node.place.name}</div>
        <div className="atlas-tl-preview__meta">
          {node.place.country} · <span className="atlas-date">{node.dateLabel}</span>
          {node.metaLabel && node.kind !== "now" ? " · " + node.metaLabel : ""}
          {node.withFriends ? " · " + t("With friends") : ""}
        </div>
        {context ? <p className="atlas-tl-preview__context">{context}</p> : null}
        {inspiration ? (
          <p className="atlas-tl-preview__inspiration">
            {t("Inspired by {source}", {
              source:
                (inspiration.title ?? inspiration.creator ?? inspiration.platform ?? inspiration.note ?? "") +
                (inspiration.platform && inspiration.title ? " · " + inspiration.platform : ""),
            })}
          </p>
        ) : null}
        <button type="button" className="atlas-tl-preview__action" onClick={onOpenDetail}>
          {node.kind === "future" ? t("View wish") : t("View memory")}
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}
