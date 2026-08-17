"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import {
  getTimelineItems,
  getPrimaryMedia,
  seasonLabel,
  timeFraction,
  type TimelineNode,
} from "../lib/timeline";
import type { AtlasTheme } from "../themes";

interface JourneyTimelineProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  theme: AtlasTheme;
}

// Temporal-axis geometry. The scale is deliberately relaxed: nodes are laid out
// proportionally to time, then pushed apart to a minimum gap so the experience
// reads as a continuous temporal landscape rather than a strict ruler.
const PX_PER_YEAR = 200;
const MIN_NODE_GAP = 160;
const SIDE_PADDING = 160;
const LINE_Y = 64;
const CARD_TOP = LINE_Y + 22;
const TRACK_HEIGHT = 340;

// Fade-out duration. The hide is triggered immediately (no linger); this is
// only how long the subtle opacity fade takes to complete.
const PREVIEW_FADE_MS = 140;

interface PositionedNode {
  node: TimelineNode;
  x: number;
}

interface TimelineLayout {
  positions: PositionedNode[];
  firstX: number;
  lastX: number;
  trackWidth: number;
  nowX: number;
  minTranslate: number;
  maxTranslate: number;
  initialTranslate: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function computeLayout(
  nodes: TimelineNode[],
  viewportWidth: number,
  nowTime: number
): TimelineLayout | null {
  if (nodes.length === 0 || viewportWidth <= 0) return null;

  const minTime = Math.min(...nodes.map((n) => n.time));
  const positions: PositionedNode[] = nodes.map((node) => ({
    node,
    x: SIDE_PADDING + (node.time - minTime) * PX_PER_YEAR,
  }));

  // Enforce a minimum gap between neighbouring nodes (label collision avoidance).
  let prevX = -Infinity;
  for (const p of positions) {
    p.x = Math.max(p.x, prevX + MIN_NODE_GAP);
    prevX = p.x;
  }

  const firstX = positions[0].x;
  const lastX = positions[positions.length - 1].x;
  // A "future runway" after the last node keeps the open-ended future readable
  // and guarantees NOW can be centred even when the future side is short.
  const runway = Math.max(240, Math.round(viewportWidth / 2));
  const trackWidth = lastX + SIDE_PADDING + runway;

  const nowNode = positions.find((p) => p.node.kind === "now");
  const nowX = nowNode
    ? nowNode.x
    : SIDE_PADDING + (nowTime - minTime) * PX_PER_YEAR;

  const maxTranslate = 0;
  const minTranslate = viewportWidth - trackWidth;
  const initialTranslate = clamp(viewportWidth / 2 - nowX, minTranslate, maxTranslate);

  return {
    positions,
    firstX,
    lastX,
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
}

export default function JourneyTimeline({
  places,
  visits,
  wishlist,
  profile,
  media,
  theme,
}: JourneyTimelineProps) {
  const now = useMemo(() => new Date(), []);
  const nodes = useMemo(
    () => getTimelineItems(places, visits, wishlist, profile, now),
    [places, visits, wishlist, profile, now]
  );
  const nowTime = useMemo(() => timeFraction(now), [now]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<PreviewAnchor | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);

  const layout = useMemo(
    () => computeLayout(nodes, viewportWidth, nowTime),
    [nodes, viewportWidth, nowTime]
  );

  const userDraggedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startTranslate: number;
    moved: boolean;
  } | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  // --- immediate show / fade-out (no hover-persistence timer) ---
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

  const showPreview = useCallback(
    (id: string, el: HTMLElement) => {
      keepPreview();
      const r = el.getBoundingClientRect();
      setPreviewAnchor({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
      setPreviewId(id);
    },
    [keepPreview]
  );

  const hidePreview = useCallback(() => {
    if (fadeTimerRef.current != null) return; // already fading out
    setPreviewClosing(true);
    fadeTimerRef.current = window.setTimeout(() => {
      setPreviewId(null);
      setPreviewAnchor(null);
      setPreviewClosing(false);
      fadeTimerRef.current = null;
    }, PREVIEW_FADE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // Close the preview on Escape.
  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, closeNow]);

  // Close the preview when the page scrolls, so it never lingers detached from
  // a node that scrolled away (hover state doesn't update on scroll).
  useEffect(() => {
    if (!previewId) return;
    const onScroll = () => closeNow();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [previewId, closeNow]);

  // Measure the viewport width (needed for NOW centring and scroll clamping).
  // Depends on nodes.length because the viewport only mounts once data exists.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes.length]);

  // Centre on NOW on first layout; keep the user's position once they drag.
  useEffect(() => {
    if (layout && !userDraggedRef.current) {
      setTranslateX(layout.initialTranslate);
    }
  }, [layout]);

  const panBy = useCallback(
    (delta: number) => {
      if (!layout) return;
      setTranslateX((cur) => clamp(cur + delta, layout.minTranslate, layout.maxTranslate));
    },
    [layout]
  );

  // Drag is driven by window-level pointer listeners (no pointer capture) so a
  // plain click on a node button still dispatches natively. A small movement
  // threshold distinguishes a click from a drag; once a real drag starts we add
  // a `--dragging` class and suppress the click that follows the release, so a
  // drag never accidentally opens a node.
  const DRAG_THRESHOLD = 4;
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!layout || e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startTranslate: translateX,
        moved: false,
      };
      const move = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || !layout || ev.pointerId !== drag.pointerId) return;
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
            const suppressClick = (cev: MouseEvent) => {
              cev.preventDefault();
              cev.stopPropagation();
              window.removeEventListener("click", suppressClick, true);
            };
            window.addEventListener("click", suppressClick, true);
            setTimeout(() => window.removeEventListener("click", suppressClick, true), 500);
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [layout, translateX, closeNow]
  );

  // Horizontal wheel (trackpad / shift+wheel) pans the timeline; a dominant
  // vertical wheel is left to the page so normal scrolling still works.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (!layout) return;
      e.preventDefault();
      userDraggedRef.current = true;
      closeNow();
      panBy(-e.deltaX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout, panBy, closeNow]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        panBy(200);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        panBy(-200);
      } else if (e.key === "Home") {
        e.preventDefault();
        if (layout) setTranslateX(layout.maxTranslate);
      } else if (e.key === "End") {
        e.preventDefault();
        if (layout) setTranslateX(layout.minTranslate);
      }
    },
    [layout, panBy]
  );

  const lineGradient = useMemo(() => {
    if (!layout) return null;
    const ps = layout.positions;
    const neutral = theme.colors.border;
    const colorOf = (p: PositionedNode) =>
      p.node.season ? theme.seasons[p.node.season] : neutral;
    const span = layout.lastX - layout.firstX;
    const stops: { offset: string; color: string }[] = [
      { offset: "0%", color: colorOf(ps[0]) },
    ];
    for (let i = 1; i < ps.length; i++) {
      const prev = ps[i - 1];
      const cur = ps[i];
      const t = Math.min(48, (cur.x - prev.x) * 0.25);
      const f1 = ((cur.x - t - layout.firstX) / span) * 100;
      const f2 = ((cur.x + t - layout.firstX) / span) * 100;
      stops.push({ offset: f1.toFixed(2) + "%", color: colorOf(prev) });
      stops.push({ offset: f2.toFixed(2) + "%", color: colorOf(cur) });
    }
    return stops;
  }, [layout, theme]);

  const previewNode = useMemo(
    () => nodes.find((n) => n.id === previewId) ?? null,
    [nodes, previewId]
  );

  if (nodes.length === 0) {
    return (
      <section className="atlas-journey">
        <header className="atlas-journey__head">
          <h2 className="atlas-journey__title">My journey</h2>
        </header>
        <p className="atlas-timeline__empty">Nothing here yet.</p>
      </section>
    );
  }

  return (
    <section className="atlas-journey" aria-label="Journey timeline">
      <header className="atlas-journey__head">
        <h2 className="atlas-journey__title">My journey</h2>
      </header>

      <div
        className="atlas-timeline"
        role="region"
        aria-label="Horizontal timeline"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          ref={viewportRef}
          className="atlas-timeline__viewport"
          onPointerDown={onPointerDown}
        >
          {layout ? (
            <div
              className="atlas-timeline__track"
              style={{
                width: layout.trackWidth,
                height: TRACK_HEIGHT,
                transform: "translateX(" + translateX + "px)",
              }}
            >
              <svg
                className="atlas-timeline__svg"
                width={layout.trackWidth}
                height={TRACK_HEIGHT}
                aria-hidden="true"
              >
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
                <line
                  x1={layout.firstX}
                  y1={LINE_Y}
                  x2={layout.lastX}
                  y2={LINE_Y}
                  stroke="url(#tl-season-line)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                {/* Future runway: an open, dashed continuation of time. */}
                <line
                  x1={layout.lastX}
                  y1={LINE_Y}
                  x2={layout.trackWidth - SIDE_PADDING}
                  y2={LINE_Y}
                  stroke={theme.colors.border}
                  strokeWidth={1.5}
                  strokeDasharray="3 7"
                  strokeLinecap="round"
                />
              </svg>

              <span
                className="atlas-timeline__axis atlas-timeline__axis--past"
                style={{ left: layout.firstX, top: LINE_Y - 34 }}
              >
                Past
              </span>
              <span
                className="atlas-timeline__axis atlas-timeline__axis--future"
                style={{ left: layout.lastX + 32, top: LINE_Y - 34 }}
              >
                Future
              </span>

              {/* NOW anchor tick on the line itself. */}
              <span
                className="atlas-timeline__now-tick"
                style={{ left: layout.nowX, top: LINE_Y }}
              >
                <span className="atlas-timeline__now-tick-label">Now</span>
              </span>

              {layout.positions.map((p) => (
                <NodeColumn
                  key={p.node.id}
                  positioned={p}
                  theme={theme}
                  media={media}
                  active={previewId === p.node.id}
                  onShow={(el) => showPreview(p.node.id, el)}
                  onHide={hidePreview}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {previewNode && previewAnchor ? (
        <TimelinePreviewCard
          node={previewNode}
          media={media}
          theme={theme}
          anchor={previewAnchor}
          closing={previewClosing}
          onMouseEnter={keepPreview}
          onMouseLeave={hidePreview}
        />
      ) : null}
    </section>
  );
}

interface NodeColumnProps {
  positioned: PositionedNode;
  theme: AtlasTheme;
  media: Media[];
  active: boolean;
  onShow: (el: HTMLElement) => void;
  onHide: () => void;
}

function NodeColumn({
  positioned,
  theme,
  media,
  active,
  onShow,
  onHide,
}: NodeColumnProps) {
  const { node, x } = positioned;
  const seasonColor = node.season ? theme.seasons[node.season] : null;
  const primaryMedia = getPrimaryMedia(node.mediaIds, media);
  const depthClass = depthClassFor(node);

  // The whole column (marker + card) is one unit: hovering any part shows the
  // preview (anchored to the marker), and the card stays clickable for touch.
  return (
    <button
      type="button"
      className={"atlas-tl-node" + (active ? " atlas-tl-node--active" : "")}
      style={{ left: x, top: LINE_Y }}
      aria-label={node.place.name + ", " + node.place.country + " — " + node.dateLabel}
      onMouseEnter={(e) => onShow(e.currentTarget)}
      onMouseLeave={onHide}
      onFocus={(e) => onShow(e.currentTarget)}
      onBlur={onHide}
      onClick={(e) => onShow(e.currentTarget)}
    >
      <span
        className={"atlas-tl-node__marker atlas-tl-node__marker--" + node.kind + " " + depthClass}
        style={seasonColor && node.kind === "future" ? { borderColor: seasonColor } : undefined}
      >
        <span className="atlas-tl-node__dot" />
      </span>

      <span className="atlas-tl-card" style={{ top: CARD_TOP - LINE_Y }}>
        {primaryMedia ? (
          <img
            className="atlas-tl-card__img"
            src={primaryMedia.path}
            alt={primaryMedia.caption ?? node.place.name}
            loading="lazy"
            draggable={false}
          />
        ) : null}
        <span className="atlas-tl-card__name">{node.place.name}</span>
        <span className="atlas-tl-card__country">{node.place.country}</span>
        <span className="atlas-tl-card__meta">
          <span
            className="atlas-tl-card__date"
            style={seasonColor ? { color: seasonColor } : undefined}
          >
            {node.dateLabel}
          </span>
          <span className="atlas-tl-card__sep"> · </span>
          <span>{node.metaLabel}</span>
        </span>
      </span>
    </button>
  );
}

function depthClassFor(node: TimelineNode): string {
  if (node.kind === "now") return "atlas-tl-node__marker--strong";
  if (node.kind === "future") return "";
  if (node.depthRank >= 4) return "atlas-tl-node__marker--strong";
  if (node.depthRank === 3) return "atlas-tl-node__marker--mid";
  return "atlas-tl-node__marker--faint";
}

function TimelinePreviewCard({
  node,
  media,
  theme,
  anchor,
  closing,
  onMouseEnter,
  onMouseLeave,
}: {
  node: TimelineNode;
  media: Media[];
  theme: AtlasTheme;
  anchor: PreviewAnchor;
  closing: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const cardW = Math.min(280, vw - 24);
  const left = clamp(anchor.cx, cardW / 2 + 12, vw - cardW / 2 - 12);
  const primaryMedia = getPrimaryMedia(node.mediaIds, media);
  const seasonColor = node.season ? theme.seasons[node.season] : null;
  const stateLabel =
    node.kind === "now" ? "Current" : node.kind === "past" ? "Visited" : "Wishlist";
  const context = node.why ?? node.reflection ?? null;
  const inspiration = node.inspirations?.find(
    (i) => i.title || i.creator || i.platform || i.note
  );

  return (
    <div
      className={"atlas-tl-preview" + (closing ? " atlas-tl-preview--closing" : "")}
      style={{
        left,
        top: anchor.cy - 14,
        width: cardW,
        transform: "translate(-50%, -100%)",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {primaryMedia ? (
        <img
          className="atlas-tl-preview__img"
          src={primaryMedia.path}
          alt={primaryMedia.caption ?? node.place.name}
          draggable={false}
        />
      ) : null}
      <div className="atlas-tl-preview__body">
        <div className="atlas-tl-preview__state" style={seasonColor ? { color: seasonColor } : undefined}>
          {stateLabel}
          {node.season ? " · " + seasonLabel(node.season) : ""}
        </div>
        <div className="atlas-tl-preview__name">{node.place.name}</div>
        <div className="atlas-tl-preview__country">{node.place.country}</div>
        <div className="atlas-tl-preview__meta">
          {node.dateLabel}
          {node.metaLabel ? " · " + node.metaLabel : ""}
          {node.withFriends ? " · With friends" : ""}
        </div>
        {context ? <p className="atlas-tl-preview__context">{context}</p> : null}
        {inspiration ? (
          <p className="atlas-tl-preview__inspiration">
            Inspired by {inspiration.title ?? inspiration.creator ?? inspiration.platform}
            {inspiration.platform ? " · " + inspiration.platform : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
