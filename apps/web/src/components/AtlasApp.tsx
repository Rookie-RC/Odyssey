"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type RuntimeInfo } from "../lib/api";
import { signOut } from "../lib/account";
import type { Media, Place, Profile, Season, Settings, Visit, Wishlist } from "../lib/types";
import { HttpAtlasRepository } from "../lib/repository";
import type { SyncFocus } from "../lib/sync";
import type { TimelineNode } from "../lib/timeline";
import { seasonFromMonth } from "../lib/timeline";
import { atlasFacts, atlasFactsLine, atlasWordmark } from "../lib/domain";
import { startLiquidGlass, type LiquidGlass } from "../lib/liquid-glass";
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
import ProfileDrawer from "./ProfileDrawer";
import IdeasBoard from "./IdeasBoard";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import ShareDialog, { type ShareRequest } from "./ShareDialog";
import Topbar from "./Topbar";
import ManageAtlas from "./manage/ManageAtlas";
import { HeartIcon, WifiIcon } from "./Icons";
import {
  THEME_ORDER,
  applyTheme,
  parseThemePreference,
  resolveTheme,
  themes,
  type ThemePreference,
} from "../themes";

// Collapsed contextual strip (PRODUCT_SPEC §18: 80–140px band).
const STRIP_HEIGHT = 84;
const STRIP_MARGIN = 10;

// One global overlay state (PRODUCT_SPEC §25): Place Detail, Profile and the
// Ideas board are mutually exclusive; nothing stacks on top of them.
type ActiveOverlay =
  | { type: "place"; id: string }
  | { type: "profile" }
  | { type: "ideas"; season?: Season }
  | null;

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Runs `fn` once a smooth scroll back to the top has arrived (so the hero has
 * re-expanded), plus `settleMs`; gives up waiting after a couple of seconds. */
function whenAtTop(fn: () => void, settleMs = 0): void {
  const start = performance.now();
  const tick = () => {
    if (window.scrollY <= 1 || performance.now() - start > 2000) {
      window.setTimeout(fn, settleMs);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export default function AtlasApp() {
  const clipRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Share as a ticket (a trip, a country, the whole journey).
  const [share, setShare] = useState<ShareRequest | null>(null);
  const closeShare = useCallback(() => setShare(null), []);
  const [flyTo, setFlyTo] = useState<{ placeId: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exportNonce, setExportNonce] = useState(0);

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
      // read-only / LAN viewers cannot persist; the choice still applies locally
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
  // Liquid glass panes follow the theme's refraction and corner radii.
  const glassRef = useRef<LiquidGlass | null>(null);
  useEffect(() => {
    if (!loaded) return;
    applyTheme(theme);
    if (glassRef.current) glassRef.current.update(theme.glass.refraction);
    else glassRef.current = startLiquidGlass(theme.glass.refraction);
  }, [theme, loaded]);
  useEffect(
    () => () => {
      glassRef.current?.stop();
      glassRef.current = null;
    },
    []
  );

  const wordmark = atlasWordmark(profile?.name);
  useEffect(() => {
    document.title = wordmark + " · Odyssey";
  }, [wordmark]);

  // --- scroll-driven map collapse ---
  // Height, inset and radius are written straight to the DOM in rAF so
  // scrolling never re-renders React. The map stays full-bleed for the first
  // half of the collapse; only then does it gain its inset and rounded corners
  // (VISUAL_SPEC §6: radius introduced only once no longer full-bleed).
  useEffect(() => {
    const update = () => {
      const clip = clipRef.current;
      const band = bandRef.current;
      if (!clip || !band) return;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const sy = window.scrollY;
      const stripTotal = STRIP_HEIGHT + STRIP_MARGIN * 2;
      const collapseDist = Math.max(vh - stripTotal, 1);
      const progress = clamp(sy / collapseDist, 0, 1);
      const k = clamp((progress - 0.45) / 0.55, 0, 1);
      const eased = k * k * (3 - 2 * k);
      const gutter = clamp(vw * 0.034, 20, 48);
      const inset = eased * gutter;
      const top = eased * STRIP_MARGIN;
      const height = Math.max(STRIP_HEIGHT, vh - sy - top);
      clip.style.left = inset + "px";
      clip.style.right = inset + "px";
      clip.style.top = top + "px";
      clip.style.height = height + "px";
      clip.style.borderRadius = Math.round(eased * 16) + "px";
      band.style.height = Math.min(vh, top + height + eased * STRIP_MARGIN) + "px";
      const root = document.documentElement;
      root.style.setProperty("--hero-scroll", progress.toFixed(4));
      root.classList.toggle("atlas-collapsed", progress > 0.9);
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
  const openProfile = useCallback(() => {
    cancelPendingClose();
    setSyncFocus(null);
    setOverlay({ type: "profile" });
  }, [cancelPendingClose]);
  const openIdeas = useCallback((s?: Season) => {
    cancelPendingClose();
    setSyncFocus(null);
    setOverlay({ type: "ideas", season: s });
  }, [cancelPendingClose]);

  const scrollToSection = useCallback((id: "map" | "journey" | "wherenext") => {
    if (id === "map") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(id === "journey" ? "journey" : "where-next");
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (STRIP_HEIGHT + STRIP_MARGIN * 2) + 4;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  // "Show on map": expand the hero, then — once the page is back at the top
  // and the map has re-expanded — fly the camera to the place.
  const showOnMap = useCallback((placeId: string) => {
    cancelPendingClose();
    setOverlay(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    whenAtTop(() => setFlyTo({ placeId, nonce: Date.now() }), 120);
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
      if (paletteOpen || share) return; // those dialogs own the keyboard
      if (e.key === "Escape" && overlay) closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay, paletteOpen, share]);

  // Android back button (apps/android calls window.odysseyBack): close the
  // topmost layer, leave Manage Atlas, then return to the top of the page.
  // False lets the app go to the background. Layers that own the keyboard
  // (lightbox, share, inline editors) close through their own Escape; an open
  // Manage form is never thrown away by a stray back press.
  useEffect(() => {
    const w = window as unknown as { odysseyBack?: () => boolean };
    w.odysseyBack = () => {
      if (paletteOpen) {
        setPaletteOpen(false);
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
      if (window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return true;
      }
      return false;
    };
    return () => {
      delete w.odysseyBack;
    };
  }, [paletteOpen, share, overlay, closeOverlay, view, showToast]);

  // Lock page scroll while an overlay or Manage Atlas is open.
  useEffect(() => {
    const locked = overlay != null || closingOverlay || view === "manage";
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlay, closingOverlay, view]);

  // --- URL state (PRODUCT_SPEC §36): /?place=… /?season=… /?profile=true ---
  // Applied after hydration so the first client render matches the export.
  // Without a season in the URL, Where Next opens on the coming season.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prof = params.get("profile");
    const p = params.get("place");
    const s = params.get("season");
    const ideas = params.get("ideas");
    if (prof === "true") setOverlay({ type: "profile" });
    else if (p) setOverlay({ type: "place", id: p });
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
    if (overlay?.type === "profile") url.searchParams.set("profile", "true");
    else url.searchParams.delete("profile");
    if (overlay?.type === "ideas") url.searchParams.set("ideas", "true");
    else url.searchParams.delete("ideas");
    url.searchParams.set("season", season);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [overlay, season]);

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

  // --- command palette commands ---
  const commands = useMemo<PaletteCommand[]>(() => {
    const go = t("Go to");
    const list: PaletteCommand[] = [
      { id: "go-map", group: go, label: t("The map"), run: () => scrollToSection("map") },
      { id: "go-journey", group: go, label: t("My journey"), run: () => scrollToSection("journey") },
      { id: "go-wherenext", group: go, label: t("Where next"), run: () => scrollToSection("wherenext") },
      { id: "ideas", group: go, label: t("All ideas"), run: () => openIdeas() },
      { id: "profile", group: go, label: t("Profile"), run: openProfile },
    ];
    if (writable) {
      list.push({ id: "manage", group: go, label: t("Manage Atlas"), run: () => openManage() });
    }
    for (const id of ["auto", ...THEME_ORDER] as ThemePreference[]) {
      list.push({
        id: "theme-" + id,
        group: t("Theme"),
        label: id === "auto" ? t("Auto (system)") : t(themes[id].label),
        detail: id === "auto" ? t("Follows Light / Night") : t(themes[id].description),
        active: themePref === id,
        run: () => changeTheme(id),
      });
    }
    for (const [id, label] of [
      ["auto", t("Auto")],
      ["en", "English"],
      ["zh", "简体中文"],
    ] as [LocalePreference, string][]) {
      list.push({
        id: "lang-" + id,
        group: t("Language"),
        label,
        detail: id === "auto" ? t("Follows your system") : undefined,
        active: localePref === id,
        run: () => changeLanguage(id),
      });
    }
    list.push(
      {
        id: "layer-routes",
        group: t("Map"),
        label: layers.routes ? t("Hide routes") : t("Show routes"),
        run: () => changeLayers({ ...layers, routes: !layers.routes }),
      },
      {
        id: "layer-wishlist",
        group: t("Map"),
        label: layers.wishlist ? t("Hide wishlist pins") : t("Show wishlist pins"),
        run: () => changeLayers({ ...layers, wishlist: !layers.wishlist }),
      },
      {
        id: "layer-countries",
        group: t("Map"),
        label: layers.countries ? t("Hide visited countries") : t("Show visited countries"),
        run: () => changeLayers({ ...layers, countries: !layers.countries }),
      },
      {
        id: "export-poster",
        group: t("Map"),
        label: t("Save map as image"),
        run: () => {
          // Capture the full hero, not a half-expanded strip (the map then
          // waits for its camera to settle back from the strip view).
          scrollToSection("map");
          whenAtTop(() => setExportNonce((n) => n + 1));
        },
      }
    );
    if (runtime?.mode === "cloud" && runtime.user) {
      list.push({ id: "sign-out", group: t("Account"), label: t("Sign out"), detail: runtime.user.email, run: () => signOut() });
    }
    if (visits.length > 0) {
      list.push(
        { id: "share-journey", group: t("Share"), label: t("Share my journey"), detail: t("As an atlas pass"), run: () => setShare({ scope: "journey" }) },
        { id: "share-trip", group: t("Share"), label: t("Share a trip"), detail: t("As a boarding pass"), run: () => setShare({ scope: "trip" }) },
        { id: "share-country", group: t("Share"), label: t("Share a country"), detail: t("Every city there, on one pass"), run: () => setShare({ scope: "country" }) }
      );
    }
    return list;
    // locale: labels are translated at build time of the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    writable,
    runtime,
    themePref,
    localePref,
    locale,
    layers,
    changeTheme,
    changeLanguage,
    changeLayers,
    openIdeas,
    openProfile,
    scrollToSection,
    visits.length,
  ]);

  const remote = runtime?.remote === true;
  const posterSubtitle = useMemo(
    () => atlasFactsLine(atlasFacts(places, visits, wishlist), false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places, visits, wishlist, locale]
  );

  return (
    <LocaleContext.Provider value={locale}>
      <section className="atlas-map-sticky" id="map" aria-label={t("Map")}>
        <div ref={bandRef} className="atlas-map-band" />
        <div ref={clipRef} className="atlas-map-clip">
          <HeroMap
            places={places}
            visits={visits}
            wishlist={wishlist}
            profile={profile}
            countriesGeo={countriesGeo}
            theme={theme}
            media={media}
            overlayOpen={overlayOpen}
            layers={layers}
            onLayersChange={changeLayers}
            focus={syncFocus}
            onFocusPlace={handleMapFocus}
            onClearFocus={clearSyncFocus}
            onOpenPlace={openPlace}
            initialCenter={defaultMapPosition}
            flyTo={flyTo}
            ready={loaded}
            posterTitle={wordmark}
            posterSubtitle={posterSubtitle}
            exportNonce={exportNonce}
            onNotice={showToast}
          />
        </div>
      </section>

      <main className="atlas-main">
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
          onWhereNext={() => scrollToSection("wherenext")}
          onAddFirst={writable ? () => openManage("visit") : undefined}
        />
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
        <footer className="atlas-footer">
          <div>
            {t("Built with")}
            <span className="atlas-footer__heart" role="img" aria-label="♥">
              <HeartIcon size={14} />
            </span>
            {t("for memories")}
          </div>
          <div className="atlas-footer__meta">
            {remote ? (
              <span className="atlas-footer__remote">
                <WifiIcon size={14} /> {t("Shared on your local network · view only")}
              </span>
            ) : null}
          </div>
        </footer>
      </main>

      <Topbar
        profile={profile}
        wordmark={wordmark}
        theme={theme}
        themePreference={themePref}
        onThemeChange={changeTheme}
        onOpenProfile={openProfile}
        onOpenSearch={() => setPaletteOpen(true)}
        onExpandMap={() => scrollToSection("map")}
      />

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

      {overlay?.type === "profile" ? (
        <ProfileDrawer
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
          closing={closingOverlay}
          onClose={closeOverlay}
          onManage={() => {
            closeOverlay();
            openManage();
          }}
          onProfileSaved={loadData}
          onOpenPlace={openPlace}
          onShare={(scope, country) => setShare({ scope, country })}
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

      {paletteOpen ? (
        <CommandPalette
          places={places}
          visits={visits}
          wishlist={wishlist}
          media={media}
          profile={profile}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
          onOpenPlace={(id) => {
            setPaletteOpen(false);
            openPlace(id);
          }}
          onShowOnMap={(id) => {
            setPaletteOpen(false);
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
