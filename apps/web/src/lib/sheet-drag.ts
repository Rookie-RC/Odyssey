// Dragging a bottom sheet down to put it away, the way phone sheets behave:
// the sheet follows the finger, goes on past a distance or a quick flick, and
// springs back otherwise. Touch only. The sheets are bottom sheets under
// 720px (styles/overlays.css) and the hook leaves wider layouts alone.
import { useEffect, useRef, type RefObject } from "react";

/** How long the sheet takes to slide away, or to spring back. */
export const SLIDE_MS = 240;

/** From the top of the sheet (its grabber) a drag always starts; lower down it
 * starts only when the sheet's own scroll is at the top, so content scrolling
 * keeps working. */
const HANDLE_PX = 28;

export interface Sample {
  y: number;
  t: number;
}

/** Finger speed in px/ms over the last 100 ms; 0 when it rested before lifting. */
export function flickSpeed(samples: Sample[], now: number): number {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > 100) return 0;
  const first = samples.find((s) => last.t - s.t <= 100) ?? last;
  return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
}

/** A drag puts the sheet away when it went far enough, or was thrown. */
export function shouldDismiss(distance: number, speed: number, height: number): boolean {
  return distance > Math.min(height * 0.25, 160) || (speed > 0.5 && distance > 24);
}

/** A row of chips or photos that scrolls sideways owns its horizontal swipes. */
function scrollsSideways(from: Element | null, stop: Element): boolean {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/** The nearest ancestor of `from`, inside `stop`, that scrolls vertically. */
function scrollerOf(from: Element | null, stop: Element): HTMLElement | null {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
      return el as HTMLElement;
    }
  }
  return null;
}

interface Drag {
  x: number;
  y: number;
  /** What the touch began in, if that scrolls: it must be at its top to hand the gesture over. */
  scroller: HTMLElement | null;
  /** The touch began on the grabber, whatever the scroll position. */
  handle: boolean;
  active: boolean;
  offset: number;
  samples: Sample[];
}

/** Makes `shellRef` (a `.atlas-sheet` with a `.atlas-sheet__grabber`) draggable
 * down; `onDismiss` runs as it slides away, and should unmount it after
 * SLIDE_MS. Transitions collapse under prefers-reduced-motion through the
 * global rule in styles/base.css. */
export function useSheetDrag(
  shellRef: RefObject<HTMLElement | null>,
  { enabled, onDismiss }: { enabled: boolean; onDismiss: () => void }
): void {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !enabled) return;

    let drag: Drag | null = null;
    let settle = 0;

    const clear = () => {
      window.clearTimeout(settle);
      settle = 0;
      shell.style.transition = "";
      shell.style.transform = "";
    };

    // The grabber is only shown when the sheet sits at the bottom of the screen.
    const isBottomSheet = () => {
      const grabber = shell.querySelector(".atlas-sheet__grabber");
      return grabber != null && getComputedStyle(grabber).display !== "none";
    };

    const springBack = () => {
      shell.style.transition = `transform ${SLIDE_MS}ms var(--ease-out)`;
      shell.style.transform = "translateY(0)";
      settle = window.setTimeout(clear, SLIDE_MS);
    };

    const slideAway = () => {
      // The parent's closing animation would start over from the top.
      shell.style.animation = "none";
      shell.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
      shell.style.transform = "translateY(100%)";
      dismissRef.current();
    };

    const onStart = (e: TouchEvent) => {
      drag = null;
      if (settle) clear();
      if (e.touches.length !== 1 || !isBottomSheet()) return;
      const target = e.target as Element;
      if (target.closest("input, textarea, select, [contenteditable]") || scrollsSideways(target, shell)) return;
      const touch = e.touches[0];
      drag = {
        x: touch.clientX,
        y: touch.clientY,
        scroller: scrollerOf(target, shell),
        handle: touch.clientY - shell.getBoundingClientRect().top < HANDLE_PX,
        active: false,
        offset: 0,
        samples: [{ y: touch.clientY, t: e.timeStamp }],
      };
    };

    const onMove = (e: TouchEvent) => {
      const d = drag;
      if (!d) return;
      if (e.touches.length !== 1) {
        drag = null;
        if (d.active) springBack();
        return;
      }
      const touch = e.touches[0];
      const dy = touch.clientY - d.y;
      if (!d.active) {
        // Sideways or upwards is not ours: a carousel, or the content scrolling.
        if (dy < 0 || Math.abs(touch.clientX - d.x) > Math.abs(dy)) {
          drag = null;
          return;
        }
        if (dy === 0) return;
        if (!d.handle && d.scroller && d.scroller.scrollTop > 0.5) {
          drag = null;
          return;
        }
        d.active = true;
        // Still sliding in? Stop it where it is; the finger takes over.
        for (const a of shell.getAnimations?.() ?? []) a.cancel();
        shell.style.transition = "none";
      }
      if (e.cancelable) e.preventDefault();
      d.offset = Math.max(0, dy);
      shell.style.transform = `translateY(${d.offset}px)`;
      d.samples.push({ y: touch.clientY, t: e.timeStamp });
      if (d.samples.length > 8) d.samples.shift();
    };

    const onEnd = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d?.active) return;
      if (shouldDismiss(d.offset, flickSpeed(d.samples, e.timeStamp), shell.offsetHeight)) slideAway();
      else springBack();
    };

    const onCancel = () => {
      const d = drag;
      drag = null;
      if (d?.active) springBack();
    };

    shell.addEventListener("touchstart", onStart, { passive: true });
    // Not passive: once the sheet is being dragged the page must not scroll.
    shell.addEventListener("touchmove", onMove, { passive: false });
    shell.addEventListener("touchend", onEnd);
    shell.addEventListener("touchcancel", onCancel);
    return () => {
      shell.removeEventListener("touchstart", onStart);
      shell.removeEventListener("touchmove", onMove);
      shell.removeEventListener("touchend", onEnd);
      shell.removeEventListener("touchcancel", onCancel);
      if (settle) clear();
    };
  }, [shellRef, enabled]);
}
