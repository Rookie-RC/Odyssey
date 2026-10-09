"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons";
import { t } from "../lib/i18n";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [[MOD, "K"], "Search places, memories and commands"],
      [["/"], "Search"],
      [["?"], "This list"],
      [["Esc"], "Close what is open"],
    ],
  },
  {
    title: "Atlas",
    keys: [
      [["M"], "Back to the map"],
      [["J"], "My journey"],
      [["W"], "Where next"],
      [["I"], "All ideas"],
      [["P"], "Profile"],
      [["T"], "Next theme"],
      [["R"], "Routes on / off"],
    ],
  },
  {
    title: "Timeline & places",
    keys: [
      [["←", "→"], "Move through time (timeline focused)"],
      [["N"], "Back to now (timeline focused)"],
      [["←", "→"], "Previous / next place (detail open)"],
      [[MOD, "wheel"], "Zoom the map"],
    ],
  },
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="atlas-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="atlas-dialog atlas-shortcuts" data-owns-keyboard role="dialog" aria-modal="true" aria-label={t("Keyboard shortcuts")}>
        <header className="atlas-dialog__head">
          <h2 className="atlas-display">{t("Keyboard shortcuts")}</h2>
          <button ref={ref} type="button" className="atlas-icon-btn atlas-icon-btn--sm" onClick={onClose} aria-label={t("Close")}>
            <CloseIcon size={15} />
          </button>
        </header>
        <div className="atlas-shortcuts__groups">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="atlas-eyebrow atlas-shortcuts__title">{t(g.title)}</h3>
              <ul>
                {g.keys.map(([keys, label], i) => (
                  <li key={i}>
                    <span>{t(label)}</span>
                    <span className="atlas-shortcuts__keys">
                      {keys.map((k) => (
                        <kbd key={k} className="atlas-kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
