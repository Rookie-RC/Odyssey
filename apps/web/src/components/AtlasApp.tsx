"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RuntimeInfo } from "../lib/api";
import type { Media, Place, Profile, Season, Settings, Visit, Wishlist } from "../lib/types";
import { HttpAtlasRepository } from "../lib/repository";
import type { SyncFocus } from "../lib/sync";
import type { TimelineNode } from "../lib/timeline";
import HeroMap, { type CountryCollection } from "./HeroMap";
import JourneyTimeline from "./JourneyTimeline";
import WhereNext from "./WhereNext";
import PlaceDetailSheet from "./PlaceDetailSheet";
import ProfileDrawer from "./ProfileDrawer";
import ManageAtlas from "./manage/ManageAtlas";
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
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [view, setView] = useState<"atlas" | "manage">("atlas");
  // Chronological route layer visibility (v1.2), persisted in Settings.
  const [routesOn, setRoutesOn] = useState(false);

  // Shared contextual focus for Map ↔ Timeline synchronization (v1.3).
  // One state, two views; `source` records which side initiated it so the
  // other side responds without echoing back (feedback-loop guard).
  const [syncFocus, setSyncFocus] = useState<SyncFocus | null>(null);

  // Where Next season + global overlay (single overlay state). Initial state
  // matches the server render (no hydration mismatch); the URL is applied once
  // after mount (see url-applied effect below).
  const [season, setSeason] = useState<Season>("summer");
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);
  const [closingOverlay, setClosingOverlay] = useState(false);

  const theme = themes[themeId];

  // Shared repository used by Manage Atlas and Direct Edit (the Detail Sheet).
  const repo = useMemo(() => new HttpAtlasRepository(), []);

  // --- data load / reload (reload keeps the main Atlas in sync with Manage
  // Atlas edits without a page refresh) ---
  const loadData = useCallback(async () => {
    try {
      const [p, v, w, pr, m, s] = await Promise.all([
        api.getPlaces(),
        api.getVisits(),
        api.getWishlist(),
        api.getProfile(),
        api.getMedia(),
        api.getSettings(),
      ]);
      setPlaces(p);
      setVisits(v);
      setWishlist(w);
      setProfile(pr);
      setMedia(m);
      setSettings(s);
      if (s.theme === "night" || s.theme === "light") setThemeId(s.theme);
      setRoutesOn(s.showRoutes ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
        setRoutesOn(s.showRoutes ?? false);
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
        const rt = await api.getRuntime();
        if (alive) {
          setWritable(rt.writable);
          setRuntime(rt);
        }
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
      // Drives the "Scroll to explore" hint's fade-out (globals.css) — written
      // as a CSS var rather than React state so scrolling never re-renders.
      document.documentElement.style.setProperty("--hero-scroll", String(progress));
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

  // Chronological route layer toggle (v1.2). Persisted through the existing
  // local settings system — no new persistence mechanism.
  const toggleRoutes = useCallback(() => {
    const next = !routesOn;
    setRoutesOn(next);
    const base = settings ?? {};
    api.saveSettings({ ...base, showRoutes: next }).catch(() => {});
  }, [routesOn, settings]);

  // --- overlay lifecycle (single source; animated close) ---
  const closeOverlay = useCallback(() => {
    if (!overlay || closingOverlay) return;
    setClosingOverlay(true);
    window.setTimeout(() => {
      setOverlay(null);
      setClosingOverlay(false);
    }, 260);
  }, [overlay, closingOverlay]);

  // An overlay supersedes contextual focus: opening the Detail Sheet or the
  // Profile drawer clears the Map ↔ Timeline selection.
  const openPlace = useCallback((id: string) => {
    setSyncFocus(null);
    setOverlay({ type: "place", id });
  }, []);
  const openProfile = useCallback(() => {
    setSyncFocus(null);
    setOverlay({ type: "profile" });
  }, []);

  // --- Map ↔ Timeline synchronization (v1.3) ---
  // Multiple-Visit rule (documented): when a Place has several Visits, the
  // focused Visit is
  //   1. the Visit already in context, when it belongs to this Place
  //      (the selection persists rather than silently switching);
  //   2. otherwise the current-base Visit when the Place is the current base
  //      (that Visit is the Timeline's NOW anchor — the "living here" node);
  //   3. otherwise the most recent Visit by date (start date, else end date),
  //      tie-broken by stable id.
  // If no Visit resolves, there is nothing to synchronize (returns null).
  const resolveVisitId = useCallback(
    (placeId: string, inContext?: string): string | undefined => {
      const candidates = visits.filter((v) => v.placeId === placeId);
      if (candidates.length === 0) return undefined;
      if (inContext && candidates.some((v) => v.id === inContext)) return inContext;
      const currentId = profile?.currentBase?.placeId ?? null;
      if (currentId === placeId) {
        const base = candidates.find((v) => v.visitType === "lived") ?? candidates[0];
        return base.id;
      }
      return [...candidates].sort(
        (a, b) =>
          (b.startDate ?? b.endDate ?? "").localeCompare(a.startDate ?? a.endDate ?? "") ||
          a.id.localeCompare(b.id)
      )[0].id;
    },
    [visits, profile]
  );

  // Timeline → Map: a Timeline node was clicked/selected. The map responds by
  // emphasizing the Place's marker (and camera only when needed).
  const handleTimelineSelect = useCallback((node: TimelineNode) => {
    setSyncFocus({
      placeId: node.place.id,
      nodeId: node.id,
      visitId: node.visitId,
      source: "timeline",
    });
  }, []);

  // Map → Timeline: a map marker was clicked/selected. Resolve the relevant
  // Visit (multiple-Visit rule above), then the Timeline responds by bringing
  // that node into view.
  const handleMapFocus = useCallback(
    (placeId: string) => {
      setSyncFocus((prev) => {
        const inContext = prev?.placeId === placeId ? prev.visitId : undefined;
        const visitId = resolveVisitId(placeId, inContext);
        if (!visitId) return null;
        return { placeId, nodeId: "visit:" + visitId, visitId, source: "map" };
      });
    },
    [resolveVisitId]
  );

  // Stable handler (map background click clears the selection). Kept in a
  // useCallback so HeroMap's map-creation effect never re-runs from a new
  // inline identity.
  const clearSyncFocus = useCallback(() => setSyncFocus(null), []);

  // Escape collapses the active overlay (spec: single-page, no stacked overlays).
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay]);

  // Lock page scroll while an overlay or Manage Atlas is open.
  useEffect(() => {
    const locked = overlay != null || closingOverlay || view === "manage";
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlay, closingOverlay, view]);

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

  // Fallback matches ProfileDrawer's own "Traveler" default, so an unnamed
  // profile doesn't show one initial in the topbar and a different name in
  // the drawer it opens.
  const profileInitials = (profile?.name?.trim() || "Traveler")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const placeOverlayExists =
    overlay?.type !== "place" || places.some((p) => p.id === overlay.id);

  const defaultMapPosition = settings?.defaultMapPosition
    ? ([settings.defaultMapPosition.lng, settings.defaultMapPosition.lat] as [number, number])
    : null;

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
            routesOn={routesOn}
            onToggleRoutes={toggleRoutes}
            focus={syncFocus}
            onFocusPlace={handleMapFocus}
            onClearFocus={clearSyncFocus}
            onOpenPlace={openPlace}
            initialCenter={defaultMapPosition}
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
          focus={syncFocus}
          onSelectNode={handleTimelineSelect}
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
          key={overlay.id}
          placeId={overlay.id}
          places={places}
          visits={visits}
          wishlist={wishlist}
          profile={profile}
          media={media}
          theme={theme}
          closing={closingOverlay}
          writable={writable}
          repo={repo}
          onSaved={loadData}
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
          onManage={() => {
            closeOverlay();
            setView("manage");
          }}
          onProfileSaved={loadData}
        />
      ) : null}

      {view === "manage" ? (
        <ManageAtlas
          places={places}
          visits={visits}
          wishlist={wishlist}
          media={media}
          profile={profile}
          settings={settings}
          theme={theme}
          runtime={runtime}
          onReload={loadData}
          onExit={() => setView("atlas")}
          onToggleTheme={toggleTheme}
        />
      ) : null}
    </>
  );
}
