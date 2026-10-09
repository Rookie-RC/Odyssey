"use client";

// Import / Export section (PRODUCT_SPEC §30–33, VISUAL_SPEC §17): export the
// whole Atlas as a single portable .atlas file, replace-import with an
// automatic backup, and start a blank Atlas. All packaging/validation happens
// in the Go runtime; this section only triggers it and reports results.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupInfo } from "../../lib/api";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card, EmptyState } from "./FormUI";
import { getLocale, t } from "../../lib/i18n";
import { downloadBlob } from "../../lib/poster";

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(getLocale() === "zh" ? "zh-CN" : undefined, { dateStyle: "medium", timeStyle: "short" });
}


export default function ManageTransfer({ ctx }: { ctx: ManageContext }) {
  const { repo, notify, reload } = ctx;
  const [busy, setBusy] = useState<string | null>(null); // "export" | "import" | "new"
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [backupError, setBackupError] = useState("");
  const [confirmBackup, setConfirmBackup] = useState<{ name: string; action: "restore" | "delete" } | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await repo.listBackups());
      setBackupError("");
    } catch (e) {
      setBackups([]);
      setBackupError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const doBackupAction = async (name: string, action: "restore" | "delete") => {
    setBusy(action);
    try {
      if (action === "restore") {
        const res = await repo.restoreBackup(name);
        setMsg("ok", t("Restored {name}. The Atlas you had before was backed up as {backup}.", { name, backup: res.backup }));
        notify(t("Backup restored — your previous Atlas was backed up first."));
        reload();
      } else {
        await repo.deleteBackup(name);
        setMsg("ok", t("Deleted backup {name}.", { name }));
      }
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setConfirmBackup(null);
      loadBackups();
    }
  };

  const setMsg = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  const doExport = async () => {
    setBusy("export");
    setMsg("ok", t("Packaging your Atlas…"));
    try {
      const blob = await repo.exportAtlas();
      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14);
      downloadBlob(blob, "odyssey-" + stamp + ".atlas");
      setMsg("ok", t("Export complete — the .atlas file was downloaded."));
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy("import");
    setMsg("ok", t("Validating and importing…"));
    try {
      const res = await repo.importAtlas(file);
      setMsg("ok", t("Atlas imported. Backup: {backup}", { backup: res.backup }));
      notify(t("Atlas imported — a backup was created first."));
      reload();
      loadBackups();
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const doNew = async () => {
    setBusy("new");
    setMsg("ok", t("Creating a blank Atlas…"));
    try {
      const res = await repo.newAtlas();
      setConfirmNew(false);
      setMsg("ok", t("New Atlas created. Backup: {backup}", { backup: res.backup }));
      notify(t("Started a new Atlas — a backup was created first."));
      reload();
      loadBackups();
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">{t("Import / Export")}</h2>
        <p className="atlas-form-hint">
          {t(
            "Your whole Atlas travels as one portable .atlas file — structured data and media together. Backups are automatic before any replacement."
          )}
        </p>
      </div>

      {message ? (
        <p className={message.kind === "error" ? "atlas-locpicker__error" : "atlas-manage-transfer__ok"}>
          {message.text}
        </p>
      ) : null}

      <Card>
        <h3 className="atlas-manage-card__title">{t("Export Atlas")}</h3>
        <p className="atlas-form-hint">
          {t(
            "Create a portable .atlas backup containing your data and media. The file is fully self-contained — enough to reconstruct the Atlas anywhere."
          )}
        </p>
        <div className="atlas-manage-card__actions">
          <Btn kind="primary" onClick={doExport} disabled={busy !== null}>
            {busy === "export" ? t("Exporting…") : t("Export")}
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">{t("Import Atlas")}</h3>
        <p className="atlas-form-hint">
          {t(
            "Replace the current Atlas with a .atlas file. A backup of the current Atlas is created automatically first; the package is validated before anything is replaced."
          )}
        </p>
        <div className="atlas-manage-card__actions">
          <input
            ref={inputRef}
            type="file"
            accept=".atlas,.yuatlas,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
            }}
          />
          <Btn kind="primary" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            {busy === "import" ? t("Importing…") : t("Choose file")}
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">{t("New Atlas")}</h3>
        <p className="atlas-form-hint">
          {t(
            "Start fresh with a blank Atlas — no files to create by hand. A backup of the current Atlas is created first, and your theme preference is kept."
          )}
        </p>
        <div className="atlas-manage-card__actions">
          {confirmNew ? (
            <>
              <Btn kind="danger" onClick={doNew} disabled={busy !== null}>
                {busy === "new" ? t("Creating…") : t("Confirm — replace everything")}
              </Btn>
              <Btn onClick={() => setConfirmNew(false)} disabled={busy !== null}>
                {t("Cancel")}
              </Btn>
            </>
          ) : (
            <Btn onClick={() => setConfirmNew(true)} disabled={busy !== null}>
              {t("New Atlas…")}
            </Btn>
          )}
        </div>
      </Card>
      <Card>
        <h3 className="atlas-manage-card__title">{t("Backups")}</h3>
        <p className="atlas-form-hint">
          {t(
            "Taken automatically before every import, restore or New Atlas, and kept in your atlas-data/backups folder. Restoring one backs up the current Atlas first, so nothing is ever lost."
          )}
        </p>
        {backupError ? <p className="atlas-locpicker__error">{backupError}</p> : null}
        {backups == null ? (
          <p className="atlas-form-hint">{t("Loading…")}</p>
        ) : backups.length === 0 ? (
          <EmptyState>{t("No backups yet.")}</EmptyState>
        ) : (
          <ul className="atlas-backups">
            {backups.map((b) => {
              const confirming = confirmBackup?.name === b.name ? confirmBackup.action : null;
              return (
                <li key={b.name} className="atlas-backups__row">
                  <div className="atlas-backups__info">
                    <span className="atlas-backups__when">{formatWhen(b.createdAt)}</span>
                    <span className="atlas-backups__meta">
                      {b.name} · {formatBytes(b.size)}
                    </span>
                  </div>
                  <div className="atlas-backups__actions">
                    {confirming ? (
                      <>
                        <Btn
                          kind={confirming === "delete" ? "danger" : "primary"}
                          onClick={() => doBackupAction(b.name, confirming)}
                          disabled={busy !== null}
                        >
                          {confirming === "restore" ? t("Confirm restore") : t("Confirm delete")}
                        </Btn>
                        <Btn onClick={() => setConfirmBackup(null)} disabled={busy !== null}>
                          {t("Cancel")}
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn onClick={() => setConfirmBackup({ name: b.name, action: "restore" })} disabled={busy !== null}>
                          {t("Restore")}
                        </Btn>
                        <Btn onClick={() => setConfirmBackup({ name: b.name, action: "delete" })} disabled={busy !== null}>
                          {t("Delete")}
                        </Btn>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
