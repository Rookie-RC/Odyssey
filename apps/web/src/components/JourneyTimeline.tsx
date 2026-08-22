"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Media, Place, Profile, Season, Visit, Wishlist } from "../lib/types";
import {
  getTimelineItems,
  getPrimaryMedia,
  seasonLabel,
  timeFraction,
  type TimelineNode,
} from "../lib/timeline";
import type { SyncFocus } from "../lib/sync";
import type { AtlasTheme } from "../themes";

interface JourneyTimelineProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  theme: AtlasTheme;
  /** Season selected in Where Next; matching future nodes get a subtle
   * emphasis so the shelf and the Timeline speak to each other. */
  emphasizedSeason?: Season | null;
  /** True while an overlay (place detail / profile) is open or closing. */
  overlayOpen: boolean;
  /** Shared Map ↔ Timeline focus (v1.3). The Timeline responds when the map
   * initiated (`source === "map"`): it brings the focused node into view and
   * keeps it emphasized. Timeline-initiated focus is purely visual here. */
  focus?: SyncFocus | null;
  /** Emitted when the user clicks/selects a node (Timeline → Map sync). */
  onSelectNode?: (node: TimelineNode) => void;
  onOpenPlace?: (placeId: string) => void;
}

// Temporal-axis geometry. The scale is deliberately relaxed: nodes are laid out
// proportionally to time, then pushed apart to a minimum gap so the experience
// reads as a continuous temporal landscape rather than a strict ruler.
const PX_PER_YEAR = 200;
const MIN_NODE_GAP = 160;
const SIDE_PADDING = 160;
// The line sits between two card lanes (season polarity, VISUAL_SPEC §8 + the
// alternating-lane refinement): cards alternate above/below the line by season,
// so the track reserves vertical space for both lanes.
const LINE_Y = 220;
const CARD_GAP = 26;
const TRACK_HEIGHT = 480;

// Fade-out duration. The hide is triggered immediately (no linger); this is
// only how long the subtle opacity fade takes to complete.
const PREVIEW_FADE_MS = 140;

// Deterministic season → lane polarity. Adjacent seasons alternate sides;
// same-season cards always share a side. The initial polarity (spring below)
// is arbitrary but fixed, and applies to past and future alike.
type Lane = "above" | "below";
const SEASON_LANE: Record<Season, Lane> = {
  spring: "below",
  summer: "above",
  autumn: "below",
  winter: "above",
};

interface PositionedNode {
  node: TimelineNode;
  x: number;
  lane: Lane;
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
    lane: "below",
  }));

  // Enforce a minimum gap between neighbouring nodes (label collision avoidance).
  let prevX = -Infinity;
  for (const p of positions) {
    p.x = Math.max(p.x, prevX + MIN_NODE_GAP);
    prevX = p.x;
  }

  // Assign lanes by season; nodes without a season inherit the previous node's
  // lane so the alternation stays deterministic.
  let prevLane: Lane = "below";
  for (const p of positions) {
    p.lane = p.node.season ? SEASON_LANE[p.node.season] : prevLane;
    prevLane = p.lane;
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

interface PreviewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PreviewAnchor {
  cx: number;
  cy: number;
  /** Lane of the hovered node's primary card; the preview prefers the opposite
   * lane so it never covers the card. */
  lane: Lane;
  /** Real on-screen bounds of the source primary card, used to guarantee the
   * preview never covers it even in fallback placements. */
  cardRect: PreviewRect | null;
}

export default function JourneyTimeline({
  places,
  visits,
  wishlist,
  profile,
  media,
  theme,
  emphasizedSeason = null,
  overlayOpen,
  focus = null,
  onSelectNode,
  onOpenPlace,
}: JourneyTimelineProps) {
  const now = useMemo(() => new Date(), []);
  const nodes = useMemo(
    () => getTimelineItems(places, visits, wishlist, profile, now),
    [places, visits, wishlist, profile, now]
  );
  const nowTime = useMemo(() => timeFraction(now), [now]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
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

  // An overlay (Place Detail / Profile) supersedes the hover preview.
  useEffect(() => {
    if (overlayOpen) closeNow();
  }, [overlayOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const r = el.getBoundingClientRect();
      const lane =
        layout?.positions.find((p) => p.node.id === id)?.lane ?? "below";
      const card = el.querySelector(".atlas-tl-card");
      const cardRect = card ? card.getBoundingClientRect() : null;
      setPreviewAnchor({
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        lane,
        cardRect: cardRect
          ? { left: cardRect.left, right: cardRect.right, top: cardRect.top, bottom: cardRect.bottom }
          : null,
      });
      setPreviewId(id);
    },
    [keepPreview, layout]
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
  // a node that scrolled away (hover state doesn't update on scroll) and never
  // drifts into the collapsed map strip.
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

  // --- Map → Timeline auto-scroll (v1.3) ---
  // Only a map-initiated focus moves the Timeline. The move is smooth (a
  // temporary transform transition on the track) and brings the node toward
  // the centre of the viewport. Any manual input — pointer down, wheel — is
  // the user taking over: the transition is cancelled immediately so manual
  // control always wins.
  const autoScrollTimerRef = useRef<number | null>(null);
  const translateXRef = useRef(0);
  translateXRef.current = translateX;
  const cancelAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current != null) {
      window.clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    trackRef.current?.classList.remove("atlas-timeline__track--animate");
  }, []);

  useEffect(() => {
    cancelAutoScroll();
    if (!focus || focus.source !== "map" || !layout) return;
    const p = layout.positions.find((x) => x.node.id === focus.nodeId);
    if (!p) return;
    const target = clamp(
      viewportWidth / 2 - p.x,
      layout.minTranslate,
      layout.maxTranslate
    );
    // Skip when the node is already comfortably central (tolerance ~10% of
    // the viewport) — no needless movement. Reads the live position via a
    // ref so this effect only ever fires on a focus/layout change, never on
    // every translateX update (which would fight manual dragging).
    if (Math.abs(translateXRef.current - target) < viewportWidth * 0.1) return;
    trackRef.current?.classList.add("atlas-timeline__track--animate");
    setTranslateX(target);
    autoScrollTimerRef.current = window.setTimeout(() => {
      trackRef.current?.classList.remove("atlas-timeline__track--animate");
      autoScrollTimerRef.current = null;
    }, 620);
  }, [focus, layout, viewportWidth, cancelAutoScroll]);

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
      // The user is taking over: cancel any in-flight auto-scroll animation
      // immediately (v1.3 sync).
      cancelAutoScroll();
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
    [layout, translateX, closeNow, cancelAutoScroll]
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
      cancelAutoScroll(); // manual control takes precedence
      closeNow();
      panBy(-e.deltaX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout, panBy, closeNow, cancelAutoScroll]);

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

  const nowLane = useMemo(
    () => layout?.positions.find((p) => p.node.kind === "now")?.lane ?? "below",
    [layout]
  );

  // The node in shared Map ↔ Timeline focus (v1.3).
  const focusedNodeId = focus?.nodeId ?? null;

  if (nodes.length === 0) {
    return (
      <section className="atlas-journey">
        <header className="atlas-journey__head">
          <h2 className="atlas-journey__title">My journey</h2>
        </header>
        <div className="atlas-timeline__empty">
          <p>No journey yet.</p>
          <span className="atlas-timeline__empty-sub">
            Add a visit or a wish in Manage Atlas and it will appear here on the timeline.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="atlas-journey" aria-label="Journey timeline">
      <header className="atlas-journey__head">
        <h2 className="atlas-journey__title">My journey</h2>
        <div className="atlas-journey__hint" aria-hidden="true">
          <span>Past</span>
          <span className="atlas-journey__hint-arrow">←</span>
          <span className="atlas-journey__hint-mid">Drag or scroll</span>
          <span className="atlas-journey__hint-arrow">→</span>
          <span>Future</span>
        </div>
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
              ref={trackRef}
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
                style={{ left: 8, top: LINE_Y + 6 }}
              >
                Past
              </span>
              <span
                className="atlas-timeline__axis atlas-timeline__axis--future"
                style={{ left: layout.trackWidth - SIDE_PADDING, top: LINE_Y + 6 }}
              >
                Future
              </span>

              {/* NOW anchor tick on the line itself; its label flips below the
                  line when the NOW card occupies the lane above. */}
              <span
                className={
                  "atlas-timeline__now-tick" +
                  (nowLane === "above" ? " atlas-timeline__now-tick--label-below" : "")
                }
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
                  focused={focusedNodeId === p.node.id}
                  emphasizedSeason={emphasizedSeason}
                  onShow={(el) => showPreview(p.node.id, el)}
                  onHide={hidePreview}
                  onSelect={onSelectNode}
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
          onOpenDetail={() => openDetail(previewNode.place.id)}
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
  /** Shared Map ↔ Timeline focus (v1.3): a clear but restrained highlight. */
  focused: boolean;
  emphasizedSeason?: Season | null;
  onShow: (el: HTMLElement) => void;
  onHide: () => void;
  onSelect?: (node: TimelineNode) => void;
}

function NodeColumn({
  positioned,
  theme,
  media,
  active,
  focused,
  emphasizedSeason = null,
  onShow,
  onHide,
  onSelect,
}: NodeColumnProps) {
  const { node, x, lane } = positioned;
  const seasonColor = node.season ? theme.seasons[node.season] : null;
  const primaryMedia = getPrimaryMedia(node.mediaIds, media);
  const depthClass = depthClassFor(node);
  const seasonEmphasis =
    node.kind === "future" && node.season != null && node.season === emphasizedSeason;

  // The whole column (marker + card) is one unit: hovering any part shows the
  // preview (anchored to the marker), and the card stays clickable for touch.
  // The button is a zero-height anchor on the line; the marker sits centred on
  // the line and the card extends into its season's lane (above or below),
  // connected by a subtle stem.
  return (
    <button
      type="button"
      className={
        "atlas-tl-node" +
        " atlas-tl-node--lane-" + lane +
        (active ? " atlas-tl-node--active" : "") +
        (focused ? " atlas-tl-node--focused" : "") +
        (seasonEmphasis ? " atlas-tl-node--season-emphasis" : "")
      }
      style={{ left: x, top: LINE_Y, "--tl-node-season": seasonColor ?? undefined } as React.CSSProperties}
      aria-label={node.place.name + ", " + node.place.country + " — " + node.dateLabel}
      onMouseEnter={(e) => onShow(e.currentTarget)}
      onMouseLeave={onHide}
      onFocus={(e) => onShow(e.currentTarget)}
      onBlur={onHide}
      onClick={(e) => {
        onShow(e.currentTarget);
        onSelect?.(node);
      }}
    >
      <span className="atlas-tl-node__stem" aria-hidden="true" />
      <span
        className={"atlas-tl-node__marker atlas-tl-node__marker--" + node.kind + " " + depthClass}
      >
        <span
          className="atlas-tl-node__dot"
          style={node.kind === "future" && seasonColor ? { borderColor: seasonColor } : undefined}
        />
      </span>

      <span className="atlas-tl-card">
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

// --- Adaptive preview placement ---
// The preview is anchored to its node and, once measured, placed to stay inside
// the usable viewport: never under the collapsed map strip, never off-screen,
// and never covering its own source primary card.
//
// Priority (source-card-aware):
//   1. the card's lane decides the preferred side — the preview occupies the
//      OPPOSITE lane whenever possible;
//   2. horizontal overflow is solved by shifting left/right on the same side
//      (the caret then points back at the node);
//   3. only when the preferred side is genuinely unavailable (map strip,
//      viewport or Timeline container boundary) do we fall back — to the other
//      side, but horizontally shifted until it clears the source card, so the
//      card stays visible and the preview is never placed on top of it.

const PREVIEW_GAP = 14;
const PREVIEW_EDGE = 12;
const CARD_CLEAR_MARGIN = 12;

function computePreviewPlacement(anchor: PreviewAnchor, cardW: number, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Usable top: below the collapsed map strip (when it covers the viewport top).
  const strip = document.querySelector(".atlas-map-clip");
  const stripBottom = strip ? strip.getBoundingClientRect().bottom : 0;
  const topBoundary = Math.min(stripBottom + 8, vh - PREVIEW_EDGE);

  // Usable horizontal range: the viewport intersected with the Timeline
  // container (so the preview never escapes the section it belongs to).
  let hMin = PREVIEW_EDGE;
  let hMax = vw - PREVIEW_EDGE;
  const timeline = document.querySelector(".atlas-timeline");
  if (timeline) {
    const tr = timeline.getBoundingClientRect();
    hMin = Math.max(hMin, tr.left + PREVIEW_EDGE);
    hMax = Math.min(hMax, tr.right - PREVIEW_EDGE);
  }

  const topFor = (side: Lane) =>
    side === "above" ? anchor.cy - PREVIEW_GAP - cardH : anchor.cy + PREVIEW_GAP;
  const fits = (side: Lane) => {
    const top = topFor(side);
    return top >= topBoundary && top + cardH <= vh - PREVIEW_EDGE;
  };
  const flip = (side: Lane): Lane => (side === "above" ? "below" : "above");

  // Preferred: opposite the source card's lane.
  const preferred: Lane = anchor.lane === "above" ? "below" : "above";
  let side: Lane;
  let center = anchor.cx; // default: horizontally centred on the node

  if (fits(preferred)) {
    side = preferred;
  } else if (fits(flip(preferred))) {
    // Preferred side genuinely blocked (strip / viewport / container): fall back
    // to the card's own lane, but shift horizontally so the preview clears the
    // source card — it must never sit on top of it.
    side = flip(preferred);
    center = avoidSourceCard(anchor, cardW, hMin, hMax);
  } else {
    // Extreme (tiny viewport): take the side with more room, still clearing the
    // source card when that side happens to be the card's lane.
    const aboveTop = topFor("above");
    const belowTop = topFor("below");
    const aboveRoom = aboveTop >= topBoundary ? aboveTop - topBoundary : -Infinity;
    const belowRoom = belowTop + cardH <= vh - PREVIEW_EDGE ? vh - PREVIEW_EDGE - belowTop : -Infinity;
    side = aboveRoom >= belowRoom ? "above" : "below";
    if (side === flip(preferred)) {
      center = avoidSourceCard(anchor, cardW, hMin, hMax);
    }
  }

  const left = clamp(center, hMin + cardW / 2, hMax - cardW / 2);
  const top = topFor(side);
  // Caret offset keeps the connector pointing at the node when shifted sideways.
  const caret = clamp(anchor.cx - left, -(cardW / 2 - 16), cardW / 2 - 16);
  return { left, top, side, caret };
}

// Chooses a horizontal preview centre that keeps the preview entirely clear of
// the source primary card, preferring the side nearest to the node and staying
// inside the usable horizontal range.
function avoidSourceCard(
  anchor: PreviewAnchor,
  cardW: number,
  hMin: number,
  hMax: number
): number {
  const half = cardW / 2;
  const margin = CARD_CLEAR_MARGIN;
  const leftEdge = anchor.cardRect ? anchor.cardRect.left : anchor.cx - 75;
  const rightEdge = anchor.cardRect ? anchor.cardRect.right : anchor.cx + 75;
  const leftCenter = leftEdge - half - margin; // preview entirely left of the card
  const rightCenter = rightEdge + half + margin; // entirely right of the card
  const minCenter = hMin + half;
  const maxCenter = hMax - half;
  const candidates = [leftCenter, rightCenter].sort(
    (a, b) => Math.abs(a - anchor.cx) - Math.abs(b - anchor.cx)
  );
  for (const c of candidates) {
    if (c >= minCenter && c <= maxCenter) return c;
  }
  // No side fully clears the card within range: clamp toward the edge with the
  // most room (extreme narrow-viewport case).
  return anchor.cx > (minCenter + maxCenter) / 2 ? maxCenter : minCenter;
}

function TimelinePreviewCard({
  node,
  media,
  theme,
  anchor,
  closing,
  onMouseEnter,
  onMouseLeave,
  onOpenDetail,
}: {
  node: TimelineNode;
  media: Media[];
  theme: AtlasTheme;
  anchor: PreviewAnchor;
  closing: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenDetail: () => void;
}) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const cardW = Math.min(280, vw - 24);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardH, setCardH] = useState(0);
  const [bump, setBump] = useState(0); // forces re-placement on resize

  // Measure the real card height before placing it (no flicker: the placement
  // state is set synchronously in a layout effect, before paint).
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
      ref={cardRef}
      className={
        "atlas-tl-preview" +
        (closing ? " atlas-tl-preview--closing" : "") +
        (placement.side === "below" ? " atlas-tl-preview--below" : "")
      }
      style={{
        left: placement.left,
        top: placement.top,
        width: cardW,
        transform: "translateX(-50%)",
        "--tl-caret": placement.caret + "px",
      } as React.CSSProperties}
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
        <button type="button" className="atlas-tl-preview__action" onClick={onOpenDetail}>
          {node.kind === "future" ? "View wish" : "View memory"}
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              d="M2 8h11M9 3.5 13.5 8 9 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
