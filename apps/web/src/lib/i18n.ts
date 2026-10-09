// Interface language (English / 简体中文).
//
// Strings are keyed by their English source text: `t("Where next?")` returns
// the Chinese translation when the zh locale is active and the English text
// otherwise (a missing translation simply stays English — never a blank).
// `{name}` placeholders are interpolated from `vars`.
//
// The active locale is module state (set once per render by AtlasApp before
// children render) so the pure domain layer — date ranges, season and visit
// labels — can format without threading a locale argument through every
// call. Components that memoize derived strings include `useLocale()` in their
// dependencies so a language switch recomputes them.
//
// Only interface text is translated; the user's own content (place names,
// reflections, notes) is shown exactly as written.
import { createContext, useContext } from "react";
import { ZH as ZH_ATLAS } from "./i18n-zh";
import { ZH_MANAGE } from "./i18n-zh-manage";
import { ZH_ACCOUNT } from "./i18n-zh-account";

const ZH: Record<string, string> = { ...ZH_ACCOUNT, ...ZH_MANAGE, ...ZH_ATLAS };

export type Locale = "en" | "zh";
export type LocalePreference = Locale | "auto";

let current: Locale = "en";

export function setLocale(l: Locale): void {
  current = l;
  if (typeof document !== "undefined") {
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }
}

export function getLocale(): Locale {
  return current;
}

export function parseLocalePreference(v: unknown): LocalePreference {
  return v === "en" || v === "zh" || v === "auto" ? v : "auto";
}

/** Auto follows the browser/OS language: any Chinese variant → zh. */
export function resolveLocale(pref: LocalePreference, browserLang?: string): Locale {
  if (pref === "en" || pref === "zh") return pref;
  return /^zh\b/i.test(browserLang ?? "") ? "zh" : "en";
}

export function t(en: string, vars?: Record<string, string | number>): string {
  let out = current === "zh" ? ZH[en] ?? en : en;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : "{" + k + "}"));
  return out;
}

/** Count-aware phrase: tn(3, "{n} place", "{n} places"). Chinese has one form. */
export function tn(n: number, one: string, other: string): string {
  return t(n === 1 ? one : other, { n });
}

export const LocaleContext = createContext<Locale>("en");

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short month name ("Nov" / "11月"); month is 1–12. */
export function monthName(month: number): string {
  if (month < 1 || month > 12) return String(month);
  return current === "zh" ? month + "月" : MONTHS_EN[month - 1];
}

/** "Jun 2023" / "2023年6月". */
export function monthYear(year: string | number, month: number): string {
  if (current === "zh") return year + "年" + (month >= 1 && month <= 12 ? month + "月" : "");
  return (month >= 1 && month <= 12 ? MONTHS_EN[month - 1] + " " : "") + year;
}
