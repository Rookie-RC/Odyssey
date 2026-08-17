"use client";

// Settings section (PRODUCT_SPEC §34): the minimal V1 settings — theme,
// optional default map position, plus read-only runtime info (data directory,
// geocoding provider). No speculative options.
import { useState } from "react";
import { api } from "../../lib/api";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card, Field } from "./FormUI";
import MiniMap from "./MiniMap";

export default function ManageSettings({ ctx }: { ctx: ManageContext }) {
  const { theme, settings, notify, reload, runtime } = ctx;
  const [message, setMessage] = useState("");
  const [defaultPos, setDefaultPos] = useState<{ lat: number; lng: number } | null>(
    settings?.defaultMapPosition ?? null
  );

  const setTheme = async (t: "light" | "night") => {
    setMessage("");
    try {
      await api.saveSettings({ ...(settings ?? {}), theme: t });
      notify("Theme set to " + t + ".");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const saveMapPosition = async () => {
    setMessage("");
    try {
      await api.saveSettings({ ...(settings ?? {}), defaultMapPosition: defaultPos ?? undefined });
      notify(defaultPos ? "Default map position saved." : "Default map position cleared.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Settings</h2>
        <p className="atlas-form-hint">Minimal V1 settings — nothing speculative.</p>
      </div>
      {message ? <p className="atlas-locpicker__error">{message}</p> : null}

      <Card>
        <h3 className="atlas-manage-card__title">Theme</h3>
        <div className="atlas-form-checks">
          <label className="atlas-form-check">
            <input
              type="radio"
              name="theme"
              checked={theme.id === "light"}
              onChange={() => setTheme("light")}
            />
            <span>Light</span>
          </label>
          <label className="atlas-form-check">
            <input
              type="radio"
              name="theme"
              checked={theme.id === "night"}
              onChange={() => setTheme("night")}
            />
            <span>Night</span>
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">Default map position (optional)</h3>
        <p className="atlas-form-hint">
          The Hero Map opens here instead of Europe. Leave empty to keep the default.
        </p>
        <MiniMap theme={theme} value={defaultPos} onChange={(v) => setDefaultPos(v)} height={200} />
        <div className="atlas-manage-card__actions">
          <Btn kind="primary" onClick={saveMapPosition}>
            Save map position
          </Btn>
          <Btn
            onClick={async () => {
              setDefaultPos(null);
              try {
                await api.saveSettings({ ...(settings ?? {}), defaultMapPosition: undefined });
                notify("Default map position cleared.");
                reload();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Clear
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">Runtime</h3>
        <div className="atlas-manage-kv">
          <div>
            <span className="atlas-manage-kv__label">Data directory</span>
            <span className="atlas-manage-kv__value">{runtime?.dataDir ?? "—"}</span>
          </div>
          <div>
            <span className="atlas-manage-kv__label">Geocoding provider</span>
            <span className="atlas-manage-kv__value">{runtime?.geocodingProvider ?? "—"}</span>
          </div>
          <div>
            <span className="atlas-manage-kv__label">Mode</span>
            <span className="atlas-manage-kv__value">
              {runtime?.mode ?? "—"} {runtime?.writable ? "(writable)" : "(read-only)"}
            </span>
          </div>
        </div>
      </Card>

      {settings?.geocodingProvider ? (
        <Field label="Configured provider" hint="Machine config lives in runtime-config.json.">
          <span className="atlas-form-hint">{settings.geocodingProvider}</span>
        </Field>
      ) : null}
    </div>
  );
}
