"use client";

// Import / Export section (PRODUCT_SPEC §30–33, VISUAL_SPEC §17): export the
// whole Atlas as a single portable .atlas file, replace-import with an
// automatic backup, and start a blank Atlas. All packaging/validation happens
// in the Go runtime; this section only triggers it and reports results.
import { useRef, useState } from "react";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card } from "./FormUI";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function ManageTransfer({ ctx }: { ctx: ManageContext }) {
  const { repo, notify, reload } = ctx;
  const [busy, setBusy] = useState<string | null>(null); // "export" | "import" | "new"
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setMsg = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  const doExport = async () => {
    setBusy("export");
    setMsg("ok", "Packaging your Atlas…");
    try {
      const blob = await repo.exportAtlas();
      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14);
      downloadBlob(blob, "yu-atlas-" + stamp + ".atlas");
      setMsg("ok", "Export complete — the .atlas file was downloaded.");
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy("import");
    setMsg("ok", "Validating and importing…");
    try {
      const res = await repo.importAtlas(file);
      setMsg("ok", "Atlas imported. Backup: " + res.backup);
      notify("Atlas imported — a backup was created first.");
      reload();
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const doNew = async () => {
    setBusy("new");
    setMsg("ok", "Creating a blank Atlas…");
    try {
      const res = await repo.newAtlas();
      setConfirmNew(false);
      setMsg("ok", "New Atlas created. Backup: " + res.backup);
      notify("Started a new Atlas — a backup was created first.");
      reload();
    } catch (e) {
      setMsg("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Import / Export</h2>
        <p className="atlas-form-hint">
          Your whole Atlas travels as one portable .atlas file — structured data and media
          together. Backups are automatic before any replacement.
        </p>
      </div>

      {message ? (
        <p className={message.kind === "error" ? "atlas-locpicker__error" : "atlas-manage-transfer__ok"}>
          {message.text}
        </p>
      ) : null}

      <Card>
        <h3 className="atlas-manage-card__title">Export Atlas</h3>
        <p className="atlas-form-hint">
          Create a portable .atlas backup containing your data and media. The file is fully
          self-contained — enough to reconstruct the Atlas anywhere.
        </p>
        <div className="atlas-manage-card__actions">
          <Btn kind="primary" onClick={doExport} disabled={busy !== null}>
            {busy === "export" ? "Exporting…" : "Export"}
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">Import Atlas</h3>
        <p className="atlas-form-hint">
          Replace the current Atlas with a .atlas file. A backup of the current Atlas is created
          automatically first; the package is validated before anything is replaced.
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
            {busy === "import" ? "Importing…" : "Choose file"}
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 className="atlas-manage-card__title">New Atlas</h3>
        <p className="atlas-form-hint">
          Start fresh with a blank Atlas — no files to create by hand. A backup of the current
          Atlas is created first, and your theme preference is kept.
        </p>
        <div className="atlas-manage-card__actions">
          {confirmNew ? (
            <>
              <Btn kind="danger" onClick={doNew} disabled={busy !== null}>
                {busy === "new" ? "Creating…" : "Confirm — replace everything"}
              </Btn>
              <Btn onClick={() => setConfirmNew(false)} disabled={busy !== null}>
                Cancel
              </Btn>
            </>
          ) : (
            <Btn onClick={() => setConfirmNew(true)} disabled={busy !== null}>
              New Atlas…
            </Btn>
          )}
        </div>
      </Card>
    </div>
  );
}
