// Theme contract + legibility guard (VISUAL_SPEC §28: "Night theme must not
// sacrifice readability for atmosphere" — nor may any other theme).
import { describe, expect, test } from "vitest";
import { THEME_ORDER, parseThemePreference, resolveTheme, themes } from ".";
import type { AtlasTheme } from "./types";

type RGBA = [number, number, number, number];

function parse(c: string): RGBA {
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    const n = parseInt(full.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) throw new Error("unparseable colour " + c);
  const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}

/** Composite a (possibly translucent) colour over an opaque ground. */
function over(fg: string, bg: string): [number, number, number] {
  const [r, g, b, a] = parse(fg);
  const [R, G, B] = parse(bg);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number {
  const ground = over(bg, "#808080"); // grounds are opaque in practice
  const groundHex = "rgb(" + ground.join(",") + ")";
  const a = luminance(over(fg, groundHex));
  const b = luminance(ground);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(THEME_ORDER.map((id) => [id, themes[id]] as [string, AtlasTheme]))("%s theme", (_id, t) => {
  test("primary text is comfortably legible (≥ 7:1, AAA)", () => {
    expect(contrast(t.colors.textPrimary, t.colors.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(t.colors.textPrimary, t.colors.surface)).toBeGreaterThanOrEqual(7);
  });

  test("secondary text meets AA for body copy (≥ 4.5:1)", () => {
    expect(contrast(t.colors.textSecondary, t.colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.colors.textSecondary, t.colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  test("season ink is legible as small bold labels (≥ 3:1)", () => {
    for (const s of ["spring", "summer", "autumn", "winter"] as const) {
      expect(contrast(t.seasonInk[s], t.colors.bg), s).toBeGreaterThanOrEqual(3);
    }
  });

  test("accent and NOW read against the page, text on accent reads on it", () => {
    expect(contrast(t.colors.accent, t.colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.colors.now, t.colors.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.colors.onAccent, t.colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  test("the NOW pill (82% NOW + 18% ink, as in journey.css) clears AA on its tint", () => {
    const [r1, g1, b1] = over(t.colors.now, t.colors.bg);
    const [r2, g2, b2] = over(t.colors.textPrimary, t.colors.bg);
    const mix = (a: number, b: number) => Math.round(a * 0.82 + b * 0.18);
    const ink = "rgb(" + [mix(r1, r2), mix(g1, g2), mix(b1, b2)].join(",") + ")";
    const pill = "rgb(" + over(t.colors.nowSoft, t.colors.bg).join(",") + ")";
    expect(contrast(ink, pill)).toBeGreaterThanOrEqual(4.5);
  });

  test("text on liquid glass reads over any part of the map beneath it", () => {
    for (const ground of [t.map.palette.background, t.map.palette.land, t.map.palette.water]) {
      const pane = "rgb(" + over(t.glass.tint, ground).join(",") + ")";
      expect(contrast(t.colors.textPrimary, pane), ground).toBeGreaterThanOrEqual(7);
      expect(contrast(t.colors.textSecondary, pane), ground).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("labels stay legible over a visited country's wash", () => {
    const washed = "rgb(" + over(t.countries.fill, t.map.palette.land).join(",") + ")";
    expect(contrast(t.markers.label, washed)).toBeGreaterThanOrEqual(7);
  });

  test("map labels stand out from the land they sit on", () => {
    expect(contrast(t.map.palette.labelCity, t.map.palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.markers.label, t.map.palette.background)).toBeGreaterThanOrEqual(7);
  });

  test("every token is a non-empty value", () => {
    const walk = (o: unknown, path: string) => {
      if (o == null) return; // optional (hillshade / cityLights) may be null
      if (typeof o === "string") expect(o.length, path).toBeGreaterThan(0);
      else if (typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, path + "." + k);
    };
    walk(t, t.id);
  });
});

test("Auto resolves to Light or Night; unknown preferences fall back to Light", () => {
  expect(resolveTheme("auto", true).id).toBe("night");
  expect(resolveTheme("auto", false).id).toBe("light");
  expect(resolveTheme("night", false).id).toBe("night");
  expect(parseThemePreference("sepia-ish")).toBe("light");
  // The retired themes read as Light.
  expect(parseThemePreference("journal")).toBe("light");
  expect(resolveTheme(parseThemePreference("film"), true).id).toBe("light");
});
