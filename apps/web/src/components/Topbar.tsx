"use client";

import { CompassRose, SearchIcon } from "./Icons";
import { t } from "../lib/i18n";

interface TopbarProps {
  wordmark: string;
  onOpenSearch: () => void;
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

/** The map's floating chrome (VISUAL_SPEC §3: no large header): the wordmark
 * and search. The sections live in the tab bar at the bottom. */
export default function Topbar({ wordmark, onOpenSearch }: TopbarProps) {
  return (
    <header className="atlas-topbar">
      <div className="atlas-topbar__brand">
        <CompassRose size={26} className="atlas-topbar__rose" />
        <span className="atlas-wordmark">{wordmark}</span>
      </div>

      <div className="atlas-topbar__actions">
        <button
          type="button"
          className="atlas-chip-btn atlas-glass atlas-topbar__search"
          onClick={onOpenSearch}
          aria-label={t("Search places and memories")}
        >
          <SearchIcon size={16} />
          <span className="atlas-topbar__search-label">{t("Search")}</span>
        </button>
      </div>
    </header>
  );
}
