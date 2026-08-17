"use client";

// Visit form fields (PRODUCT_SPEC §26.1): type, dates, with-friends,
// highlights, reflection, photos. It is a controlled form; the caller owns the
// draft and the save flow (AddFlow for creation, ManageVisits for editing).
import type { Media } from "../../lib/types";
import type { VisitType } from "../../lib/types";
import { visitTypeLabel } from "../../lib/timeline";
import type { VisitDraft } from "./drafts";
import MediaPicker from "./MediaPicker";
import { Btn, Checkbox, Field, MonthInput, Select, TextArea } from "./FormUI";

const VISIT_TYPES: VisitType[] = ["lived", "trip", "day_trip", "stopover", "transit"];

interface VisitFormProps {
  value: VisitDraft;
  onChange: (d: VisitDraft) => void;
  media: Media[];
  placeId?: string | null;
}

export default function VisitForm({ value, onChange, media, placeId }: VisitFormProps) {
  const set = (patch: Partial<VisitDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="atlas-entity-form">
      <Field label="Visit type" hint="How deep was the visit? This shapes the Atlas story.">
        <Select
          value={value.visitType}
          onChange={(e) => set({ visitType: e.target.value as VisitType })}
        >
          {VISIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {visitTypeLabel(t)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="atlas-form-grid">
        <Field label="Start date">
          <MonthInput value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="End date">
          <MonthInput value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
      </div>

      <Checkbox
        label="With friends"
        checked={value.withFriends}
        onChange={(v) => set({ withFriends: v })}
      />

      <Field label="Highlights" hint="Memorable moments, not exhaustive itineraries.">
        <div className="atlas-form-list">
          {value.highlights.map((h, i) => (
            <div key={i} className="atlas-form-list__row">
              <input
                className="atlas-form-input"
                placeholder="Highlight name"
                value={h.name}
                onChange={(e) =>
                  set({
                    highlights: value.highlights.map((x, idx) =>
                      idx === i ? { ...x, name: e.target.value } : x
                    ),
                  })
                }
              />
              <input
                className="atlas-form-input"
                placeholder="Note (optional)"
                value={h.note}
                onChange={(e) =>
                  set({
                    highlights: value.highlights.map((x, idx) =>
                      idx === i ? { ...x, note: e.target.value } : x
                    ),
                  })
                }
              />
              <button
                type="button"
                className="atlas-form-icon-btn"
                aria-label="Remove highlight"
                onClick={() => set({ highlights: value.highlights.filter((_, idx) => idx !== i) })}
              >
                &times;
              </button>
            </div>
          ))}
          <Btn
            onClick={() =>
              set({ highlights: [...value.highlights, { name: "", note: "" }] })
            }
          >
            + Add highlight
          </Btn>
        </div>
      </Field>

      <Field label="Reflection">
        <TextArea
          rows={4}
          placeholder="What do you remember about being there?"
          value={value.reflection}
          onChange={(e) => set({ reflection: e.target.value })}
        />
      </Field>

      <Field label="Photos">
        <MediaPicker
          media={media}
          placeId={placeId}
          selectedIds={value.mediaIds}
          onChange={(ids) => set({ mediaIds: ids })}
        />
      </Field>
    </div>
  );
}
