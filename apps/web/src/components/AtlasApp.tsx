"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Media, Place, Profile, Season, Settings, Visit, Wishlist } from "../lib/types";
import HeroMap, { type CountryCollection } from "./HeroMap";
import JourneyTimeline from "./JourneyTimeline";
import WhereNext from "./WhereNext";
import PlaceDetailSheet from "./PlaceDetailSheet";
import ProfileDrawer from "./ProfileDrawer";
import { applyTheme, themes } from "../themes";
import type { ThemeId } from "../themes";

// Collapsed "contextual strip" height (PRODUCT_SPEC §18: 80–140px).
const STRIP_HEIGHT = 140;

// One global overlay state (PRODUCT_SPEC §25): Place Detail and Profile are
// mutually exclusive; nothing else can stack on top of them.
type ActiveOverlay =
  | { type: "place"; id: string }
  | { type: "profile" }
  | null;

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export default function AtlasApp() {
  const clipRef = useRef<HTMLDivElement | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [wishlist, setWishlist] = useState<Wishlist[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countriesGeo, setCountriesGeo] = useState<CountryCollection | null>(null);
  const [error, setError] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>("light");
  const [writable, setWritable] = useState(false);

  // Where Next season + global overlay (single overlay state). Initial state
  // matches the server render (no hydration mismatch); the URL is applied once
  // after mount (see url-applied effect below).
  const [season, setSeason] = useState<Season>("summer");
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);
  const [closingOverlay, setClosingOverlay] = useState(false);

  const theme = themes[themeId];

  // --- data load ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, v, w, pr, m, s] = await Promise.all([
          api.getPlaces(),
          api.getVisits(),
          api.getWishlist(),
          api.getProfile(),
          api.getMedia(),
          api.getSettings(),
        ]);
        if (!alive) return;
        setPlaces(p);
        setVisits(v);
        setWishlist(w);
        setProfile(pr);
        setMedia(m);
        setSettings(s);
        if (s.theme === "night" || s.theme === "light") setThemeId(s.theme);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      try {
        const res = await fetch("/geodata/countries.geojson");
        const geo = (await res.json()) as CountryCollection;
        if (alive) setCountriesGeo(geo);
      } catch {
        // country polygons are an optional enhancement
      }
      try {
        const runtime = await api.getRuntime();
        if (alive) setWritable(runtime.writable);
      } catch {
        // writable defaults to false (no Manage Atlas entry)
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- apply theme tokens ---
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // --- scroll-driven map collapse (height + radius written straight to the DOM
  // via rAF so scrolling never re-renders React) ---
  useEffect(() => {
    const update = () => {
      const clip = clipRef.current;
      if (!clip) return;
      const vh = window.innerHeight;
      const sy = window.scrollY;
      const collapseDist = Math.max(vh - STRIP_HEIGHT, 1);
      const progress = clamp(sy / collapseDist, 0, 1);
      const height = Math.max(STRIP_HEIGHT, vh - sy);
      clip.style.height = height + "px";
      const radius = Math.round(progress * 16);
      clip.style.borderBottomLeftRadius = radius + "px";
      clip.style.borderBottomRightRadius = radius + "px";
      clip.classList.toggle("atlas-map-clip--strip", progress > 0.7);
    };
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeId = themeId === "light" ? "night" : "light";
    setThemeId(next);
    const base = settings ?? {};
    api.saveSettings({ ...base, theme: next }).catch(() => {});
  }, [themeId, settings]);

  // --- overlay lifecycle (single source; animated close) ---
  const closeOverlay = useCallback(() => {
    if (!overlay || closingOverlay) return;
    setClosingOverlay(true);
    window.setTimeout(() => {
      setOverlay(null);
      setClosingOverlay(false);
    }, 260);
  }, [overlay, closingOverlay]);

  const openPlace = useCallback((id: string) => setOverlay({ type: "place", id }), []);
  const openProfile = useCallback(() => setOverlay({ type: "profile" }), []);

  // Escape collapses the active overlay (spec: single-page, no stacked overlays).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay]);

  // Lock page scroll while an overlay is open.
  useEffect(() => {
    const locked = overlay != null || closingOverlay;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlay, closingOverlay]);

  // --- URL state (PRODUCT_SPEC §36): /?place=… /?season=… /?profile=true ---
  // Applied after hydration (never on the server render) so the initial client
  // render always matches the pre-rendered HTML.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prof = params.get("profile");
    const p = params.get("place");
    const s = params.get("season");
    if (prof === "true") setOverlay({ type: "profile" });
    else if (p) setOverlay({ type: "place", id: p });
    if (SEASONS.includes(s as Season)) setSeason(s as Season);
  }, []);

  // Keep the URL in sync when state changes (skip the mount commit so it never
  // overwrites the URL before the read above has run).
  const firstPushRef = useRef(true);
  useEffect(() => {
    if (firstPushRef.current) {
      firstPushRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (overlay?.type === "place") url.searchParams.set("place", overlay.id);
    else url.searchParams.delete("place");
    if (overlay?.type === "profile") url.searchParams.set("profile", "true");
    else url.searchParams.delete("profile");
    url.searchParams.set("season", season);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [overlay, season]);

  const profileInitials = (profile?.name?.trim() || "Profile")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const placeOverlayExists =
    overlay?.type !== "place" || places.some((p) => p.id === overlay.id);

  return (
    <>
      <div className="atlas-map-sticky">
        <div ref={clipRef} className="atlas-map-clip">
          <HeroMap
            places={places}
            visits={visits}
            profile={profile}
            countriesGeo={countriesGeo}
            theme={theme}
            media={media}
            overlayOpen={overlay != null || closingOverlay}
            onOpenPlace={openPlace}
          />
        </div>
      </div>

      <main className="atlas-main">
        <JourneyTimeline
          places={places}
          visits={visits}
          wishlist={wishlist}
          profile={profile}
          media={media}
          theme={theme}
          emphasizedSeason={season}
          overlayOpen={overlay != null || closingOverlay}
          onOpenPlace={openPlace}
        />
        <WhereNext
          wishlist={wishlist}
          places={places}
          media={media}
          theme={theme}
          season={season}
          onSeasonChange={setSeason}
          onOpenPlace={openPlace}
        />
      </main>

      <header className="atlas-topbar">
        <div className="atlas-wordmark">Yu&rsquo;s Atlas</div>
        <div className="atlas-topbar__actions">
          <button className="atlas-profile-button" onClick={openProfile} type="button">
            <span className="atlas-profile-button__avatar" aria-hidden="true">
              {profileInitials}
            </span>
            {profile?.name ? <span className="atlas-profile-button__label">{profile.name}</span> : null}
          </button>
          <button className="atlas-theme-toggle" onClick={toggleTheme} type="button">
            {themeId === "light" ? "Night" : "Light"}
          </button>
        </div>
      </header>

      {error ? <div className="atlas-error">{error}</div> : null}

      {overlay?.type === "place" && placeOverlayExists ? (
        <PlaceDetailSheet
          placeId={overlay.id}
          places={places}
          visits={visits}
          wishlist={wishlist}
          profile={profile}
          media={media}
          theme={theme}
          closing={closingOverlay}
          onClose={closeOverlay}
        />
      ) : null}

      {overlay?.type === "profile" ? (
        <ProfileDrawer
          profile={profile}
          places={places}
          theme={theme}
          writable={writable}
          closing={closingOverlay}
          onClose={closeOverlay}
        />
      ) : null}
    </>
  );
}
