"use client";

// Wishlist form fields (PRODUCT_SPEC §26.2): seasons, optional target timing,
// priority, why, inspirations, images, note. No forced itinerary fields.
import type { InspirationType, Media, Season } from "../../lib/types";
import { inspirationTypeLabel } from "../../lib/domain";
import { seasonLabel } from "../../lib/timeline";
import type { InspirationDraft, WishlistDraft } from "./drafts";
import { emptyInspiration } from "./drafts";
import MediaPicker from "./MediaPicker";
import { Btn, Checkbox, Field, Select, TextArea, TextInput } from "./FormUI";

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const INSPIRATION_TYPES: InspirationType[] = [
  "book", "movie", "video", "social_media", "article", "friend", "photo", "music", "other",
];

interface WishlistFormProps {
  value: WishlistDraft;
  onChange: (d: WishlistDraft) => void;
  media: Media[];
  placeId?: string | null;
  /** Hide the built-in Images picker (Direct Edit renders its own media
   * section with cover/caption/reorder actions instead). */
  hideImages?: boolean;
}

export default function WishlistForm({ value, onChange, media, placeId, hideImages }: WishlistFormProps) {
  const set = (patch: Partial<WishlistDraft>) => onChange({ ...value, ...patch });

  const toggleSeason = (s: Season) =>
    set({
      seasons: value.seasons.includes(s)
        ? value.seasons.filter((x) => x !== s)
        : [...value.seasons, s],
    });

  const setInspiration = (i: number, patch: Partial<InspirationDraft>) =>
    set({
      inspirations: value.inspirations.map((x, idx) => (idx === i ? { ...x, ...patch } : x)),
    });

  return (
    <div className="atlas-entity-form">
      <Field label="Best seasons" hint="Where Next groups destinations by season.">
        <div className="atlas-form-checks">
          {SEASONS.map((s) => (
            <Checkbox key={s} label={seasonLabel(s)} checked={value.seasons.includes(s)} onChange={() => toggleSeason(s)} />
          ))}
        </div>
      </Field>

      <div className="atlas-form-grid">
        <Field label="Target year (optional)">
          <TextInput
            type="number"
            min={2025}
            max={2100}
            placeholder="e.g. 2027"
            value={value.targetYear}
            onChange={(e) => set({ targetYear: e.target.value })}
          />
        </Field>
        <Field label="Target season (optional)">
          <Select
            value={value.targetSeason}
            onChange={(e) => set({ targetSeason: e.target.value as "" | Season })}
          >
            <option value="">—</option>
            {SEASONS.map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Priority" hint="1 = highest. Used to rank Where Next.">
        <Select
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value })}
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Why" hint="Short display-oriented reason.">
        <TextArea
          rows={2}
          placeholder="e.g. Midnight sun, dramatic mountains and hiking."
          value={value.why}
          onChange={(e) => set({ why: e.target.value })}
        />
      </Field>

      <Field label="Inspirations">
        <div className="atlas-form-list">
          {value.inspirations.map((insp, i) => (
            <div key={i} className="atlas-form-card">
              <div className="atlas-form-grid">
                <Select
                  value={insp.type}
                  onChange={(e) => setInspiration(i, { type: e.target.value as InspirationType })}
                >
                  {INSPIRATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {inspirationTypeLabel(t)}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="atlas-form-icon-btn"
                  aria-label="Remove inspiration"
                  onClick={() =>
                    set({ inspirations: value.inspirations.filter((_, idx) => idx !== i) })
                  }
                >
                  &times;
                </button>
              </div>
              <div className="atlas-form-grid">
                <TextInput
                  placeholder="Title"
                  value={insp.title}
                  onChange={(e) => setInspiration(i, { title: e.target.value })}
                />
                <TextInput
                  placeholder="Creator"
                  value={insp.creator}
                  onChange={(e) => setInspiration(i, { creator: e.target.value })}
                />
              </div>
              <div className="atlas-form-grid">
                <TextInput
                  placeholder="Platform (e.g. YouTube)"
                  value={insp.platform}
                  onChange={(e) => setInspiration(i, { platform: e.target.value })}
                />
                <TextInput
                  placeholder="URL"
                  value={insp.url}
                  onChange={(e) => setInspiration(i, { url: e.target.value })}
                />
              </div>
              <TextInput
                placeholder="Note (optional)"
                value={insp.note}
                onChange={(e) => setInspiration(i, { note: e.target.value })}
              />
            </div>
          ))}
          <Btn onClick={() => set({ inspirations: [...value.inspirations, emptyInspiration()] })}>
            + Add inspiration
          </Btn>
        </div>
      </Field>

      <Field label="Notes" hint="Free-form personal planning thoughts.">
        <TextArea
          rows={3}
          placeholder="Maybe 2027 or 2028. Could go with friends…"
          value={value.note}
          onChange={(e) => set({ note: e.target.value })}
        />
      </Field>

      <Field label="Images">
        {hideImages ? null : (
          <MediaPicker
            media={media}
            placeId={placeId}
            selectedIds={value.mediaIds}
            onChange={(ids) => set({ mediaIds: ids })}
          />
        )}
      </Field>
    </div>
  );
}
