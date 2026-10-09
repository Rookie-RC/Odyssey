"use client";

// Visits section: list visits (place, type, dates), add, edit and delete.
import { useState } from "react";
import { getPlace } from "../../lib/domain";
import { formatDateRange } from "../../lib/domain";
import { visitTypeLabel } from "../../lib/timeline";
import type { ManageContext } from "./ManageAtlas";
import { Btn, EmptyState, Row } from "./FormUI";
import { t, tn } from "../../lib/i18n";

export default function ManageVisits({ ctx }: { ctx: ManageContext }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { visits, places, repo, notify, reload } = ctx;

  const del = async (id: string) => {
    try {
      await repo.deleteVisit(id);
      setConfirmId(null);
      notify(t("Visit removed."));
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      setConfirmId(null);
    }
  };

  const sorted = [...visits].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">{t("Visits")}</h2>
        <Btn kind="primary" onClick={() => ctx.openAdd("visit")}>
          {t("+ I've been here")}
        </Btn>
      </div>

      {sorted.length === 0 ? (
        <EmptyState>{t("No visits recorded yet.")}</EmptyState>
      ) : (
        <div className="atlas-manage-list">
          {sorted.map((v) => {
            const place = getPlace(places, v.placeId);
            return (
              <Row
                key={v.id}
                actions={
                  <>
                    <Btn onClick={() => ctx.openEditVisit(v.id)}>{t("Edit")}</Btn>
                    {confirmId === v.id ? (
                      <Btn kind="danger" onClick={() => del(v.id)}>
                        {t("Confirm delete")}
                      </Btn>
                    ) : (
                      <Btn kind="danger" onClick={() => setConfirmId(v.id)}>
                        {t("Delete")}
                      </Btn>
                    )}
                  </>
                }
              >
                <div className="atlas-manage-row__title">
                  {place?.name ?? t("(missing place)")}
                  <span className="atlas-manage-row__sub">
                    {visitTypeLabel(v.visitType)}
                    {v.startDate || v.endDate ? " · " + formatDateRange(v.startDate, v.endDate) : ""}
                    {v.withFriends ? " · " + t("with friends") : ""}
                  </span>
                </div>
                <div className="atlas-manage-row__meta">
                  {place?.country ?? ""}
                  {v.highlights && v.highlights.length > 0
                    ? " · " + tn(v.highlights.length, "{n} highlight", "{n} highlights")
                    : ""}
                  {v.mediaIds && v.mediaIds.length > 0 ? " · " + tn(v.mediaIds.length, "{n} photo", "{n} photos") : ""}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
