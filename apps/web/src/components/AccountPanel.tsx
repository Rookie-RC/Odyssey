"use client";

// The account card in Manage Atlas → Settings (cloud mode only): who is
// signed in, storage used, sign out (here or everywhere), change password,
// delete the account. Deleting is irreversible and takes the whole Atlas
// with it, so it asks for the password and points at Export first.
import { useEffect, useState, type FormEvent } from "react";
import { api, AuthError, type AccountUsage, type RuntimeInfo } from "../lib/api";
import { t } from "../lib/i18n";
import { Btn, Card } from "./manage/FormUI";
import { signOut } from "../lib/account";

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

function errorText(e: unknown): string {
  return e instanceof AuthError ? t(e.message) : e instanceof Error ? e.message : String(e);
}

export default function AccountPanel({
  runtime,
  notify,
}: {
  runtime: RuntimeInfo | null;
  notify: (msg: string) => void;
}) {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const email = runtime?.user?.email ?? "";

  useEffect(() => {
    let alive = true;
    api.auth
      .me()
      .then((r) => {
        if (alive) setUsage(r.usage);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pct = usage && usage.quotaBytes > 0 ? Math.min(100, (usage.bytes / usage.quotaBytes) * 100) : 0;

  return (
    <>
      <Card>
        <h3 className="atlas-manage-card__title">{t("Account")}</h3>
        <p className="atlas-form-hint">
          {t("Signed in as")} <span className="atlas-account__email">{email}</span>
        </p>
        {usage ? (
          <div>
            <span className="atlas-form-label">{t("Storage used")}</span>
            {usage.quotaBytes > 0 ? (
              <>
                <div
                  className={"atlas-account__meter" + (pct >= 95 ? " is-full" : "")}
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                  aria-label={t("Storage used")}
                >
                  <span style={{ width: pct + "%" }} />
                </div>
                <span className="atlas-form-hint">
                  {t("{used} of {quota}", { used: formatBytes(usage.bytes), quota: formatBytes(usage.quotaBytes) })}
                </span>
              </>
            ) : (
              <p className="atlas-form-hint">{t("{used} (no limit)", { used: formatBytes(usage.bytes) })}</p>
            )}
          </div>
        ) : null}
        <div className="atlas-manage-card__actions">
          <Btn onClick={() => signOut(false)}>{t("Sign out")}</Btn>
          <Btn onClick={() => signOut(true)} title={t("Ends the session on every phone and computer signed in to this account.")}>
            {t("Sign out everywhere")}
          </Btn>
        </div>
      </Card>

      <ChangePasswordCard notify={notify} />
      <DeleteAccountCard />
    </>
  );
}

function ChangePasswordCard({ notify }: { notify: (msg: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      notify(t("Password changed. Other devices have been signed out."));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h3 className="atlas-manage-card__title">{t("Change password")}</h3>
      <form className="atlas-account__form" onSubmit={submit}>
        <label className="atlas-form-field">
          <span className="atlas-form-label">{t("Current password")}</span>
          <input
            className="atlas-form-input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="atlas-form-field">
          <span className="atlas-form-label">{t("New password")}</span>
          <input
            className="atlas-form-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <span className="atlas-form-hint">{t("At least 8 characters")}</span>
        </label>
        {error ? <p className="atlas-locpicker__error" role="alert">{error}</p> : null}
        <div className="atlas-manage-card__actions">
          <button type="submit" className="atlas-btn atlas-btn--primary" disabled={busy}>
            {busy ? t("Saving…") : t("Change password")}
          </button>
        </div>
      </form>
    </Card>
  );
}

function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.auth.deleteAccount(password);
      window.location.replace("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Card className="atlas-account__danger">
      <h3 className="atlas-manage-card__title">{t("Delete account")}</h3>
      <p className="atlas-form-hint">
        {t(
          "Deletes your account and your whole atlas — places, visits, wishes, photos and backups. This cannot be undone."
        )}
      </p>
      <p className="atlas-form-hint">{t("Export your atlas first (Import / Export) if you might want it back.")}</p>
      {open ? (
        <form className="atlas-account__form" onSubmit={submit}>
          <label className="atlas-form-field">
            <span className="atlas-form-label">{t("Enter your password to confirm")}</span>
            <input
              className="atlas-form-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          {error ? <p className="atlas-locpicker__error" role="alert">{error}</p> : null}
          <div className="atlas-manage-card__actions">
            <button type="submit" className="atlas-btn atlas-btn--danger" disabled={busy || !password}>
              {busy ? t("Deleting…") : t("Delete my account")}
            </button>
            <Btn
              onClick={() => {
                setOpen(false);
                setPassword("");
                setError("");
              }}
            >
              {t("Cancel")}
            </Btn>
          </div>
        </form>
      ) : (
        <div className="atlas-manage-card__actions">
          <Btn kind="danger" onClick={() => setOpen(true)}>
            {t("Delete account")}
          </Btn>
        </div>
      )}
    </Card>
  );
}
