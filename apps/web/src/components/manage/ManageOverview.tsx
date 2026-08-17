"use client";

// Overview section: counts + the primary "+ Add" actions (PRODUCT_SPEC §26).
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card } from "./FormUI";

export default function ManageOverview({ ctx }: { ctx: ManageContext }) {
  const { places, visits, wishlist, media } = ctx;
  const stat = (label: string, value: number) => (
    <div className="atlas-manage-stat">
      <div className="atlas-manage-stat__value">{value}</div>
      <div className="atlas-manage-stat__label">{label}</div>
    </div>
  );
  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">Overview</h2>
        <p className="atlas-form-hint">
          Everything is stored locally in your atlas-data folder — no files to edit by hand.
        </p>
      </div>

      <div className="atlas-manage-stats">
        {stat("Places", places.length)}
        {stat("Visits", visits.length)}
        {stat("Wishlist", wishlist.length)}
        {stat("Media", media.length)}
      </div>

      <Card>
        <div className="atlas-manage-add">
          <div className="atlas-manage-add__text">
            <div className="atlas-manage-add__title">Add to your Atlas</div>
            <p className="atlas-form-hint">
              Search for a place online — the Atlas fills in the country, coordinates and place
              type for you.
            </p>
          </div>
          <div className="atlas-manage-add__actions">
            <Btn kind="primary" onClick={() => ctx.openAdd("visit")}>
              + I've been here
            </Btn>
            <Btn onClick={() => ctx.openAdd("wishlist")}>+ I want to go here</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
