import type { AtlasTheme, MapPalette, ThemeId, ThemePreference } from "./types";
import { lightTheme } from "./light";
import { nightTheme } from "./night";

export type { AtlasTheme, MapPalette, ThemeId, ThemePreference };

export const themes: Record<ThemeId, AtlasTheme> = {
  light: lightTheme,
  night: nightTheme,
};

/** Picker order. */
export const THEME_ORDER: ThemeId[] = ["light", "night"];

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "auto" || (typeof v === "string" && v in themes);
}

/** Settings may carry any string (older atlases, hand edits, the retired
 * Journal / Minimal / Film themes); anything unknown falls back to Light. */
export function parseThemePreference(v: unknown): ThemePreference {
  return isThemePreference(v) ? v : "light";
}

/** Auto follows the OS: Night when the system prefers dark, else Light. */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): AtlasTheme {
  if (pref === "auto") return systemDark ? nightTheme : lightTheme;
  return themes[pref] ?? lightTheme;
}

// applyTheme writes the theme's semantic tokens as CSS custom properties so the
// whole UI (markers, cards, overlays, Manage Atlas) re-styles from one source
// of truth; components never hardcode theme colours.
export function applyTheme(theme: AtlasTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;
  const c = theme.colors;
  const vars: Record<string, string> = {
    "--bg": c.bg,
    "--bg-alt": c.bgAlt,
    "--surface": c.surface,
    "--surface-elevated": c.surfaceElevated,
    "--surface-sunken": c.surfaceSunken,
    "--text-primary": c.textPrimary,
    "--text-secondary": c.textSecondary,
    "--text-tertiary": c.textTertiary,
    "--border": c.border,
    "--border-strong": c.borderStrong,
    "--accent": c.accent,
    "--accent-soft": c.accentSoft,
    "--on-accent": c.onAccent,
    "--now": c.now,
    "--now-soft": c.nowSoft,
    "--scrim": c.scrim,
    "--danger": c.danger,
    "--date-ink": c.dateInk,

    "--font-display": theme.fonts.display,
    "--font-body": theme.fonts.body,
    "--font-ui": theme.fonts.ui,
    "--font-mono": theme.fonts.mono,
    "--font-date": theme.fonts.date,
    "--display-weight": String(theme.fonts.displayWeight),
    "--label-tracking": theme.fonts.labelTracking,

    "--radius-sm": theme.shape.radiusSm,
    "--radius-md": theme.shape.radiusMd,
    "--radius-lg": theme.shape.radiusLg,
    "--radius-xl": theme.shape.radiusXl,

    "--shadow-sm": theme.shadows.sm,
    "--shadow-md": theme.shadows.md,
    "--shadow-lg": theme.shadows.lg,

    "--paper": theme.texture.paper,
    "--paper-opacity": String(theme.texture.paperOpacity),
    "--grain": theme.texture.grain,
    "--grain-opacity": String(theme.texture.grainOpacity),

    "--glass-tint": theme.glass.tint,
    "--glass-tint-hover": theme.glass.tintHover,
    "--glass-blur": theme.glass.blur + "px",
    "--glass-saturate": String(theme.glass.saturate),
    "--glass-highlight": theme.glass.highlight,
    "--glass-edge": theme.glass.edge,

    "--image-filter": theme.image.filter,
    "--image-frame": theme.image.frame,

    "--map-tint": theme.map.tint,
    "--map-tint-blend": theme.map.tintBlend,
    "--map-bg": theme.map.palette.water,

    "--marker-current": theme.markers.current,
    "--marker-current-ring": theme.markers.currentRing,
    "--marker-current-glow": theme.markers.currentGlow,
    "--marker-visited": theme.markers.visited,
    "--marker-visited-stroke": theme.markers.visitedStroke,
    "--marker-visited-faint": theme.markers.visitedFaint,
    "--marker-visited-glow": theme.markers.visitedGlow,
    "--marker-wish": theme.markers.wish,
    "--marker-label": theme.markers.label,
    "--marker-label-halo": theme.markers.labelHalo,

    "--country-fill": theme.countries.fill,
    "--country-outline": theme.countries.outline,
    "--country-wish": theme.countries.wish,
    "--route-line": theme.routes.line,

    "--season-spring": theme.seasons.spring,
    "--season-summer": theme.seasons.summer,
    "--season-autumn": theme.seasons.autumn,
    "--season-winter": theme.seasons.winter,
    "--season-spring-ink": theme.seasonInk.spring,
    "--season-summer-ink": theme.seasonInk.summer,
    "--season-autumn-ink": theme.seasonInk.autumn,
    "--season-winter-ink": theme.seasonInk.winter,
  };
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", c.bg);
  // Snapshot for the pre-paint boot script in app/layout.tsx (no theme flash
  // on the next load). Storage can be unavailable (private mode) — harmless.
  try {
    localStorage.setItem(
      "atlas.theme.snapshot",
      JSON.stringify({ id: theme.id, mode: theme.mode, vars })
    );
  } catch {
    // ignore
  }
}
