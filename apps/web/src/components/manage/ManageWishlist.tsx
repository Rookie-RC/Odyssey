"use client";

// Wishlist section: list wishlist items (place, seasons, target, priority),
// add, edit and delete.
import { useState } from "react";
import { getPlace, targetTimeLabel } from "../../lib/domain";
import { seasonLabel } from "../../lib/timeline";
import type { ManageContext } from "./ManageAtlas";
import { Btn, EmptyState, Row } from "./FormUI";

export default function ManageWishlist({ ctx }: { ctx: ManageContext }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { wishlist, places, repo, notify, reload } = ctx;

  const del = async (id: string) => {
    try {
      await repo.deleteWishlist(id);
      setConfirmId(null);
      notify("Wishlist item removed.");
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
      setConfirmId(null);
    }
  };

  const sorted = [...wishlist].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id)
  );

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Wishlist</h2>
        <Btn kind="primary" onClick={() => ctx.openAdd("wishlist")}>
          + I want to go here
        </Btn>
      </div>

      {sorted.length === 0 ? (
        <EmptyState>No wishlist entries yet.</EmptyState>
      ) : (
        <div className="atlas-manage-list">
          {sorted.map((w) => {
            const place = getPlace(places, w.placeId);
            const hasTiming = w.targetTime && (w.targetTime.year != null || w.targetTime.season != null);
            return (
              <Row
                key={w.id}
                actions={
                  <>
                    <Btn onClick={() => ctx.openEditWishlist(w.id)}>Edit</Btn>
                    {confirmId === w.id ? (
                      <Btn kind="danger" onClick={() => del(w.id)}>
                        Confirm delete
                      </Btn>
                    ) : (
                      <Btn kind="danger" onClick={() => setConfirmId(w.id)}>
                        Delete
                      </Btn>
                    )}
                  </>
                }
              >
                <div className="atlas-manage-row__title">
                  {place?.name ?? "(missing place)"}
                  <span className="atlas-manage-row__sub">
                    {w.priority ? "Priority " + w.priority : "No priority"}
                    {w.seasons && w.seasons.length > 0
                      ? " · " + w.seasons.map(seasonLabel).join(", ")
                      : " · any season"}
                    {w.targetTime ? " · " + targetTimeLabel(w.targetTime) : ""}
                  </span>
                </div>
                <div className="atlas-manage-row__meta">
                  {place?.country ?? ""}
                  {w.why ? " · " + w.why : ""}
                  <span className={hasTiming ? "" : " atlas-manage-row__meta--muted"}>
                    {hasTiming ? " · on timeline" : " · not on timeline (no target time)"}
                  </span>
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
