"use client";

// Media section: shared library grid with metadata editing, upload and delete.
// Deleting a Media record that is still referenced by a Visit/Wishlist is
// rejected by the runtime; unlink it from the entry first.
import { useRef, useState } from "react";
import type { Media } from "../../lib/types";
import type { ManageContext } from "./ManageAtlas";
import { Btn, EmptyState } from "./FormUI";

export default function ManageMedia({ ctx }: { ctx: ManageContext }) {
  const { media, places, repo, notify, reload } = ctx;
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPlace, setUploadPlace] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refsFor = (id: string) => {
    let visits = 0;
    let wishlist = 0;
    for (const v of ctx.visits) if ((v.mediaIds ?? []).includes(id)) visits++;
    for (const w of ctx.wishlist) if ((w.mediaIds ?? []).includes(id)) wishlist++;
    return { visits, wishlist };
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage("");
    try {
      for (const file of Array.from(files)) {
        await repo.uploadMedia({
          file,
          placeId: uploadPlace || undefined,
        });
      }
      notify("Media uploaded.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const del = async (id: string) => {
    setMessage("");
    try {
      await repo.deleteMedia(id);
      setConfirmId(null);
      notify("Media deleted.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setConfirmId(null);
    }
  };

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Media</h2>
      </div>
      {message ? <p className="atlas-locpicker__error">{message}</p> : null}

      <div
        className="atlas-manage-media-upload"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) upload(e.dataTransfer.files);
        }}
      >
        <div className="atlas-form-grid">
          <label className="atlas-form-field">
            <span className="atlas-form-label">Store under place (optional)</span>
            <select
              className="atlas-form-input"
              value={uploadPlace}
              onChange={(e) => setUploadPlace(e.target.value)}
            >
              <option value="">misc</option>
              {[...places]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}, {p.country}
                  </option>
                ))}
            </select>
          </label>
          <div className="atlas-manage-media-upload__actions">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
            <Btn kind="primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : "+ Upload photos"}
            </Btn>
            <span className="atlas-form-hint">Drag photos here, or click to choose. Stored under atlas-data/media.</span>
          </div>
        </div>
      </div>

      {media.length === 0 ? (
        <EmptyState>No media yet.</EmptyState>
      ) : (
        <div className="atlas-manage-media">
          {media.map((m) => {
            const refs = refsFor(m.id);
            const referenced = refs.visits > 0 || refs.wishlist > 0;
            return (
              <div key={m.id} className="atlas-manage-media__card">
                <img src={m.path} alt={m.caption ?? ""} loading="lazy" draggable={false} />
                {editId === m.id ? (
                  <MediaMetaForm
                    media={m}
                    onSave={async (next) => {
                      await repo.updateMedia(next);
                      setEditId(null);
                      notify("Media metadata updated.");
                      reload();
                    }}
                    onCancel={() => setEditId(null)}
                  />
                ) : (
                  <div className="atlas-manage-media__meta">
                    <div className="atlas-manage-media__caption">{m.caption || "Untitled"}</div>
                    <div className="atlas-manage-media__sub">
                      {m.author ? m.author : "no author"}
                      {m.license ? " · " + m.license : ""}
                      {m.sourceUrl ? " · web" : ""}
                    </div>
                    <div className="atlas-manage-media__refs">
                      {referenced
                        ? `${refs.visits} visit${refs.visits > 1 ? "s" : ""} · ${refs.wishlist} wishlist`
                        : "not referenced"}
                    </div>
                    <div className="atlas-manage-media__actions">
                      <Btn onClick={() => setEditId(m.id)}>Edit</Btn>
                      {confirmId === m.id ? (
                        <Btn kind="danger" onClick={() => del(m.id)} disabled={referenced}>
                          Confirm
                        </Btn>
                      ) : (
                        <Btn kind="danger" onClick={() => setConfirmId(m.id)}>
                          Delete
                        </Btn>
                      )}
                    </div>
                    {confirmId === m.id && referenced ? (
                      <p className="atlas-form-hint">
                        Still referenced — remove it from the visit/wishlist first.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MediaMetaForm({
  media,
  onSave,
  onCancel,
}: {
  media: Media;
  onSave: (m: Media) => Promise<void>;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState(media.caption ?? "");
  const [author, setAuthor] = useState(media.author ?? "");
  const [license, setLicense] = useState(media.license ?? "");
  const [sourceUrl, setSourceUrl] = useState(media.sourceUrl ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="atlas-manage-media__edit">
      <input
        className="atlas-form-input"
        placeholder="Caption"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />
      <input
        className="atlas-form-input"
        placeholder="Author"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
      />
      <input
        className="atlas-form-input"
        placeholder="License"
        value={license}
        onChange={(e) => setLicense(e.target.value)}
      />
      <input
        className="atlas-form-input"
        placeholder="Source URL"
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
      />
      <div className="atlas-manage-media__actions">
        <Btn
          kind="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              ...media,
              caption: caption.trim() || undefined,
              author: author.trim() || undefined,
              license: license.trim() || undefined,
              sourceUrl: sourceUrl.trim() || undefined,
            });
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}
