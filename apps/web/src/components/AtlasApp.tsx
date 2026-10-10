"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RuntimeInfo } from "../lib/api";
import type { Media, Place, Profile, Season, Settings, Visit, Wishlist } from "../lib/types";
import { HttpAtlasRepository } from "../lib/repository";
import type { SyncFocus } from "../lib/sync";
import type { TimelineNode } from "../lib/timeline";
import { seasonFromMonth } from "../lib/timeline";
import { atlasWordmark } from "../lib/domain";
import {
  LocaleContext,
  parseLocalePreference,
  resolveLocale,
  setLocale,
  t,
  type LocalePreference,
} from "../lib/i18n";
import HeroMap, { type CountryCollection, type MapLayers } from "./HeroMap";
import JourneyTimeline from "./JourneyTimeline";
import WhereNext from "./WhereNext";
import PlaceDetailSheet from "./PlaceDetailSheet";
import ProfilePage from "./ProfilePage";
import TabBar, { TABS, type AtlasTab } from "./TabBar";
import IdeasBoard from "./IdeasBoard";
import SearchPanel from "./SearchPanel";
import ShareDialog, { type ShareRequest } from "./ShareDialog";
import Topbar from "./Topbar";
import ManageAtlas from "./manage/ManageAtlas";
import { HeartIcon } from "./Icons";
import {
  applyTheme,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "../themes";

// One global overlay state (PRODUCT_SPEC §25): Place Detail and the Ideas
// board are mutually exclusive; nothing stacks on top of them.
type ActiveOverlay = { type: "place"; id: string } | { type: "ideas"; season?: Season } | null;

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

export default function AtlasApp() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [wishlist, setWishlist] = useState<Wishlist[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countriesGeo, setCountriesGeo] = useState<CountryCollection | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [writable, setWritable] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [view, setView] = useState<"atlas" | "manage">("atlas");
  // The section shown under the tab bar. The map stays mounted underneath
  // the others, so its camera and markers survive a tab switch.
  const [tab, setTab] = useState<AtlasTab>("map");
  const [manageAdd, setManageAdd] = useState<"visit" | "wishlist" | null>(null);
  const openManage = useCallback((add: "visit" | "wishlist" | null = null) => {
    setManageAdd(add);
    setView("manage");
  }, []);

  // Theme preference (Auto follows the OS) and the resolved theme.
  const [themePref, setThemePref] = useState<ThemePreference>("light");
  const [systemDark, setSystemDark] = useState(false);
  const theme = useMemo(() => resolveTheme(themePref, systemDark), [themePref, systemDark]);

  // Interface language (Auto follows the browser/OS language).
  const [localePref, setLocalePref] = useState<LocalePreference>("auto");
  const [browserLang, setBrowserLang] = useState("en");
  const locale = resolveLocale(localePref, browserLang);
  // Module-level locale for the pure domain formatters; set before children
  // render so every label in this pass uses the same language.
  setLocale(locale);

  // Optional Hero Map layers, persisted through Settings.
  const [layers, setLayers] = useState<MapLayers>({ routes: false, wishlist: true, countries: true });

  // Shared contextual focus for Map ↔ Timeline synchronization (v1.3).
  const [syncFocus, setSyncFocus] = useState<SyncFocus | null>(null);

  // Where Next season (defaults to the coming season) + global overlay.
  const [season, setSeason] = useState<Season>("summer");
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);
  const [closingOverlay, setClosingOverlay] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Share as a ticket (a trip, a country, the whole journey).
  const [share, setShare] = useState<ShareRequest | null>(null);
  const closeShare = useCallback(() => setShare(null), []);
  const [flyTo, setFlyTo] = useState<{ placeId: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Shared repository used by Manage Atlas and Direct Edit (the Detail Sheet).
  const repo = useMemo(() => new HttpAtlasRepository(), []);

  // Latest settings for incremental saves: every change merges into what was
  // last persisted, so toggling routes and then switching theme can never
  // overwrite one another with a stale copy. The server replaces the whole
  // object, so nothing is written until the stored Settings have arrived:
  // earlier choices apply locally and are queued, then merged and saved.
  const settingsRef = useRef<Settings>({});
  const settingsLoadedRef = useRef(false);
  const pendingSettingsRef = useRef<Partial<Settings>>({});
  const saveSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (!settingsLoadedRef.current) {
      pendingSettingsRef.current = { ...pendingSettingsRef.current, ...patch };
      return;
    }
    api.saveSettings(next).catch(() => {
      // a read-only runtime cannot persist; the choice still applies locally
    });
  }, []);

  const applySettings = useCallback((stored: Settings) => {
    // A choice made while loading wins over the stored value, then persists.
    const pending = pendingSettingsRef.current;
    pendingSettingsRef.current = {};
    const s = { ...stored, ...pending };
    settingsLoadedRef.current = true;
    if (Object.keys(pending).length > 0) api.saveSettings(s).catch(() => {});
    settingsRef.current = s;
    setSettings(s);
    setThemePref(parseThemePreference(s.theme));
    setLocalePref(parseLocalePreference(s.language));
    setLayers({
      routes: s.showRoutes ?? false,
      wishlist: s.showWishlist ?? true,
      countries: !(s.hideCountries ?? false),
    });
  }, []);

  // --- data load / reload (reload keeps the Atlas in sync with Manage edits) ---
  const loadData = useCallback(async () => {
    const [p, v, w, pr, m, s] = await Promise.allSettled([
      api.getPlaces(),
      api.getVisits(),
      api.getWishlist(),
      api.getProfile(),
      api.getMedia(),
      api.getSettings(),
    ]);
    // Settings stand on their own: one broken data file must not leave the
    // theme, language and saves running on defaults.
    if (s.status === "fulfilled") applySettings(s.value);
    if (
      p.status === "fulfilled" &&
      v.status === "fulfilled" &&
      w.status === "fulfilled" &&
      pr.status === "fulfilled" &&
      m.status === "fulfilled"
    ) {
      setPlaces(p.value);
      setVisits(v.value);
      setWishlist(w.value);
      setProfile(pr.value);
      setMedia(m.value);
    }
    const failed = [p, v, w, pr, m, s].find((r): r is PromiseRejectedResult => r.status === "rejected");
    const reason: unknown = failed?.reason;
    setError(!failed ? "" : reason instanceof Error ? reason.message : String(reason));
    setLoaded(true);
  }, [applySettings]);

  useEffect(() => {
    let alive = true;
    loadData();
    (async () => {
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
  }, [loadData]);

  useEffect(() => {
    setBrowserLang(navigator.language || "en");
  }, []);

  // --- system colour scheme (for Auto) ---
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // --- apply theme tokens ---
  // Not before the stored preference is known: the boot script has already
  // painted the last-used theme, and the Light default would flash over it.
  useEffect(() => {
    if (loaded) applyTheme(theme);
  }, [theme, loaded]);

  const wordmark = atlasWordmark(profile?.name);
  useEffect(() => {
    document.title = wordmark + " · Odyssey";
  }, [wordmark]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const changeTheme = useCallback(
    (pref: ThemePreference) => {
      setThemePref(pref);
      saveSettings({ theme: pref });
    },
    [saveSettings]
  );

  const changeLanguage = useCallback(
    (pref: LocalePreference) => {
      setLocalePref(pref);
      saveSettings({ language: pref });
    },
    [saveSettings]
  );

  const changeLayers = useCallback(
    (next: MapLayers) => {
      setLayers(next);
      saveSettings({
        showRoutes: next.routes,
        showWishlist: next.wishlist,
        hideCountries: !next.countries,
      });
    },
    [saveSettings]
  );

  // --- overlay lifecycle (single source; animated close) ---
  // Opening anything cancels a close still animating, so its timer cannot
  // dismiss the overlay that replaced it.
  const closeTimerRef = useRef<number | null>(null);
  const cancelPendingClose = useCallback(() => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setClosingOverlay(false);
  }, []);
  const closeOverlay = useCallback(() => {
    if (!overlay || closingOverlay) return;
    setClosingOverlay(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOverlay(null);
      setClosingOverlay(false);
    }, 260);
  }, [overlay, closingOverlay]);
  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  // An overlay supersedes contextual focus.
  const openPlace = useCallback((id: string) => {
    cancelPendingClose();
    setSyncFocus(null);
    setOverlay({ type: "place", id });
  }, [cancelPendingClose]);
  const openIdeas = useCallback((s?: Season) => {
    cancelPendingClose();
    setSyncFocus(null);
    setOverlay({ type: "ideas", season: s });
  }, [cancelPendingClose]);

  // "Show on map": back to the map tab, and fly the camera to the place.
  const showOnMap = useCallback((placeId: string) => {
    cancelPendingClose();
    setOverlay(null);
    setTab("map");
    setFlyTo({ placeId, nonce: Date.now() });
  }, [cancelPendingClose]);

  // --- Map ↔ Timeline synchronization (v1.3) ---
  // Multiple-Visit rule: the focused Visit is (1) the one already in context
  // when it belongs to this Place, (2) the current-base Visit when the Place is
  // the current base, (3) otherwise the most recent Visit (stable tie-break).
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

  const handleTimelineSelect = useCallback((node: TimelineNode) => {
    setSyncFocus({ placeId: node.place.id, nodeId: node.id, visitId: node.visitId, source: "timeline" });
  }, []);

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

  const clearSyncFocus = useCallback(() => setSyncFocus(null), []);

  // --- keyboard: Escape closes the open overlay ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (searchOpen || share) return; // those dialogs own the keyboard
      if (e.key === "Escape" && overlay) closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay, searchOpen, share]);

  // Android back button (apps/android calls window.odysseyBack): close the
  // topmost layer, leave Manage Atlas, then go back to the map tab.
  // False lets the app go to the background. Layers that own the keyboard
  // (lightbox, share, inline editors) close through their own Escape; an open
  // Manage form is never thrown away by a stray back press.
  useEffect(() => {
    const w = window as unknown as { odysseyBack?: () => boolean };
    w.odysseyBack = () => {
      if (searchOpen) {
        setSearchOpen(false);
        return true;
      }
      if (share) {
        setShare(null);
        return true;
      }
      if (document.querySelector("[data-owns-keyboard]")) {
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        );
        return true;
      }
      if (overlay) {
        closeOverlay();
        return true;
      }
      if (view === "manage") {
        if (document.querySelector(".atlas-manage .atlas-entity-form")) {
          showToast(t("You have unsaved changes — save or cancel them first."));
        } else {
          setView("atlas");
          setManageAdd(null);
        }
        return true;
      }
      if (tab !== "map") {
        setTab("map");
        return true;
      }
      return false;
    };
    return () => {
      delete w.odysseyBack;
    };
  }, [searchOpen, share, overlay, closeOverlay, view, tab, showToast]);

  // --- URL state (PRODUCT_SPEC §36): /?tab=… /?place=… /?season=… /?ideas=true ---
  // Applied after hydration so the first client render matches the export.
  // Without a season in the URL, Where Next opens on the coming season.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const p = params.get("place");
    const s = params.get("season");
    const ideas = params.get("ideas");
    if (TABS.includes(tabParam as AtlasTab)) setTab(tabParam as AtlasTab);
    else if (params.get("profile") === "true") setTab("me"); // links from before the tabs
    if (p) setOverlay({ type: "place", id: p });
    else if (ideas === "true") setOverlay({ type: "ideas" });
    if (SEASONS.includes(s as Season)) setSeason(s as Season);
    else {
      const next = seasonFromMonth(((new Date().getMonth() + 3) % 12) + 1);
      setSeason(next);
    }
  }, []);

  const firstPushRef = useRef(true);
  useEffect(() => {
    if (firstPushRef.current) {
      firstPushRef.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (overlay?.type === "place") url.searchParams.set("place", overlay.id);
    else url.searchParams.delete("place");
    url.searchParams.delete("profile");
    if (tab !== "map") url.searchParams.set("tab", tab);
    else url.searchParams.delete("tab");
    if (overlay?.type === "ideas") url.searchParams.set("ideas", "true");
    else url.searchParams.delete("ideas");
    url.searchParams.set("season", season);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [overlay, season, tab]);

  const placeOverlayExists = overlay?.type !== "place" || places.some((p) => p.id === overlay.id);
  // A deleted or unknown ?place= would otherwise hold an invisible overlay
  // (page scroll locked) with nothing on screen.
  useEffect(() => {
    if (loaded && !placeOverlayExists) {
      cancelPendingClose();
      setOverlay(null);
    }
  }, [loaded, placeOverlayExists, cancelPendingClose]);

  const defaultMapPosition = settings?.defaultMapPosition
    ? ([settings.defaultMapPosition.lng, settings.defaultMapPosition.lat] as [number, number])
    : null;

  const overlayOpen = overlay != null || closingOverlay;

  return (
    <LocaleContext.Provider value={locale}>
      <section className="atlas-map-layer" id="map" aria-label={t("Map")} aria-hidden={tab !== "map"}>
        <HeroMap
          places={places}
          visits={visits}
          wishlist={wishlist}
          profile={profile}
          countriesGeo={countriesGeo}
          theme={theme}
          media={media}
          obscured={overlayOpen || tab !== "map" || view === "manage"}
          layers={layers}
          onLayersChange={changeLayers}
          focus={syncFocus}
          onFocusPlace={handleMapFocus}
          onClearFocus={clearSyncFocus}
          onOpenPlace={openPlace}
          initialCenter={defaultMapPosition}
          flyTo={flyTo}
          ready={loaded}
        />
        {tab === "map" ? <Topbar wordmark={wordmark} onOpenSearch={() => setSearchOpen(true)} /> : null}
      </section>

      {tab === "journey" ? (
        <main className="atlas-tabpage atlas-tabpage--journey">
          <JourneyTimeline
            places={places}
            visits={visits}
            wishlist={wishlist}
            profile={profile}
            media={media}
            theme={theme}
            loaded={loaded}
            emphasizedSeason={season}
            overlayOpen={overlayOpen}
            focus={syncFocus}
            onSelectNode={handleTimelineSelect}
            onOpenPlace={openPlace}
            onWhereNext={() => setTab("wherenext")}
            onAddFirst={writable ? () => openManage("visit") : undefined}
          />
        </main>
      ) : tab === "wherenext" ? (
        <main className="atlas-tabpage atlas-tabpage--wherenext">
          <WhereNext
            wishlist={wishlist}
            places={places}
            media={media}
            theme={theme}
            season={season}
            onSeasonChange={setSeason}
            onOpenPlace={openPlace}
            onViewAll={() => openIdeas()}
            onAddWish={writable ? () => openManage("wishlist") : undefined}
          />
        </main>
      ) : tab === "me" ? (
        <main className="atlas-tabpage atlas-tabpage--me">
          <ProfilePage
            profile={profile}
            places={places}
            visits={visits}
            wishlist={wishlist}
            theme={theme}
            themePreference={themePref}
            onThemeChange={changeTheme}
            localePreference={localePref}
            onLocaleChange={changeLanguage}
            writable={writable}
            onManage={() => openManage()}
            onProfileSaved={loadData}
            onOpenPlace={openPlace}
            onShare={(scope, country) => setShare({ scope, country })}
          />
          <footer className="atlas-footer">
            {t("Built with")}
            <span className="atlas-footer__heart" role="img" aria-label="♥">
              <HeartIcon size={14} />
            </span>
            {t("for memories")}
          </footer>
        </main>
      ) : null}

      <TabBar tab={tab} onChange={setTab} onAdd={writable ? () => openManage("visit") : undefined} />

      {error ? <div className="atlas-error">{error}</div> : null}
      {toast ? (
        <div className="atlas-toast" role="status">
          {toast}
        </div>
      ) : null}

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
          onNavigate={openPlace}
          onShowOnMap={showOnMap}
          onShare={(visitId, country) => setShare({ scope: "trip", visitId, country })}
        />
      ) : null}

      {overlay?.type === "ideas" ? (
        <IdeasBoard
          wishlist={wishlist}
          places={places}
          media={media}
          initialSeason={overlay.season ?? null}
          closing={closingOverlay}
          onClose={closeOverlay}
          onOpenPlace={openPlace}
        />
      ) : null}

      {searchOpen ? (
        <SearchPanel
          places={places}
          visits={visits}
          wishlist={wishlist}
          media={media}
          profile={profile}
          onClose={() => setSearchOpen(false)}
          onOpenPlace={(id) => {
            setSearchOpen(false);
            openPlace(id);
          }}
          onShowOnMap={(id) => {
            setSearchOpen(false);
            showOnMap(id);
          }}
        />
      ) : null}

      {share ? (
        <ShareDialog
          key={share.scope + (share.visitId ?? "") + (share.country ?? "")}
          request={share}
          places={places}
          visits={visits}
          wishlist={wishlist}
          profile={profile}
          media={media}
          theme={theme}
          wordmark={wordmark}
          countries={countriesGeo}
          onClose={closeShare}
          onNotice={showToast}
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
          themePreference={themePref}
          onThemeChange={changeTheme}
          localePreference={localePref}
          onLocaleChange={changeLanguage}
          runtime={runtime}
          onReload={loadData}
          onExit={() => {
            setView("atlas");
            setManageAdd(null);
          }}
          initialAdd={manageAdd}
        />
      ) : null}
    </LocaleContext.Provider>
  );
}
