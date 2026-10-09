"use client";

// Visit form fields (PRODUCT_SPEC §26.1): type, dates, with-friends,
// highlights, reflection, photos. It is a controlled form; the caller owns the
// draft and the save flow (AddFlow for creation, ManageVisits for editing).
import type { Media } from "../../lib/types";
import type { VisitType } from "../../lib/types";
import { TRANSPORTS, transportLabel } from "../../lib/transport";
import { TransportIcon } from "../Icons";
import { visitTypeLabel } from "../../lib/timeline";
import type { VisitDraft } from "./drafts";
import MediaPicker from "./MediaPicker";
import { Btn, Checkbox, Field, MonthInput, Select, TextArea } from "./FormUI";
import { t } from "../../lib/i18n";

const VISIT_TYPES: VisitType[] = ["lived", "trip", "day_trip", "stopover", "transit"];

interface VisitFormProps {
  value: VisitDraft;
  onChange: (d: VisitDraft) => void;
  media: Media[];
  placeId?: string | null;
  /** Hide the built-in Photos picker (Direct Edit renders its own media
   * section with cover/caption/reorder actions instead). */
  hidePhotos?: boolean;
}

export default function VisitForm({ value, onChange, media, placeId, hidePhotos }: VisitFormProps) {
  const set = (patch: Partial<VisitDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="atlas-entity-form">
      <Field label={t("Visit type")} hint={t("How deep was the visit? This shapes the Atlas story.")}>
        <Select
          value={value.visitType}
          onChange={(e) => set({ visitType: e.target.value as VisitType })}
        >
          {VISIT_TYPES.map((vt) => (
            <option key={vt} value={vt}>
              {visitTypeLabel(vt)}
            </option>
          ))}
        </Select>
      </Field>

      {value.visitType !== "lived" ? (
        <Field label={t("How you got there")} hint={t("Styles this trip's route on the map.")}>
          <div className="atlas-segmented atlas-segmented--transport" role="radiogroup" aria-label={t("How you got there")}>
            {TRANSPORTS.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.transport === mode}
                className={"atlas-segmented__item" + (value.transport === mode ? " is-active" : "")}
                onClick={() => set({ transport: mode })}
              >
                <TransportIcon mode={mode} size={15} />
                {transportLabel(mode)}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      <div className="atlas-form-grid">
        <Field label={t("Start date")}>
          {/* <input type="month"> only accepts YYYY-MM; the domain also allows
              day precision (YYYY-MM-DD), so display month precision while the
              draft keeps the raw value until the user actually changes it. */}
          <MonthInput
            value={value.startDate ? value.startDate.slice(0, 7) : ""}
            onChange={(e) => set({ startDate: e.target.value })}
          />
        </Field>
        <Field label={t("End date")}>
          <MonthInput
            value={value.endDate ? value.endDate.slice(0, 7) : ""}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        </Field>
      </div>

      <Checkbox
        label={t("With friends")}
        checked={value.withFriends}
        onChange={(v) => set({ withFriends: v })}
      />

      <Field label={t("Highlights")} hint={t("Memorable moments, not exhaustive itineraries.")}>
        <div className="atlas-form-list">
          {value.highlights.map((h, i) => (
            <div key={i} className="atlas-form-list__row">
              <input
                className="atlas-form-input"
                placeholder={t("Highlight name")}
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
                placeholder={t("Note (optional)")}
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
                aria-label={t("Remove highlight")}
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
            {t("+ Add highlight")}
          </Btn>
        </div>
      </Field>

      <Field label={t("Reflection")}>
        <TextArea
          rows={4}
          placeholder={t("What do you remember about being there?")}
          value={value.reflection}
          onChange={(e) => set({ reflection: e.target.value })}
        />
      </Field>

      <Field label={t("Photos")}>
        {hidePhotos ? null : (
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
