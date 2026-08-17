"use client";

import { useEffect, useRef, useState } from "react";
import type { Place, Profile } from "../lib/types";
import { getPlace } from "../lib/domain";
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
}: ProfileDrawerProps) {
  const [manageNote, setManageNote] = useState(false);

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
                onClick={() => setManageNote((v) => !v)}
                aria-expanded={manageNote}
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
              {manageNote ? (
                <p className="atlas-profile__manage-note">
                  Manage Atlas — adding and editing places, visits and wishlist —
                  arrives with local editing in the next phase.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
