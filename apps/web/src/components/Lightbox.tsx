"use client";

import { useEffect, useRef, useState } from "react";
import type { Media } from "../lib/types";
import { mediaSrc } from "../lib/api";
import { ChevronLeft, ChevronRight, CloseIcon, ExternalIcon } from "./Icons";
import { t } from "../lib/i18n";

interface LightboxProps {
  items: Media[];
  startIndex: number;
  title: string;
  onClose: () => void;
}

/** Full-screen photo viewer for a place's photographs. Keyboard: ← → Esc.
 * Transient media viewing on top of the Detail Sheet — it never opens a
 * second content overlay. */
export default function Lightbox({ items, startIndex, title, onClose }: LightboxProps) {
  const [index, setIndex] = useState(startIndex);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const touchX = useRef<number | null>(null);
  const item = items[index];

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    // Capture phase: Escape closes the lightbox, not the sheet beneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.stopPropagation();
        setIndex((i) => (i + 1) % items.length);
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation();
        setIndex((i) => (i - 1 + items.length) % items.length);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [items.length, onClose]);

  if (!item) return null;
  const many = items.length > 1;

  return (
    <div
      className="atlas-lightbox"
      data-owns-keyboard
      role="dialog"
      aria-modal="true"
      aria-label={t("Photos of {place}", { place: title })}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        // Swiping the thumbnails scrolls them; it must not also turn the page.
        const inStrip = (e.target as Element).closest(".atlas-lightbox__strip") != null;
        touchX.current = inStrip ? null : (e.touches[0]?.clientX ?? null);
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start == null || end == null || !many) return;
        if (end - start > 50) setIndex((i) => (i - 1 + items.length) % items.length);
        if (start - end > 50) setIndex((i) => (i + 1) % items.length);
      }}
    >
      <button ref={closeRef} type="button" className="atlas-lightbox__close" onClick={onClose} aria-label={t("Close photos")}>
        <CloseIcon size={18} />
      </button>
      {many ? (
        <button
          type="button"
          className="atlas-lightbox__nav atlas-lightbox__nav--prev"
          onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
          aria-label={t("Previous photo")}
        >
          <ChevronLeft size={22} />
        </button>
      ) : null}
      <figure className="atlas-lightbox__figure" key={item.id}>
        <img src={mediaSrc(item, 1920)} alt={item.caption ?? title} className="atlas-photo" draggable={false} />
        <figcaption className="atlas-lightbox__caption">
          <span className="atlas-lightbox__title">{item.caption ?? title}</span>
          <span className="atlas-lightbox__meta">
            {many ? `${index + 1} / ${items.length}` : null}
            {item.author || item.license ? (
              <span>
                {item.author ? t("Photo · {author}", { author: item.author }) : t("Photo")}
                {item.license ? " · " + item.license : ""}
              </span>
            ) : null}
            {item.sourceUrl ? (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                {t("Source")} <ExternalIcon size={12} />
              </a>
            ) : null}
          </span>
        </figcaption>
      </figure>
      {many ? (
        <button
          type="button"
          className="atlas-lightbox__nav atlas-lightbox__nav--next"
          onClick={() => setIndex((i) => (i + 1) % items.length)}
          aria-label={t("Next photo")}
        >
          <ChevronRight size={22} />
        </button>
      ) : null}
      {many ? (
        <div className="atlas-lightbox__strip">
          {items.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={"atlas-lightbox__thumb" + (i === index ? " is-active" : "")}
              onClick={() => setIndex(i)}
              aria-label={t("Photo {n}", { n: i + 1 })}
            >
              <img src={mediaSrc(m, 160)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
