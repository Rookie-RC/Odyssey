"use client";

// Study abroad on the Profile (lib/abroad.ts): a quiet summary of each stay —
// how long, where it took you, what you did — and its editor.
import { useMemo } from "react";
import type { AbroadPeriod, Place, Visit } from "../lib/types";
import { summarizeAbroad } from "../lib/abroad";
import { activityLabel } from "../lib/activity";
import { formatDateRange } from "../lib/domain";
import { t, tn } from "../lib/i18n";
import Flag from "./Flag";
import { ActivityIcon } from "./Icons";

export function AbroadSummaryList({
  periods,
  places,
  visits,
}: {
  periods: AbroadPeriod[];
  places: Place[];
  visits: Visit[];
}) {
  const summaries = useMemo(
    () =>
      [...periods]
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((p) => summarizeAbroad(p, places, visits)),
    [periods, places, visits]
  );
  if (summaries.length === 0) return null;
  const countryName = (cc: string) => places.find((p) => p.countryCode === cc)?.country ?? cc;

  return (
    <ul className="atlas-abroad">
      {summaries.map((s) => {
        const p = s.period;
        const when =
          s.status === "ongoing"
            ? t("Since {date}", { date: formatDateRange(p.startDate) })
            : formatDateRange(p.startDate, p.endDate);
        return (
          <li key={p.id} className="atlas-abroad__item">
            <div className="atlas-abroad__head">
              <span className="atlas-abroad__name atlas-break">{p.label || t("Studying abroad")}</span>
              {s.dayNumber != null ? (
                <span className="atlas-abroad__day">{t("Day {n}", { n: s.dayNumber })}</span>
              ) : s.status === "upcoming" ? (
                <span className="atlas-abroad__day">{t("Upcoming")}</span>
              ) : null}
            </div>
            <div className="atlas-abroad__when atlas-date">{when}</div>
            {s.status !== "upcoming" ? (
              <p className="atlas-abroad__facts">
                {[
                  tn(s.days, "{n} day abroad", "{n} days abroad"),
                  s.homeTrips > 0 ? tn(s.homeTrips, "home once", "home {n} times") : null,
                  s.countries.length > 0 ? tn(s.countries.length, "{n} country", "{n} countries") : null,
                  s.places.length > 0 ? tn(s.places.length, "{n} place", "{n} places") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {s.countries.length > 0 ? (
              <div className="atlas-abroad__flags" aria-label={t("Countries visited")}>
                {s.countries.map((cc) => (
                  <Flag key={cc} code={cc} size={14} title={countryName(cc)} />
                ))}
              </div>
            ) : null}
            {s.activities.length > 0 ? (
              <div className="atlas-activity-tags atlas-abroad__activities">
                {s.activities.slice(0, 4).map(({ activity, count }) => (
                  <span key={activity} className="atlas-activity-tag">
                    <ActivityIcon activity={activity} size={13} />
                    {activityLabel(activity)}
                    {count > 1 ? <span className="atlas-abroad__count">×{count}</span> : null}
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// --- editor ---

export interface AbroadDraft {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  homeTrips: { startDate: string; endDate: string }[];
}

export function abroadToDraft(periods: AbroadPeriod[] | undefined): AbroadDraft[] {
  return (periods ?? []).map((p) => ({
    id: p.id,
    label: p.label ?? "",
    startDate: p.startDate,
    endDate: p.endDate ?? "",
    homeTrips: (p.homeTrips ?? []).map((h) => ({ startDate: h.startDate, endDate: h.endDate ?? "" })),
  }));
}

/** Draft → records. Periods without an arrival date are dropped, as are home
 * trips without a start; the caller reports `incomplete` to the user. */
export function abroadFromDraft(drafts: AbroadDraft[]): { periods: AbroadPeriod[]; incomplete: boolean } {
  let incomplete = false;
  const periods: AbroadPeriod[] = [];
  for (const d of drafts) {
    if (!d.startDate) {
      if (d.label.trim() || d.endDate || d.homeTrips.length > 0) incomplete = true;
      continue;
    }
    const p: AbroadPeriod = { id: d.id, startDate: d.startDate };
    if (d.label.trim()) p.label = d.label.trim();
    if (d.endDate) p.endDate = d.endDate;
    const trips = d.homeTrips.filter((h) => {
      if (!h.startDate && h.endDate) incomplete = true;
      return h.startDate;
    });
    if (trips.length > 0) p.homeTrips = trips.map((h) => (h.endDate ? { ...h } : { startDate: h.startDate }));
    periods.push(p);
  }
  return { periods, incomplete };
}

function newId(): string {
  return "abroad-" + Math.random().toString(36).slice(2, 8);
}

/** A date input that keeps a month-precision value ("2023-10") as it is until
 * the user actually picks a day (<input type="date"> cannot show "YYYY-MM"). */
function DayInput({
  value,
  onChange,
  label,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  min?: string;
}) {
  return (
    <input
      type="date"
      className="atlas-form-input"
      aria-label={label}
      value={value.length === 7 ? value + "-01" : value}
      min={min && min.length === 7 ? min + "-01" : min || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AbroadEditor({
  value,
  onChange,
}: {
  value: AbroadDraft[];
  /** Functional updates, like the rest of the profile form. */
  onChange: (update: (d: AbroadDraft[]) => AbroadDraft[]) => void;
}) {
  const setPeriod = (id: string, patch: Partial<AbroadDraft>) =>
    onChange((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const setTrip = (id: string, i: number, patch: Partial<AbroadDraft["homeTrips"][number]>) =>
    onChange((list) =>
      list.map((p) =>
        p.id === id ? { ...p, homeTrips: p.homeTrips.map((h, idx) => (idx === i ? { ...h, ...patch } : h)) } : p
      )
    );

  return (
    <div className="atlas-form-field atlas-abroad-edit">
      <span className="atlas-form-label">{t("Studying abroad")}</span>
      <span className="atlas-form-hint">
        {t("When you arrived, when you went home for good, and the holidays back home in between.")}
      </span>
      {value.map((p) => (
        <fieldset key={p.id} className="atlas-abroad-edit__period">
          <legend className="atlas-visually-hidden">{p.label || t("Studying abroad")}</legend>
          <input
            className="atlas-form-input"
            placeholder={t("Name, e.g. TUM · MSc")}
            value={p.label}
            onChange={(e) => setPeriod(p.id, { label: e.target.value })}
          />
          <div className="atlas-abroad-edit__dates">
            <label>
              <span className="atlas-abroad-edit__small">{t("Arrived")}</span>
              <DayInput value={p.startDate} label={t("Arrived")} onChange={(v) => setPeriod(p.id, { startDate: v })} />
            </label>
            <label>
              <span className="atlas-abroad-edit__small">{t("Went home for good")}</span>
              <DayInput
                value={p.endDate}
                label={t("Went home for good")}
                min={p.startDate}
                onChange={(v) => setPeriod(p.id, { endDate: v })}
              />
            </label>
          </div>
          <span className="atlas-abroad-edit__small">{t("Leave empty while you are still abroad.")}</span>

          {p.homeTrips.length > 0 ? (
            <div className="atlas-abroad-edit__trips">
              <span className="atlas-abroad-edit__small">{t("Trips home")}</span>
              {p.homeTrips.map((h, i) => (
                <div key={i} className="atlas-abroad-edit__trip">
                  <DayInput value={h.startDate} label={t("Left")} min={p.startDate} onChange={(v) => setTrip(p.id, i, { startDate: v })} />
                  <span aria-hidden="true">–</span>
                  <DayInput value={h.endDate} label={t("Came back")} min={h.startDate} onChange={(v) => setTrip(p.id, i, { endDate: v })} />
                  <button
                    type="button"
                    className="atlas-form-icon-btn"
                    aria-label={t("Remove trip home")}
                    onClick={() =>
                      onChange((list) =>
                        list.map((x) => (x.id === p.id ? { ...x, homeTrips: x.homeTrips.filter((_, idx) => idx !== i) } : x))
                      )
                    }
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="atlas-abroad-edit__actions">
            <button
              type="button"
              className="atlas-form-add-btn"
              onClick={() =>
                onChange((list) =>
                  list.map((x) => (x.id === p.id ? { ...x, homeTrips: [...x.homeTrips, { startDate: "", endDate: "" }] } : x))
                )
              }
            >
              {t("+ Add a trip home")}
            </button>
            <button
              type="button"
              className="atlas-form-add-btn atlas-form-add-btn--danger"
              onClick={() => onChange((list) => list.filter((x) => x.id !== p.id))}
            >
              {t("Remove")}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="atlas-form-add-btn"
        onClick={() => onChange((list) => [...list, { id: newId(), label: "", startDate: "", endDate: "", homeTrips: [] }])}
      >
        {value.length === 0 ? t("+ Add your time abroad") : t("+ Add another stay")}
      </button>
    </div>
  );
}
