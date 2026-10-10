"use client";

import { PlusIcon } from "./Icons";
import { t } from "../lib/i18n";

export type AtlasTab = "map" | "journey" | "wherenext" | "me";

export const TABS: AtlasTab[] = ["map", "journey", "wherenext", "me"];

const LABEL: Record<AtlasTab, string> = {
  map: "Map",
  journey: "Journey",
  wherenext: "Where next",
  me: "Me",
};

/** The app's sections, a floating pill at the bottom of the screen, with the
 * one action that matters most beside it: recording a trip. */
export default function TabBar({
  tab,
  onChange,
  onAdd,
}: {
  tab: AtlasTab;
  onChange: (tab: AtlasTab) => void;
  /** Absent when the atlas is read-only. */
  onAdd?: () => void;
}) {
  return (
    <nav className="atlas-tabbar" aria-label={t("Sections")}>
      <div className="atlas-tabbar__tabs atlas-glass" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={"atlas-tabbar__tab" + (tab === id ? " is-active" : "")}
            onClick={() => onChange(id)}
          >
            {t(LABEL[id])}
          </button>
        ))}
      </div>
      {onAdd ? (
        <button type="button" className="atlas-tabbar__add" onClick={onAdd} aria-label={t("Record a trip")}>
          <PlusIcon size={20} />
        </button>
      ) : null}
    </nav>
  );
}
