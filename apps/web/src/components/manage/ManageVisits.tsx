"use client";

// Visits section: list visits (place, type, dates), add, edit and delete.
import { useState } from "react";
import { getPlace } from "../../lib/domain";
import { formatDateRange } from "../../lib/domain";
import { visitTypeLabel } from "../../lib/timeline";
import type { ManageContext } from "./ManageAtlas";
import { Btn, EmptyState, Row } from "./FormUI";

export default function ManageVisits({ ctx }: { ctx: ManageContext }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { visits, places, repo, notify, reload } = ctx;

  const del = async (id: string) => {
    try {
      await repo.deleteVisit(id);
      setConfirmId(null);
      notify("Visit removed.");
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
        <h2 className="atlas-manage-section__title">Visits</h2>
        <Btn kind="primary" onClick={() => ctx.openAdd("visit")}>
          + I've been here
        </Btn>
      </div>

      {sorted.length === 0 ? (
        <EmptyState>No visits recorded yet.</EmptyState>
      ) : (
        <div className="atlas-manage-list">
          {sorted.map((v) => {
            const place = getPlace(places, v.placeId);
            return (
              <Row
                key={v.id}
                actions={
                  <>
                    <Btn onClick={() => ctx.openEditVisit(v.id)}>Edit</Btn>
                    {confirmId === v.id ? (
                      <Btn kind="danger" onClick={() => del(v.id)}>
                        Confirm delete
                      </Btn>
                    ) : (
                      <Btn kind="danger" onClick={() => setConfirmId(v.id)}>
                        Delete
                      </Btn>
                    )}
                  </>
                }
              >
                <div className="atlas-manage-row__title">
                  {place?.name ?? "(missing place)"}
                  <span className="atlas-manage-row__sub">
                    {visitTypeLabel(v.visitType)}
                    {v.startDate || v.endDate ? " · " + formatDateRange(v.startDate, v.endDate) : ""}
                    {v.withFriends ? " · with friends" : ""}
                  </span>
                </div>
                <div className="atlas-manage-row__meta">
                  {place?.country ?? ""}
                  {v.highlights && v.highlights.length > 0
                    ? ` · ${v.highlights.length} highlight${v.highlights.length > 1 ? "s" : ""}`
                    : ""}
                  {v.mediaIds && v.mediaIds.length > 0 ? ` · ${v.mediaIds.length} photo${v.mediaIds.length > 1 ? "s" : ""}` : ""}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
