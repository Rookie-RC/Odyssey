"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Media, Place, Profile, Settings, Visit, Wishlist } from "../lib/types";
import HeroMap, { type CountryCollection } from "./HeroMap";
import JourneyTimeline from "./JourneyTimeline";
import { applyTheme, themes } from "../themes";
import type { ThemeId } from "../themes";

// Collapsed "contextual strip" height (PRODUCT_SPEC §18: 80–140px).
const STRIP_HEIGHT = 140;

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
        />
      </main>

      <header className="atlas-wordmark">Yu&rsquo;s Atlas</header>

      <button className="atlas-theme-toggle" onClick={toggleTheme} type="button">
        {themeId === "light" ? "Night" : "Light"}
      </button>

      {error ? <div className="atlas-error">{error}</div> : null}
    </>
  );
}
