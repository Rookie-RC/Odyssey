"use client";

import { useEffect, useRef, useState } from "react";
import type { Place, Profile } from "../lib/types";
import { getPlace } from "../lib/domain";
import { api } from "../lib/api";
import type { AtlasTheme } from "../themes";

interface ProfileDrawerProps {
  profile: Profile | null;
  places: Place[];
  theme: AtlasTheme;
  /** Runtime reports whether local editing is available (PRODUCT_SPEC §25:
   * Manage Atlas entry appears "when local editing is available"). */
  writable: boolean;
  /** True while the parent is animating the overlay away. */
  closing: boolean;
  onClose: () => void;
  /** Opens Manage Atlas (writable mode only). */
  onManage: () => void;
  /** Called after profile changes are persisted so the app can reload. */
  onProfileSaved: () => void;
}

interface LinkRow {
  label: string;
  url: string;
}

/** Right-side drawer, visually subordinate to the Atlas. Profile and Place
 * Detail never stack — the caller keeps a single global overlay state. Escape
 * and backdrop click are handled by the parent overlay lifecycle. */
export default function ProfileDrawer({
  profile,
  places,
  theme,
  writable,
  closing,
  onClose,
  onManage,
  onProfileSaved,
}: ProfileDrawerProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Draft state (initialized lazily from profile when entering edit mode).
  const [draft, setDraft] = useState<{
    name: string;
    bio: string;
    interests: string;
    links: LinkRow[];
    currentBaseId: string;
  } | null>(null);

  // Move focus into the drawer on open and restore it on close (keyboard use).
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      prev?.focus?.();
    };
  }, []);

  const name = profile?.name?.trim() || "Traveler";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const basePlace = profile?.currentBase?.placeId
    ? getPlace(places, profile.currentBase.placeId)
    : null;

  const startEdit = () => {
    setDraft({
      name: profile?.name ?? "",
      bio: profile?.bio ?? "",
      interests: (profile?.interests ?? []).join(", "),
      links: (profile?.links ?? []).map((l) => ({ label: l.label, url: l.url })),
      currentBaseId: profile?.currentBase?.placeId ?? "",
    });
    setEditing(true);
    setMessage("");
  };

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
      if (draft.currentBaseId) next.currentBase = { placeId: draft.currentBaseId };
      await api.saveProfile(next);
      setEditing(false);
      setMessage("Profile saved.");
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
      <aside
        className={"atlas-profile-drawer" + (closing ? " atlas-profile-drawer--closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          ref={closeBtnRef}
          type="button"
          className="atlas-sheet__close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <div className="atlas-profile__scroll">
          <div className="atlas-profile__identity">
            {profile?.avatar ? (
              <img className="atlas-profile__avatar" src={profile.avatar} alt="" draggable={false} />
            ) : (
              <div
                className="atlas-profile__avatar atlas-profile__avatar--initials"
                style={{ background: theme.markers.current }}
                aria-hidden="true"
              >
                {initials}
              </div>
            )}
            <div className="atlas-profile__identity-text">
              <div className="atlas-profile__name">{name}</div>
              {basePlace ? (
                <div className="atlas-profile__base">Based in {basePlace.name}</div>
              ) : null}
            </div>
          </div>

          {!editing ? (
            <>
              {profile?.bio ? <p className="atlas-profile__bio">{profile.bio}</p> : null}

              {profile?.interests && profile.interests.length > 0 ? (
                <section className="atlas-profile__block">
                  <h3 className="atlas-profile__label">Interests</h3>
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
                  <h3 className="atlas-profile__label">Links</h3>
                  <ul className="atlas-profile__links">
                    {profile.links.map((l, i) => (
                      <li key={i}>
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.label}
                          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                            <path
                              d="M6 3h7v7M13 3 6.5 9.5M9.5 13H3V6.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {writable ? (
                <div className="atlas-profile__manage">
                  <button
                    type="button"
                    className="atlas-profile__manage-btn"
                    onClick={onManage}
                  >
                    Manage Atlas
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path
                        d="M2 8h11M9 3.5 13.5 8 9 12.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <ProfileEditForm
              draft={draft!}
              onChange={setDraft}
              places={places}
              saving={saving}
              onSave={saveProfile}
              onCancel={() => {
                setEditing(false);
                setMessage("");
              }}
            />
          )}

          {message ? <p className="atlas-profile__message">{message}</p> : null}

          {!editing ? (
            <button type="button" className="atlas-profile__edit-btn" onClick={startEdit}>
              Edit profile
            </button>
          ) : null}
        </div>
      </aside>
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
}: {
  draft: { name: string; bio: string; interests: string; links: LinkRow[]; currentBaseId: string };
  onChange: (d: typeof draft) => void;
  places: Place[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch });
  const setLink = (i: number, patch: Partial<LinkRow>) => {
    const links = draft.links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    set({ links });
  };
  return (
    <div className="atlas-profile__edit">
      <label className="atlas-form-field">
        <span className="atlas-form-label">Name</span>
        <input
          className="atlas-form-input"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="atlas-form-field">
        <span className="atlas-form-label">Current base</span>
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
        <span className="atlas-form-label">Bio</span>
        <textarea
          className="atlas-form-input"
          rows={3}
          value={draft.bio}
          onChange={(e) => set({ bio: e.target.value })}
        />
      </label>
      <label className="atlas-form-field">
        <span className="atlas-form-label">Interests (comma separated)</span>
        <input
          className="atlas-form-input"
          value={draft.interests}
          onChange={(e) => set({ interests: e.target.value })}
        />
      </label>
      <div className="atlas-form-field">
        <span className="atlas-form-label">Links</span>
        {draft.links.map((l, i) => (
          <div key={i} className="atlas-profile__link-row">
            <input
              className="atlas-form-input"
              placeholder="Label"
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
              onClick={() => set({ links: draft.links.filter((_, idx) => idx !== i) })}
              aria-label="Remove link"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          className="atlas-form-add-btn"
          onClick={() => set({ links: [...draft.links, { label: "", url: "" }] })}
        >
          + Add link
        </button>
      </div>
      <div className="atlas-profile__edit-actions">
        <button type="button" className="atlas-btn atlas-btn--primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
        <button type="button" className="atlas-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
