"use client";

// Places section: list all Places with visit/wishlist context, edit and delete.
// Deleting a Place that is still referenced by a Visit or Wishlist is rejected
// by the runtime (data integrity — shared records are never silently removed).
import { useState } from "react";
import { placeTypeLabel } from "../../lib/places";
import type { ManageContext } from "./ManageAtlas";
import { Btn, EmptyState, Row } from "./FormUI";

export default function ManagePlaces({ ctx }: { ctx: ManageContext }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const { places, visits, wishlist, repo, notify, reload } = ctx;

  const visitCount = (placeId: string) => visits.filter((v) => v.placeId === placeId).length;
  const wishlistCount = (placeId: string) => wishlist.filter((w) => w.placeId === placeId).length;

  const del = async (id: string) => {
    setMessage("");
    try {
      await repo.deletePlace(id);
      setConfirmId(null);
      notify("Place deleted.");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setConfirmId(null);
    }
  };

  const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Places</h2>
        <Btn onClick={() => ctx.openAdd("visit")}>+ Add</Btn>
      </div>
      {message ? <p className="atlas-locpicker__error">{message}</p> : null}

      {sorted.length === 0 ? (
        <EmptyState>No places yet. Add your first visit or wishlist entry.</EmptyState>
      ) : (
        <div className="atlas-manage-list">
          {sorted.map((p) => {
            const vc = visitCount(p.id);
            const wc = wishlistCount(p.id);
            return (
              <Row
                key={p.id}
                actions={
                  <>
                    <Btn onClick={() => ctx.openEditPlace(p.id)}>Edit</Btn>
                    {confirmId === p.id ? (
                      <Btn kind="danger" onClick={() => del(p.id)}>
                        Confirm delete
                      </Btn>
                    ) : (
                      <Btn
                        kind="danger"
                        onClick={() => {
                          setMessage("");
                          setConfirmId(p.id);
                        }}
                      >
                        Delete
                      </Btn>
                    )}
                  </>
                }
              >
                <div className="atlas-manage-row__title">
                  {p.name}
                  <span className="atlas-manage-row__sub">
                    {p.country}
                    {p.countryCode ? " · " + p.countryCode : ""} · {placeTypeLabel(p.type)}
                  </span>
                </div>
                <div className="atlas-manage-row__meta">
                  {vc > 0 ? `${vc} visit${vc > 1 ? "s" : ""}` : "no visits"}
                  {wc > 0 ? ` · ${wc} wishlist` : ""}
                  {p.id === ctx.profile?.currentBase?.placeId ? " · current base" : ""}
                </div>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
