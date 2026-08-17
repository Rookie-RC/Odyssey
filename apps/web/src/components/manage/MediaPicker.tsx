"use client";

// MediaPicker: pick existing media from the shared library and/or upload new
// images. Uploads go through the local runtime (stored under atlas-data/media,
// organized by Place when a placeId is known) and immediately join the library.
import { useRef, useState } from "react";
import type { Media } from "../../lib/types";
import { api } from "../../lib/api";
import { Btn, EmptyState } from "./FormUI";

interface MediaPickerProps {
  media: Media[];
  /** Place the uploaded files are organized under (folder name). */
  placeId?: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export default function MediaPicker({ media, placeId, selectedIds, onChange }: MediaPickerProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const m = await api.uploadMedia({ file, placeId: placeId ?? undefined });
        added.push(m.id);
      }
      onChange([...selectedIds, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="atlas-mediapicker">
      {media.length === 0 ? (
        <EmptyState>No media yet — upload the first image below.</EmptyState>
      ) : (
        <div className="atlas-mediapicker__grid">
          {media.map((m) => {
            const sel = selectedIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={"atlas-mediapicker__item" + (sel ? " atlas-mediapicker__item--sel" : "")}
                onClick={() => toggle(m.id)}
                aria-pressed={sel}
                title={m.caption ?? m.path}
              >
                <img src={m.path} alt={m.caption ?? ""} loading="lazy" draggable={false} />
                <span className="atlas-mediapicker__check" aria-hidden="true">
                  {sel ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="atlas-mediapicker__upload">
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
        <span className="atlas-form-hint">Stored locally under atlas-data/media.</span>
      </div>
      {error ? <p className="atlas-locpicker__error">{error}</p> : null}
    </div>
  );
}
