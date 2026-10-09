"use client";

// Settings section (PRODUCT_SPEC §34): the minimal V1 settings — theme,
// optional default map position, plus read-only runtime info (data directory,
// geocoding provider). No speculative options.
import { useEffect, useState } from "react";
import { api, type RuntimeInfo } from "../../lib/api";
import QrCode from "./QrCode";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card, Field } from "./FormUI";
import MiniMap from "./MiniMap";
import ThemePicker from "../ThemePicker";
import LanguagePicker from "../LanguagePicker";
import { t } from "../../lib/i18n";
import { themes } from "../../themes";
import AccountPanel from "../AccountPanel";

export default function ManageSettings({ ctx }: { ctx: ManageContext }) {
  const { theme, themePreference, onThemeChange, localePreference, onLocaleChange, settings, notify, reload, runtime } =
    ctx;
  const cloud = runtime?.mode === "cloud";
  const [message, setMessage] = useState("");
  const [defaultPos, setDefaultPos] = useState<{ lat: number; lng: number } | null>(
    settings?.defaultMapPosition ?? null
  );

  const saveMapPosition = async () => {
    setMessage("");
    try {
      await api.saveSettings({ ...(settings ?? {}), defaultMapPosition: defaultPos ?? undefined });
      notify(defaultPos ? t("Default map position saved.") : t("Default map position cleared."));
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">{t("Settings")}</h2>
        <p className="atlas-form-hint">{t("Appearance, the map's resting place, and sharing.")}</p>
      </div>
      {message ? <p className="atlas-locpicker__error">{message}</p> : null}

      <Card>
        <h3 className="atlas-manage-card__title">{t("Theme")}</h3>
        <p className="atlas-form-hint">
          {t("Themes change colour, type, texture, map style and photo treatment — never your data.")}
        </p>
        <ThemePicker
          variant="inline"
          preference={themePreference}
          active={theme}
          onChange={(pref) => {
            onThemeChange(pref);
            notify(
              t("Theme set to {name}.", {
                name: pref === "auto" ? t("Auto") : themes[pref] ? t(themes[pref].label) : pref,
              })
            );
          }}
          className="atlas-manage-themes"
        />
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">{t("Language")}</h3>
        <p className="atlas-form-hint">
          {t(
            "Interface language. Your own words — place names, reflections, notes — are always shown as you wrote them."
          )}
        </p>
        <LanguagePicker value={localePreference} onChange={onLocaleChange} />
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">{t("Default map position (optional)")}</h3>
        <p className="atlas-form-hint">
          {t("The Hero Map opens here instead of Europe. Leave empty to keep the default.")}
        </p>
        <MiniMap theme={theme} value={defaultPos} onChange={(v) => setDefaultPos(v)} height={200} />
        <div className="atlas-manage-card__actions">
          <Btn kind="primary" onClick={saveMapPosition}>
            {t("Save map position")}
          </Btn>
          <Btn
            onClick={async () => {
              setDefaultPos(null);
              try {
                await api.saveSettings({ ...(settings ?? {}), defaultMapPosition: undefined });
                notify(t("Default map position cleared."));
                reload();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {t("Clear")}
          </Btn>
        </div>
      </Card>

      {/* Cloud mode: the account instead of LAN sharing and the data
          directory, which only exist for the runtime on this computer. */}
      {cloud ? (
        <AccountPanel runtime={runtime} notify={notify} />
      ) : (
        <LanSharingCard runtime={runtime} settings={settings} notify={notify} reload={reload} onError={setMessage} />
      )}

      <Card>
        <h3 className="atlas-manage-card__title">{t("Runtime")}</h3>
        <div className="atlas-manage-kv">
          {cloud ? null : (
            <div>
              <span className="atlas-manage-kv__label">{t("Data directory")}</span>
              <span className="atlas-manage-kv__value">{runtime?.dataDir ?? "—"}</span>
            </div>
          )}
          <div>
            <span className="atlas-manage-kv__label">{t("Geocoding provider")}</span>
            <span className="atlas-manage-kv__value">{runtime?.geocodingProvider ?? "—"}</span>
          </div>
          <div>
            <span className="atlas-manage-kv__label">{t("Mode")}</span>
            <span className="atlas-manage-kv__value">
              {runtime?.mode ?? "—"} {runtime?.writable ? t("(writable)") : t("(read-only)")}
            </span>
          </div>
        </div>
      </Card>

      {settings?.geocodingProvider ? (
        <Field label={t("Configured provider")} hint={t("Machine config lives in runtime-config.json.")}>
          <span className="atlas-form-hint">{settings.geocodingProvider}</span>
        </Field>
      ) : null}
    </div>
  );
}

// Read-only LAN sharing (PRODUCT_SPEC §4): other devices on the same network
// can open the Atlas, but editing stays on this computer. The runtime binds the
// extra listeners live; this card only flips the setting and shows the URLs.
function LanSharingCard({
  runtime,
  settings,
  notify,
  reload,
  onError,
}: {
  runtime: RuntimeInfo | null;
  settings: ManageContext["settings"];
  notify: (m: string) => void;
  reload: () => void;
  onError: (m: string) => void;
}) {
  const [rt, setRt] = useState<RuntimeInfo | null>(runtime);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.getRuntime().then(setRt).catch(() => {});
  }, []);

  const enabled = rt?.lan?.enabled ?? false;
  const urls = rt?.lan?.urls ?? [];

  const toggle = async () => {
    setBusy(true);
    onError("");
    try {
      const latest = await api.getSettings().catch(() => settings ?? {});
      await api.saveSettings({ ...latest, lanSharing: !enabled });
      const next = await api.getRuntime();
      setRt(next);
      // Keep the Atlas' own settings copy current, so a later save (theme,
      // map layers) never writes the old lanSharing value back.
      reload();
      notify(next.lan?.enabled ? t("Sharing on your local network (view only).") : t("Local network sharing is off."));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable: the URL is visible and selectable anyway
    }
  };

  return (
    <Card>
      <div className="atlas-lan__head">
        <div>
          <h3 className="atlas-manage-card__title">{t("Share on local network")}</h3>
          <p className="atlas-form-hint">
            {t(
              "Let phones and other computers on the same Wi-Fi open this Atlas — view only. Editing stays on this computer."
            )}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className="atlas-lan__switch"
          onClick={toggle}
          disabled={busy || !rt}
        >
          <span className={"atlas-switch" + (enabled ? " atlas-switch--on" : "")} aria-hidden="true">
            <span className="atlas-switch__knob" />
          </span>
          <span>{busy ? "…" : enabled ? t("On") : t("Off")}</span>
        </button>
      </div>
      {rt?.lan?.error ? <p className="atlas-locpicker__error">{rt.lan.error}</p> : null}
      {enabled && urls.length > 0 ? (
        <div className="atlas-lan__urls">
          {urls.map((u) => (
            <div key={u} className="atlas-lan__url">
              <QrCode value={u} size={132} />
              <div className="atlas-lan__url-text">
                <span className="atlas-lan__address">{u}</span>
                <span className="atlas-form-hint">{t("Scan with a phone camera, or type the address.")}</span>
                <Btn onClick={() => copy(u)}>{copied === u ? t("Copied") : t("Copy link")}</Btn>
              </div>
            </div>
          ))}
        </div>
      ) : enabled ? (
        <p className="atlas-form-hint">
          {t("No local network address found — is this computer connected to Wi-Fi or Ethernet?")}
        </p>
      ) : null}
    </Card>
  );
}
