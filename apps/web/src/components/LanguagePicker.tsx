"use client";

import type { LocalePreference } from "../lib/i18n";
import { t } from "../lib/i18n";

const OPTIONS: { id: LocalePreference; label: () => string }[] = [
  { id: "auto", label: () => t("Auto") },
  { id: "en", label: () => "English" },
  { id: "zh", label: () => "简体中文" },
];

/** Segmented control: Auto (follows the system) / English / 简体中文. Each
 * language names itself in its own script, so it is findable from either. */
export default function LanguagePicker({
  value,
  onChange,
}: {
  value: LocalePreference;
  onChange: (pref: LocalePreference) => void;
}) {
  return (
    <div className="atlas-segmented" role="radiogroup" aria-label={t("Interface language")}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={"atlas-segmented__item" + (value === o.id ? " is-active" : "")}
          onClick={() => onChange(o.id)}
          lang={o.id === "zh" ? "zh-CN" : o.id === "en" ? "en" : undefined}
        >
          {o.label()}
        </button>
      ))}
    </div>
  );
}
