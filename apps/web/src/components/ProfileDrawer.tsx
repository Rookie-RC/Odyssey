"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Flag from "./Flag";
import type { Place, Profile, Visit, Wishlist } from "../lib/types";
import { atlasFacts, atlasFactsLine, formatDateRange, getPlace, visitTypeLabel } from "../lib/domain";
import { api, mediaSrc } from "../lib/api";
import type { AtlasTheme, ThemePreference } from "../themes";
import ThemePicker from "./ThemePicker";
import LanguagePicker from "./LanguagePicker";
import { t, type LocalePreference } from "../lib/i18n";
import { profileInitials } from "./Topbar";
import { ArrowRight, CloseIcon, ExternalIcon, HomeIcon, ImageIcon, SettingsIcon, TicketIcon } from "./Icons";

interface ProfileDrawerProps {
  profile: Profile | null;
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  theme: AtlasTheme;
  themePreference: ThemePreference;
  onThemeChange: (pref: ThemePreference) => void;
  localePreference: LocalePreference;
  onLocaleChange: (pref: LocalePreference) => void;
  /** Runtime reports whether local editing is available (PRODUCT_SPEC §25). */
  writable: boolean;
  closing: boolean;
  onClose: () => void;
  onManage: () => void;
  /** Share as a ticket: the whole journey, or one country (its flag). */
  onShare?: (scope: "journey" | "country", country?: string) => void;
  onProfileSaved: () => void;
  onOpenPlace: (placeId: string) => void;
}

interface LinkRow {
  label: string;
  url: string;
}

interface Draft {
  name: string;
  bio: string;
  interests: string;
  links: LinkRow[];
  currentBaseId: string;
  avatar: string;
}

/** Right-side drawer, visually subordinate to the Atlas (VISUAL_SPEC §14).
 * Profile and Place Detail never stack. */
export default function ProfileDrawer({
  profile,
  places,
  visits,
  wishlist,
  theme,
  themePreference,
  onThemeChange,
  localePreference,
  onLocaleChange,
  writable,
  closing,
  onClose,
  onManage,
  onShare,
  onProfileSaved,
  onOpenPlace,
}: ProfileDrawerProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const name = profile?.name?.trim() || t("Traveler");
  const basePlace = profile?.currentBase?.placeId ? getPlace(places, profile.currentBase.placeId) : null;

  // A quiet colophon, not a scorecard (VISUAL_SPEC §29): when the atlas
  // begins, how many places and countries it holds, how many wishes wait.
  const glance = useMemo(() => atlasFacts(places, visits, wishlist), [places, visits, wishlist]);

  const recent = useMemo(() => {
    const byId = new Map(places.map((p) => [p.id, p]));
    return [...visits]
      .filter((v) => v.startDate && byId.has(v.placeId) && v.placeId !== profile?.currentBase?.placeId)
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))
      .slice(0, 3)
      .map((v) => ({ visit: v, place: byId.get(v.placeId)! }));
  }, [visits, places, profile]);

  const initialDraftRef = useRef("");
  const startEdit = () => {
    const d: Draft = {
      name: profile?.name ?? "",
      bio: profile?.bio ?? "",
      interests: (profile?.interests ?? []).join(", "),
      links: (profile?.links ?? []).map((l) => ({ label: l.label, url: l.url })),
      currentBaseId: profile?.currentBase?.placeId ?? "",
      avatar: profile?.avatar ?? "",
    };
    initialDraftRef.current = JSON.stringify(d);
    setDraft(d);
    setEditing(true);
    setMessage("");
  };

  // While editing, Escape leaves the form (the drawer stays open); with unsaved
  // changes it keeps them and asks to save or cancel instead.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (draft && JSON.stringify(draft) !== initialDraftRef.current) {
        setMessage(t("You have unsaved changes — save or cancel them first."));
        return;
      }
      setEditing(false);
      setMessage("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, draft]);

  const saveProfile = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage("");
    try {
      const links = draft.links
        .filter((l) => l.label.trim() || l.url.trim())
        .map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim() }));
      const next: Profile = {
        name: draft.name.trim() || "Traveler",
        bio: draft.bio.trim(),
        interests: draft.interests
          .split(",")
          .map((i) => i.trim())
          .filter(Boolean),
        links,
      };
      if (draft.avatar) next.avatar = draft.avatar;
      if (draft.currentBaseId) next.currentBase = { placeId: draft.currentBaseId };
      await api.saveProfile(next);
      setEditing(false);
      setMessage(t("Profile saved."));
      onProfileSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={"atlas-overlay" + (closing ? " atlas-overlay--closing" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={shellRef}
        tabIndex={-1}
        className={"atlas-sheet atlas-profile" + (closing ? " atlas-sheet--closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={t("Profile")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="atlas-sheet__grabber" aria-hidden="true" />
        <div className="atlas-sheet__toolbar">
          <span className="atlas-eyebrow atlas-profile__eyebrow">{t("Profile")}</span>
          <button
            ref={closeBtnRef}
            type="button"
            className="atlas-icon-btn atlas-icon-btn--sm"
            onClick={onClose}
            aria-label={t("Close")}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="atlas-sheet__scroll atlas-profile__scroll">
          <div className="atlas-profile__identity">
            {(editing ? draft?.avatar : profile?.avatar) ? (
              <img
                className="atlas-profile__avatar atlas-photo"
                src={editing ? draft!.avatar : profile!.avatar}
                alt=""
                draggable={false}
              />
            ) : (
              <div className="atlas-profile__avatar atlas-profile__avatar--initials" aria-hidden="true">
                {profileInitials(profile?.name)}
              </div>
            )}
            <div className="atlas-profile__who">
              <h2 className="atlas-profile__name atlas-break">{name}</h2>
              {basePlace ? (
                <button type="button" className="atlas-profile__base" onClick={() => onOpenPlace(basePlace.id)}>
                  <HomeIcon size={14} /> {t("Based in {place}, {country}", { place: basePlace.name, country: basePlace.country })}
                </button>
              ) : null}
            </div>
          </div>

          {!editing ? (
            <>
              {profile?.bio ? <p className="atlas-profile__bio">{profile.bio}</p> : null}

              {glance.places > 0 ? (
                <p className="atlas-profile__glance">{atlasFactsLine(glance)}</p>
              ) : null}

              {glance.countries.length > 0 ? (
                <div className="atlas-profile__flags" aria-label={t("Countries visited")}>
                  {glance.countries.map((cc) => {
                    const name = places.find((p) => p.countryCode === cc)?.country ?? cc;
                    return onShare ? (
                      <button
                        key={cc}
                        type="button"
                        className="atlas-profile__flag-btn"
                        onClick={() => onShare("country", cc)}
                        aria-label={t("Share {country} as a ticket", { country: name })}
                        title={t("Share {country} as a ticket", { country: name })}
                      >
                        <Flag code={cc} size={16} />
                      </button>
                    ) : (
                      <Flag key={cc} code={cc} size={16} title={name} />
                    );
                  })}
                </div>
              ) : null}

              {recent.length > 0 ? (
                <section className="atlas-profile__block">
                  <h3 className="atlas-profile__label">{t("Recent memories")}</h3>
                  <ul className="atlas-profile__recent">
                    {recent.map(({ visit, place }) => (
                      <li key={visit.id}>
                        <button type="button" onClick={() => onOpenPlace(place.id)}>
                          <span className="atlas-profile__recent-name">{place.name}</span>
                          <span className="atlas-profile__recent-meta">
                            <span className="atlas-date">{formatDateRange(visit.startDate, visit.endDate)}</span> ·{" "}
                            {visitTypeLabel(visit.visitType)}
                          </span>
                          <ArrowRight size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {profile?.interests && profile.interests.length > 0 ? (
                <section className="atlas-profile__block">
                  <h3 className="atlas-profile__label">{t("Interests")}</h3>
                  <div className="atlas-profile__interests">
                    {profile.interests.map((i) => (
                      <span key={i} className="atlas-profile__tag">
                        {i}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {profile?.links && profile.links.length > 0 ? (
                <section className="atlas-profile__block">
                  <h3 className="atlas-profile__label">{t("Links")}</h3>
                  <ul className="atlas-profile__links">
                    {profile.links.map((l, i) => (
                      <li key={i}>
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.label}
                          <ExternalIcon size={12} />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="atlas-profile__block">
                <h3 className="atlas-profile__label">
                  {t("Theme · {name}", {
                    name: themePreference === "auto" ? t("Auto ({theme})", { theme: t(theme.label) }) : t(theme.label),
                  })}
                </h3>
                <ThemePicker
                  variant="inline"
                  preference={themePreference}
                  active={theme}
                  onChange={onThemeChange}
                  className="atlas-profile__themes"
                />
              </section>

              <section className="atlas-profile__block">
                <h3 className="atlas-profile__label">{t("Language")}</h3>
                <LanguagePicker value={localePreference} onChange={onLocaleChange} />
              </section>

              {onShare && glance.places > 0 ? (
                <button type="button" className="atlas-btn atlas-profile__share" onClick={() => onShare("journey")}>
                  <TicketIcon size={15} /> {t("Share my journey")}
                </button>
              ) : null}

              <div className="atlas-profile__footer">
                {writable ? (
                  <>
                    <button type="button" className="atlas-btn" onClick={startEdit}>
                      {t("Edit profile")}
                    </button>
                    <button type="button" className="atlas-btn atlas-btn--primary" onClick={onManage}>
                      <SettingsIcon size={14} /> {t("Manage Atlas")}
                    </button>
                  </>
                ) : (
                  <p className="atlas-profile__readonly">{t("This atlas is shared read-only.")}</p>
                )}
              </div>
            </>
          ) : (
            <ProfileEditForm
              draft={draft!}
              onChange={(update) => setDraft((d) => (d ? update(d) : d))}
              places={places}
              saving={saving}
              onSave={saveProfile}
              onCancel={() => {
                setEditing(false);
                setMessage("");
              }}
              onMessage={setMessage}
            />
          )}

          {message ? <p className="atlas-profile__message">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ProfileEditForm({
  draft,
  onChange,
  places,
  saving,
  onSave,
  onCancel,
  onMessage,
}: {
  draft: Draft;
  /** Functional updates: an avatar upload finishing must not undo what was typed meanwhile. */
  onChange: (update: (d: Draft) => Draft) => void;
  places: Place[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onMessage: (m: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const set = (patch: Partial<Draft>) => onChange((d) => ({ ...d, ...patch }));
  const setLink = (i: number, patch: Partial<LinkRow>) => {
    onChange((d) => ({ ...d, links: d.links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  };

  const uploadAvatar = async (file: File) => {
    setUploading(true);
    try {
      const m = await api.uploadMedia({ file, caption: t("Profile photo") });
      set({ avatar: mediaSrc(m, 320) });
    } catch (e) {
      onMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="atlas-profile__edit" data-owns-keyboard>
      <div className="atlas-form-field">
        <span className="atlas-form-label">{t("Photo")}</span>
        <div className="atlas-profile__avatar-row">
          <button type="button" className="atlas-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <ImageIcon size={14} /> {uploading ? t("Uploading…") : draft.avatar ? t("Replace photo") : t("Upload photo")}
          </button>
          {draft.avatar ? (
            <button type="button" className="atlas-btn" onClick={() => set({ avatar: "" })}>
              {t("Remove")}
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAvatar(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <label className="atlas-form-field">
        <span className="atlas-form-label">{t("Name")}</span>
        <input className="atlas-form-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="atlas-form-field">
        <span className="atlas-form-label">{t("Current base")}</span>
        <select
          className="atlas-form-input"
          value={draft.currentBaseId}
          onChange={(e) => set({ currentBaseId: e.target.value })}
        >
          <option value="">—</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {p.country}
            </option>
          ))}
        </select>
      </label>
      <label className="atlas-form-field">
        <span className="atlas-form-label">{t("Bio")}</span>
        <textarea className="atlas-form-input" rows={3} value={draft.bio} onChange={(e) => set({ bio: e.target.value })} />
      </label>
      <label className="atlas-form-field">
        <span className="atlas-form-label">{t("Interests (comma separated)")}</span>
        <input className="atlas-form-input" value={draft.interests} onChange={(e) => set({ interests: e.target.value })} />
      </label>
      <div className="atlas-form-field">
        <span className="atlas-form-label">{t("Links")}</span>
        {draft.links.map((l, i) => (
          <div key={i} className="atlas-profile__link-row">
            <input
              className="atlas-form-input"
              placeholder={t("Label")}
              value={l.label}
              onChange={(e) => setLink(i, { label: e.target.value })}
            />
            <input
              className="atlas-form-input"
              placeholder="https://…"
              value={l.url}
              onChange={(e) => setLink(i, { url: e.target.value })}
            />
            <button
              type="button"
              className="atlas-form-icon-btn"
              onClick={() => onChange((d) => ({ ...d, links: d.links.filter((_, idx) => idx !== i) }))}
              aria-label={t("Remove link")}
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          className="atlas-form-add-btn"
          onClick={() => onChange((d) => ({ ...d, links: [...d.links, { label: "", url: "" }] }))}
        >
          {t("+ Add link")}
        </button>
      </div>
      <div className="atlas-profile__edit-actions">
        <button type="button" className="atlas-btn atlas-btn--primary" onClick={onSave} disabled={saving || uploading}>
          {saving ? t("Saving…") : t("Save profile")}
        </button>
        <button type="button" className="atlas-btn" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
