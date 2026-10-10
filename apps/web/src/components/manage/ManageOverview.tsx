"use client";

// Overview section: counts, the primary "+ Add" actions (PRODUCT_SPEC §26),
// and a quiet checklist of gaps that make the public Atlas look thinner than
// it is (a memory without a photo, a wish that never reaches the Timeline…).
import { useMemo } from "react";
import type { ManageContext } from "./ManageAtlas";
import { Btn, Card } from "./FormUI";
import { t, useLocale } from "../../lib/i18n";

interface Gap {
  id: string;
  title: string;
  why: string;
  items: { key: string; label: string; open: () => void }[];
}

export default function ManageOverview({ ctx }: { ctx: ManageContext }) {
  const { places, visits, wishlist, media, profile, runtime } = ctx;
  const placeName = useMemo(() => new Map(places.map((p) => [p.id, p.name])), [places]);
  // The gap titles are translated inside the memo, so it recomputes on a
  // language switch.
  const locale = useLocale();

  const gaps = useMemo<Gap[]>(() => {
    const mediaIds = new Set(media.map((m) => m.id));
    const name = (id: string) => placeName.get(id) ?? id;
    const out: Gap[] = [];

    const noPhoto = visits.filter((v) => !(v.mediaIds ?? []).some((id) => mediaIds.has(id)));
    if (noPhoto.length)
      out.push({
        id: "visit-photo",
        title: t("Memories without a photo"),
        why: t("They show as a plain tile on the Timeline."),
        items: noPhoto.map((v) => ({ key: v.id, label: name(v.placeId), open: () => ctx.openEditVisit(v.id) })),
      });

    const noDate = visits.filter((v) => !v.startDate && !v.endDate);
    if (noDate.length)
      out.push({
        id: "visit-date",
        title: t("Memories without a date"),
        why: t("They sit at the far left of the Timeline as “Earlier” and draw no route."),
        items: noDate.map((v) => ({ key: v.id, label: name(v.placeId), open: () => ctx.openEditVisit(v.id) })),
      });

    const noReflection = visits.filter((v) => !v.reflection && !(v.highlights ?? []).length);
    if (noReflection.length)
      out.push({
        id: "visit-story",
        title: t("Memories without a story"),
        why: t("No highlights or reflection yet — the Detail Sheet will be quiet."),
        items: noReflection.map((v) => ({ key: v.id, label: name(v.placeId), open: () => ctx.openEditVisit(v.id) })),
      });

    const untimed = wishlist.filter((w) => !w.targetTime || (w.targetTime.year == null && w.targetTime.season == null));
    if (untimed.length)
      out.push({
        id: "wish-time",
        title: t("Wishes without a target time"),
        why: t("They live in Where Next but never appear on the Timeline's future side."),
        items: untimed.map((w) => ({ key: w.id, label: name(w.placeId), open: () => ctx.openEditWishlist(w.id) })),
      });

    const wishNoPhoto = wishlist.filter((w) => !(w.mediaIds ?? []).some((id) => mediaIds.has(id)));
    if (wishNoPhoto.length)
      out.push({
        id: "wish-photo",
        title: t("Wishes without an inspiration image"),
        why: t("Where Next is photographic; an image makes the shelf sing."),
        items: wishNoPhoto.map((w) => ({ key: w.id, label: name(w.placeId), open: () => ctx.openEditWishlist(w.id) })),
      });

    const used = new Set([
      ...visits.map((v) => v.placeId),
      ...wishlist.map((w) => w.placeId),
      profile?.currentBase?.placeId ?? "",
    ]);
    const orphans = places.filter((p) => !used.has(p.id));
    if (orphans.length)
      out.push({
        id: "orphan",
        title: t("Places with no visit or wish"),
        why: t("They exist but appear nowhere in the Atlas."),
        items: orphans.map((p) => ({ key: p.id, label: p.name, open: () => ctx.openEditPlace(p.id) })),
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, visits, wishlist, media, profile, placeName, ctx, locale]);

  const stat = (label: string, value: number) => (
    <div className="atlas-manage-stat">
      <div className="atlas-manage-stat__value">{value}</div>
      <div className="atlas-manage-stat__label">{label}</div>
    </div>
  );

  return (
    <div className="atlas-manage-section">
      <div className="atlas-manage-section__head">
        <h2 className="atlas-manage-section__title">{t("Overview")}</h2>
        <p className="atlas-form-hint">
          {runtime?.mode === "cloud"
            ? t("Everything is stored in your account.")
            : t("Everything stays on this device. Export it now and then to keep a copy.")}
        </p>
      </div>

      <div className="atlas-manage-stats">
        {stat(t("Places"), places.length)}
        {stat(t("Visits"), visits.length)}
        {stat(t("Wishlist"), wishlist.length)}
        {stat(t("Media"), media.length)}
      </div>

      <Card>
        <div className="atlas-manage-add">
          <div className="atlas-manage-add__text">
            <div className="atlas-manage-add__title">{t("Add to your Atlas")}</div>
            <p className="atlas-form-hint">
              {t("Search for a place online — the Atlas fills in the country, coordinates and place type for you.")}
            </p>
          </div>
          <div className="atlas-manage-add__actions">
            <Btn kind="primary" onClick={() => ctx.openAdd("visit")}>
              {t("+ I've been here")}
            </Btn>
            <Btn onClick={() => ctx.openAdd("wishlist")}>{t("+ I want to go here")}</Btn>
          </div>
        </div>
      </Card>

      {!profile?.currentBase?.placeId && places.length > 0 ? (
        <Card>
          <div className="atlas-manage-card__title">{t("No current base")}</div>
          <p className="atlas-form-hint">
            {t(
              "Set where you live in Profile → Edit profile. It becomes the pulsing marker on the map and the NOW anchor on the Timeline."
            )}
          </p>
        </Card>
      ) : null}

      <Card>
        <h3 className="atlas-manage-card__title">{t("Polish your Atlas")}</h3>
        {gaps.length === 0 ? (
          <p className="atlas-form-hint">{t("Nothing missing — every memory has a date, a photo and a story.")}</p>
        ) : (
          <ul className="atlas-gaps">
            {gaps.map((g) => (
              <li key={g.id} className="atlas-gaps__row">
                <div className="atlas-gaps__text">
                  <span className="atlas-gaps__title">
                    {g.title} <span className="atlas-gaps__count">{g.items.length}</span>
                  </span>
                  <span className="atlas-form-hint">{g.why}</span>
                </div>
                <div className="atlas-gaps__items">
                  {g.items.slice(0, 6).map((it) => (
                    <button key={it.key} type="button" className="atlas-gaps__chip" onClick={it.open}>
                      {it.label}
                    </button>
                  ))}
                  {g.items.length > 6 ? <span className="atlas-form-hint">{t("+{n} more", { n: g.items.length - 6 })}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
