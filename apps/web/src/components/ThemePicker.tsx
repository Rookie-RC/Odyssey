"use client";

import { useEffect, useRef, useState } from "react";
import { THEME_ORDER, themes, type AtlasTheme, type ThemePreference } from "../themes";
import { PaletteIcon } from "./Icons";
import { t } from "../lib/i18n";

interface ThemePickerProps {
  preference: ThemePreference;
  /** Theme currently in effect (Auto resolves to Light or Night). */
  active: AtlasTheme;
  onChange: (pref: ThemePreference) => void;
  /** Visual variant: a round icon button (top bar / strip) or an inline grid
   * (Manage Atlas settings). */
  variant?: "popover" | "inline";
  className?: string;
  /** Liquid glass trigger and popover (when floating over the map). */
  glass?: boolean;
}

const OPTIONS: ThemePreference[] = ["auto", ...THEME_ORDER];

/** Theme picker (VISUAL_SPEC §26). Each option previews its own palette and
 * display face, so the choice is made by looking, not by reading. */
export default function ThemePicker({
  preference,
  active,
  onChange,
  variant = "popover",
  glass = false,
  className,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    // Focus the selected option so arrow keys work immediately.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    items[(idx + delta + items.length) % items.length]?.focus();
  };

  const grid = (
    <div
      ref={listRef}
      className="atlas-theme-grid"
      role="radiogroup"
      aria-label={t("Theme")}
      onKeyDown={onListKey}
    >
      {OPTIONS.map((opt) => (
        <ThemeOption
          key={opt}
          pref={opt}
          checked={preference === opt}
          onSelect={() => {
            onChange(opt);
            if (variant === "popover") setOpen(false);
          }}
        />
      ))}
    </div>
  );

  if (variant === "inline") return <div className={className}>{grid}</div>;

  return (
    <div ref={rootRef} className={"atlas-theme-picker " + (className ?? "")}>
      <button
        type="button"
        className={"atlas-chip-btn" + (glass ? " atlas-glass" : "")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("Theme: {name}", {
          name: preference === "auto" ? t("Auto ({theme})", { theme: t(active.label) }) : t(active.label),
        })}
        title={t("Theme (T)")}
        onClick={() => setOpen((o) => !o)}
      >
        <PaletteIcon size={17} />
      </button>
      {open ? (
        <div
          className={"atlas-theme-popover" + (glass ? " atlas-glass atlas-glass--menu" : "")}
          role="dialog" aria-label={t("Choose a theme")}>
          <div className="atlas-theme-popover__head">
            <span className="atlas-eyebrow">{t("Theme")}</span>
            <span className="atlas-theme-popover__hint">
              <span className="atlas-kbd">T</span> {t("cycles")}
            </span>
          </div>
          {grid}
        </div>
      ) : null}
    </div>
  );
}

function ThemeOption({
  pref,
  checked,
  onSelect,
}: {
  pref: ThemePreference;
  checked: boolean;
  onSelect: () => void;
}) {
  const th = pref === "auto" ? themes.light : themes[pref];
  const label = pref === "auto" ? t("Auto") : t(th.label);
  const description = pref === "auto" ? t("Follows your system: Light or Night") : t(th.description);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      className={"atlas-theme-option" + (checked ? " atlas-theme-option--checked" : "")}
      onClick={onSelect}
    >
      {pref === "auto" ? (
        <span className="atlas-theme-swatch atlas-theme-swatch--auto" aria-hidden="true">
          <Swatch theme={themes.light} />
          <Swatch theme={themes.night} />
        </span>
      ) : (
        <span className="atlas-theme-swatch" aria-hidden="true">
          <Swatch theme={th} />
        </span>
      )}
      <span className="atlas-theme-option__text">
        <span className="atlas-theme-option__label">{label}</span>
        <span className="atlas-theme-option__desc">{description}</span>
      </span>
    </button>
  );
}

/** A thumbnail of the theme: its map land/water, a memory pin, the NOW pin and
 * the display face — a miniature of the Atlas itself. */
function Swatch({ theme }: { theme: AtlasTheme }) {
  const p = theme.map.palette;
  return (
    <span
      className="atlas-theme-swatch__tile"
      style={{ background: p.water, borderColor: theme.colors.border }}
    >
      <svg viewBox="0 0 64 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path
          d="M-2 30 C 8 18, 16 26, 22 14 S 38 6, 44 16 S 58 10, 66 18 L 66 46 L -2 46 Z"
          fill={p.background}
        />
        <path d="M30 46 C 34 36, 44 34, 50 38 S 60 30, 66 34 L 66 46 Z" fill={p.land} opacity="0.9" />
        <circle cx="20" cy="24" r="2.6" fill={theme.markers.visited} stroke={theme.markers.visitedStroke} strokeWidth="1" />
        <circle cx="47" cy="22" r="6" fill={theme.markers.currentGlow} />
        <circle cx="47" cy="22" r="3" fill={theme.markers.current} stroke={theme.markers.visitedStroke} strokeWidth="1" />
      </svg>
      <span
        className="atlas-theme-swatch__type"
        style={{
          color: theme.colors.textPrimary,
          fontFamily: theme.fonts.display,
          fontWeight: theme.fonts.displayWeight,
          background: theme.colors.surface,
        }}
      >
        Aa
      </span>
    </span>
  );
}
