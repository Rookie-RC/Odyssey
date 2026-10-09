"use client";

import { useEffect, useState } from "react";
import type { AtlasTheme, ThemePreference } from "../themes";
import type { Profile } from "../lib/types";
import ThemePicker from "./ThemePicker";
import { CompassRose, ExpandIcon, SearchIcon } from "./Icons";
import { t } from "../lib/i18n";

interface TopbarProps {
  profile: Profile | null;
  wordmark: string;
  theme: AtlasTheme;
  themePreference: ThemePreference;
  onThemeChange: (pref: ThemePreference) => void;
  onOpenProfile: () => void;
  onOpenSearch: () => void;
  onExpandMap: () => void;
}

export function profileInitials(name?: string): string {
  return (name?.trim() || t("Traveler"))
    .split(/\s+/)
    .map((w) => Array.from(w)[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Minimal floating chrome (VISUAL_SPEC §3: no large header). The wordmark
 * belongs to the fullscreen map and fades as the map collapses; the actions
 * stay reachable and settle over the contextual strip, where "Expand map"
 * joins them. Visibility is driven by CSS from --hero-scroll, so scrolling
 * never re-renders React. */
export default function Topbar({
  profile,
  wordmark,
  theme,
  themePreference,
  onThemeChange,
  onOpenProfile,
  onOpenSearch,
  onExpandMap,
}: TopbarProps) {
  // Decided after mount: the static export is rendered without a browser, and
  // a different first client render would discard the server HTML.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  return (
    <header className="atlas-topbar">
      <button type="button" className="atlas-topbar__brand" onClick={onExpandMap} aria-label={t("{wordmark} — back to the map", { wordmark })}>
        <CompassRose size={26} className="atlas-topbar__rose" />
        <span className="atlas-wordmark">{wordmark}</span>
      </button>

      <div className="atlas-topbar__actions">
        <button type="button" className="atlas-chip-btn atlas-glass atlas-topbar__expand" onClick={onExpandMap}>
          <ExpandIcon size={15} />
          <span>{t("Expand map")}</span>
        </button>

        <button
          type="button"
          className="atlas-chip-btn atlas-glass atlas-topbar__search"
          onClick={onOpenSearch}
          aria-label={t("Search places and memories")}
          title={t("Search (/)")}
        >
          <SearchIcon size={16} />
          <span className="atlas-topbar__search-label">{t("Search")}</span>
          <span className="atlas-kbd atlas-topbar__search-kbd">{isMac ? "⌘K" : "Ctrl K"}</span>
        </button>

        <ThemePicker preference={themePreference} active={theme} onChange={onThemeChange} glass />

        <button type="button" className="atlas-profile-pill atlas-glass" onClick={onOpenProfile} title={t("Profile (P)")}>
          {profile?.avatar ? (
            <img className="atlas-profile-pill__avatar atlas-photo" src={profile.avatar} alt="" draggable={false} />
          ) : (
            <span className="atlas-profile-pill__avatar atlas-profile-pill__avatar--initials" aria-hidden="true">
              {profileInitials(profile?.name)}
            </span>
          )}
          <span className="atlas-profile-pill__label">{profile?.name?.trim() || t("Profile")}</span>
        </button>
      </div>
    </header>
  );
}
