"use client";

// Share as a ticket (lib/share.ts → lib/ticket.ts): one trip as a boarding
// pass, a country as a multi-city pass, the whole journey as an atlas pass —
// in the active theme. The image is drawn locally; it leaves the machine only
// through what the person does with it (download, copy, the system share).
import { useEffect, useMemo, useRef, useState } from "react";
import type { AtlasTheme } from "../themes";
import type { Media, Place, Profile, Visit, Wishlist } from "../lib/types";
import {
  countryTicket,
  journeyTicket,
  sharableCountries,
  sharableTrips,
  tripTicket,
  type ShareScope,
  type Ticket,
} from "../lib/share";
import { renderTicket, type CountryShapes } from "../lib/ticket";
import { downloadBlob } from "../lib/poster";
import { formatMonthYear, visitTypeLabel } from "../lib/timeline";
import { t, tn, useLocale } from "../lib/i18n";
import { Btn, Select } from "./manage/FormUI";
import { CloseIcon, CopyIcon, DownloadIcon, ShareIcon } from "./Icons";

export interface ShareRequest {
  scope: ShareScope;
  visitId?: string;
  country?: string;
}

interface ShareDialogProps {
  request: ShareRequest;
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  media: Media[];
  theme: AtlasTheme;
  wordmark: string;
  countries: CountryShapes | null;
  onClose: () => void;
  onNotice: (message: string) => void;
}

const SCOPES: { id: ShareScope; label: () => string }[] = [
  { id: "trip", label: () => t("A trip") },
  { id: "country", label: () => t("A country") },
  { id: "journey", label: () => t("Whole journey") },
];

function canCopyImages(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

function canShareFiles(): boolean {
  try {
    const probe = new File([new Blob()], "ticket.png", { type: "image/png" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export default function ShareDialog({
  request,
  places,
  visits,
  wishlist,
  profile,
  media,
  theme,
  wordmark,
  countries,
  onClose,
  onNotice,
}: ShareDialogProps) {
  const locale = useLocale();
  const trips = useMemo(() => sharableTrips(places, visits), [places, visits]);
  const countryList = useMemo(() => sharableCountries(places, visits), [places, visits]);

  const [scope, setScope] = useState<ShareScope>(request.scope);
  const [visitId, setVisitId] = useState(request.visitId ?? trips[0]?.visit.id ?? "");
  const [country, setCountry] = useState(
    (request.country ?? "").toUpperCase() || countryList[0]?.code || ""
  );
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copyOk] = useState(canCopyImages);
  const [shareOk] = useState(canShareFiles);

  const ticket: Ticket | null = useMemo(() => {
    const records = { places, visits, wishlist, profile, media };
    if (scope === "trip") return tripTicket(visitId, records);
    if (scope === "country") return countryTicket(country, records);
    return journeyTicket(records);
    // locale: labels inside are formatted when drawn, but keep the memo honest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, visitId, country, places, visits, wishlist, profile, media, locale]);

  // Draw the ticket whenever what it shows (or how it looks) changes.
  useEffect(() => {
    if (!ticket) {
      setBusy(false);
      setBlob(null);
      return;
    }
    let alive = true;
    setBusy(true);
    setFailed(false);
    renderTicket(ticket, { theme, wordmark, passenger: profile?.name?.trim() ?? "", countries })
      .then((b) => {
        if (!alive) return;
        setBlob(b);
        setBusy(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [ticket, theme, wordmark, profile, countries, locale]);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  // Focus in, Escape out (capture: the sheet beneath must not close too).
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  const fileName = useMemo(() => {
    const base = wordmark.replace(/[\\/:*?"<>|’']/g, "").replace(/\s+/g, "-");
    const what =
      ticket?.kind === "trip"
        ? ticket.leg.place.name
        : ticket?.kind === "country"
          ? ticket.country
          : "journey";
    return (base + "-" + what.replace(/[\\/:*?"<>|’'\s]+/g, "-") + ".png").replace(/-+/g, "-");
  }, [ticket, wordmark]);

  const download = () => {
    if (!blob) return;
    downloadBlob(blob, fileName);
    onNotice(t("Image saved"));
  };
  const copy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      onNotice(t("Image copied"));
    } catch {
      onNotice(t("Could not copy the image"));
    }
  };
  const share = async () => {
    if (!blob) return;
    try {
      await navigator.share({ files: [new File([blob], fileName, { type: "image/png" })], title: wordmark });
    } catch {
      // dismissed, or the system declined: nothing to report
    }
  };

  const altText =
    ticket?.kind === "trip"
      ? t("Ticket for {place}", { place: ticket.leg.place.name })
      : ticket?.kind === "country"
        ? t("Ticket for {place}", { place: ticket.country })
        : t("Atlas pass");

  return (
    <div
      className="atlas-dialog-backdrop atlas-share-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="atlas-dialog atlas-share" data-owns-keyboard role="dialog" aria-modal="true" aria-label={t("Share")}>
        <div className="atlas-dialog__head">
          <h2 className="atlas-display">{t("Share as a ticket")}</h2>
          <button ref={closeRef} type="button" className="atlas-icon-btn atlas-icon-btn--sm" onClick={onClose} aria-label={t("Close")}>
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="atlas-share__controls">
          <div className="atlas-segmented" role="radiogroup" aria-label={t("What to share")}>
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={scope === s.id}
                className={"atlas-segmented__item" + (scope === s.id ? " is-active" : "")}
                onClick={() => setScope(s.id)}
                disabled={(s.id === "trip" && trips.length === 0) || (s.id === "country" && countryList.length === 0)}
              >
                {s.label()}
              </button>
            ))}
          </div>
          {scope === "trip" ? (
            <Select aria-label={t("Trip")} value={visitId} onChange={(e) => setVisitId(e.target.value)}>
              {trips.map(({ visit, place }) => (
                <option key={visit.id} value={visit.id}>
                  {place.name} · {visit.startDate ? formatMonthYear(visit.startDate) : t("Earlier")} ·{" "}
                  {visitTypeLabel(visit.visitType)}
                </option>
              ))}
            </Select>
          ) : scope === "country" ? (
            <Select aria-label={t("Country")} value={country} onChange={(e) => setCountry(e.target.value)}>
              {countryList.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} · {tn(c.places, "{n} place", "{n} places")}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        <div className={"atlas-share__preview" + (busy ? " is-busy" : "")} aria-busy={busy}>
          {url ? <img src={url} alt={altText} /> : null}
          {busy && !url ? <p className="atlas-share__note">{t("Drawing the ticket…")}</p> : null}
          {failed ? <p className="atlas-share__note">{t("The ticket could not be drawn.")}</p> : null}
          {!ticket && !busy ? <p className="atlas-share__note">{t("Nothing to share yet.")}</p> : null}
        </div>

        <div className="atlas-share__actions">
          <span className="atlas-share__hint">{t("Drawn on this computer, in your theme.")}</span>
          {copyOk ? (
            <Btn onClick={copy} disabled={!blob || busy}>
              <CopyIcon size={15} /> {t("Copy image")}
            </Btn>
          ) : null}
          {shareOk ? (
            <Btn onClick={share} disabled={!blob || busy}>
              <ShareIcon size={15} /> {t("Share…")}
            </Btn>
          ) : null}
          <Btn kind="primary" onClick={download} disabled={!blob || busy}>
            <DownloadIcon size={15} /> {t("Download")}
          </Btn>
        </div>
      </div>
    </div>
  );
}
