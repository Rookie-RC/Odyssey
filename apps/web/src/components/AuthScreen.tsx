"use client";

// Sign in / create an account (cloud mode only; see CloudGate). One quiet
// card on the page ground, the compass-rose wordmark, faint flight arcs
// behind it. Mobile first: a full-width card on phones, inputs sized so iOS
// does not zoom, the keyboard's "go" key submits.
import { useId, useState, type FormEvent } from "react";
import { api, AuthError, type AccountUser } from "../lib/api";
import { parseLocalePreference, resolveLocale, setLocale, t, type Locale } from "../lib/i18n";
import { CompassRose } from "./Icons";

type Mode = "login" | "register";

// The interface language before the account's own setting is known: what
// the visitor last picked here, else the browser's language.
const LOCALE_KEY = "atlas.auth.locale";

function storedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null; // storage unavailable (private mode): follow the browser
  }
}

function initialLocale(): Locale {
  return resolveLocale(parseLocalePreference(storedLocale()), typeof navigator !== "undefined" ? navigator.language : "en");
}

export default function AuthScreen({
  allowSignup,
  onSignedIn,
}: {
  allowSignup: boolean;
  onSignedIn: (user: AccountUser) => void;
}) {
  // Client-only (CloudGate renders a splash until the runtime answers), so
  // the stored choice can be read during the first render: no flash.
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // Whether the visitor chose the language (here, now or before) rather
  // than it following the browser; a new account then starts in it.
  const [localeChosen, setLocaleChosen] = useState(() => storedLocale() != null);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();

  setLocale(locale); // module locale for t(), before this render's strings

  const changeLocale = (l: Locale) => {
    setLocaleState(l);
    setLocaleChosen(true);
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      // not persisted; still applies now
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res =
        mode === "login" ? await api.auth.login(email, password) : await api.auth.register(email, password);
      if (mode === "register" && localeChosen) {
        // The new Atlas continues in the language chosen here (its settings
        // are still empty, so nothing else is overwritten).
        await api.saveSettings({ language: locale }).catch(() => {});
      }
      onSignedIn(res.user);
    } catch (err) {
      // Server messages are English source strings; t() translates the
      // known ones and leaves anything else as sent.
      setError(err instanceof AuthError ? err.message : "Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  const register = mode === "register";

  return (
    <main className="atlas-auth" lang={locale === "zh" ? "zh-CN" : "en"}>
      <FlightArcs />

      <div className="atlas-auth__lang atlas-segmented" role="radiogroup" aria-label={t("Interface language")}>
        {(["en", "zh"] as Locale[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={locale === l}
            className={"atlas-segmented__item" + (locale === l ? " is-active" : "")}
            onClick={() => changeLocale(l)}
            lang={l === "zh" ? "zh-CN" : "en"}
          >
            {l === "zh" ? "中文" : "EN"}
          </button>
        ))}
      </div>

      <section className="atlas-auth__card" aria-labelledby={ids + "title"}>
        <div className="atlas-auth__brand">
          <CompassRose size={30} className="atlas-auth__rose" />
          <h1 id={ids + "title"} className="atlas-wordmark">
            {t("My Atlas")}
          </h1>
        </div>
        <p className="atlas-auth__tagline">
          {t("Every place you've been, and the ones still to come — on one map.")}
        </p>

        {allowSignup ? (
          <div className="atlas-auth__tabs atlas-segmented" role="tablist" aria-label={t("Sign in or create an account")}>
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={"atlas-segmented__item" + (mode === m ? " is-active" : "")}
                onClick={() => switchMode(m)}
              >
                {m === "login" ? t("Sign in") : t("Create account")}
              </button>
            ))}
          </div>
        ) : null}

        <form className="atlas-auth__form" onSubmit={submit}>
          <label className="atlas-form-field">
            <span className="atlas-form-label">{t("Email")}</span>
            <input
              className="atlas-form-input atlas-auth__input"
              type="email"
              name="email"
              autoComplete={register ? "email" : "username"}
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="atlas-form-field">
            <span className="atlas-form-label">{t("Password")}</span>
            <span className="atlas-auth__password">
              <input
                className="atlas-form-input atlas-auth__input"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 8 : undefined}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={register ? ids + "pwhint" : undefined}
              />
              <button
                type="button"
                className="atlas-auth__reveal"
                aria-pressed={showPassword}
                aria-label={showPassword ? t("Hide password") : t("Show password")}
                title={showPassword ? t("Hide password") : t("Show password")}
                onClick={() => setShowPassword((v) => !v)}
              >
                <EyeIcon open={!showPassword} />
              </button>
            </span>
            {register ? (
              <span id={ids + "pwhint"} className="atlas-form-hint">
                {t("At least 8 characters")}
              </span>
            ) : null}
          </label>

          {error ? (
            <p className="atlas-auth__error" role="alert">
              {t(error)}
            </p>
          ) : null}

          <button type="submit" className="atlas-btn atlas-btn--primary atlas-auth__submit" disabled={busy}>
            {busy ? (register ? t("Creating your atlas…") : t("Signing in…")) : register ? t("Create account") : t("Sign in")}
          </button>
        </form>

        {allowSignup ? (
          <button type="button" className="atlas-auth__switch" onClick={() => switchMode(register ? "login" : "register")}>
            {register ? t("Already have an account? Sign in") : t("New here? Create an account")}
          </button>
        ) : (
          <p className="atlas-auth__note">{t("Sign-up is closed on this server. Ask its owner for an account.")}</p>
        )}
        <p className="atlas-auth__note">{t("Your atlas is private: only you can see it once you sign in.")}</p>
      </section>
    </main>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z" />
      <circle cx="10" cy="10" r="2.6" />
      {open ? null : <path d="M3.5 3.5 16.5 16.5" />}
    </svg>
  );
}

/** Faint dashed flight arcs between a few dots — the Atlas's route language,
 * as a backdrop. Decorative only. */
function FlightArcs() {
  return (
    <svg className="atlas-auth__arcs" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 7" strokeLinecap="round">
        <path d="M160 610 Q 380 300 640 420" />
        <path d="M640 420 Q 820 180 1040 260" />
        <path d="M640 420 Q 760 640 980 650" />
        <path d="M300 200 Q 470 120 640 420" />
      </g>
      <g fill="currentColor">
        <circle cx="160" cy="610" r="4" />
        <circle cx="640" cy="420" r="6" />
        <circle cx="1040" cy="260" r="4" />
        <circle cx="980" cy="650" r="4" />
        <circle cx="300" cy="200" r="4" />
      </g>
    </svg>
  );
}
