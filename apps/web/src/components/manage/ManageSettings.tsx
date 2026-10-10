"use client";

// Settings section (PRODUCT_SPEC §34): theme, language, the optional default
// map position and, in cloud mode, the account. No speculative options.
import { useState } from "react";
import { api } from "../../lib/api";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card } from "./FormUI";
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

      {/* Cloud mode: the account. */}
      {cloud ? <AccountPanel runtime={runtime} notify={notify} /> : null}

    </div>
  );
}
