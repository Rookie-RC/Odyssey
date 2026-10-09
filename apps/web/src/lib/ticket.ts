// Ticket images for sharing (lib/share.ts holds the data). Each ticket is a
// stub-and-body pass in the active theme: its paper, ink, accent and date
// stamp, its typefaces, paper fibres or film grain, its photograph treatment.
//   trip     — a landscape boarding pass (train ticket, bus ticket, road trip),
//              with the destination's photograph and a tear-off stub
//   country  — a portrait pass: the country's outline with its cities pinned,
//              every visit there as an itinerary
//   journey  — a portrait atlas pass: the facts, home base, flags, itinerary
// Drawn locally on a 2D canvas; nothing leaves the machine.
import type { AtlasTheme } from "../themes";
import type { Place, Transport } from "./types";
import { TRANSPORT_GLYPH, transportLabel } from "./transport";
import { placeCode, ticketHash, type CountryTicket, type JourneyTicket, type Ticket, type TicketLeg, type TripTicket } from "./share";
import { atlasFactsLine, formatDateRange } from "./domain";
import { formatMonthYear, seasonLabel, visitTypeLabel } from "./timeline";
import { getLocale, t, tn } from "./i18n";
import { mediaSrc } from "./api";

export interface CountryShapes {
  features: { properties: { ISO_A2: string }; geometry: unknown }[];
}

export interface TicketContext {
  theme: AtlasTheme;
  /** "Yu’s Atlas" */
  wordmark: string;
  /** Profile name for the PASSENGER field ("" hides it). */
  passenger: string;
  countries: CountryShapes | null;
}

const S = 2; // device pixels per CSS pixel
const MARGIN = 40;
const NOTCH = 17;

type G = CanvasRenderingContext2D;

// --- small drawing kit ------------------------------------------------------

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: G } {
  const c = document.createElement("canvas");
  c.width = Math.round(w * S);
  c.height = Math.round(h * S);
  const g = c.getContext("2d");
  if (!g) throw new Error("canvas unavailable");
  g.scale(S, S);
  return { c, g };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** CSS `url("data:…")` texture token → its data URL. */
function textureUrl(token: string): string | null {
  const m = /^url\("(.+)"\)$/.exec(token);
  return m ? m[1] : null;
}

function upper(s: string): string {
  return getLocale() === "zh" ? s : s.toUpperCase();
}

function setFont(g: G, weight: string | number, size: number, family: string, style = "normal") {
  g.font = `${style} ${weight} ${size}px ${family}`;
}

function tracking(g: G, px: number) {
  if ("letterSpacing" in g) (g as G & { letterSpacing: string }).letterSpacing = px + "px";
}

/** Shortens text with an ellipsis to fit maxWidth. */
function fit(g: G, s: string, maxWidth: number): string {
  if (g.measureText(s).width <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd() + "…";
}

/** Word-wraps into at most `lines` lines (CJK wraps per character). */
function wrap(g: G, s: string, maxWidth: number, lines: number): string[] {
  const tokens = /[　-鿿]/.test(s) ? Array.from(s) : s.split(/(\s+)/);
  const out: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    const next = cur + tok;
    if (g.measureText(next).width > maxWidth && cur.trim()) {
      out.push(cur.trim());
      cur = tok.trimStart();
      if (out.length === lines) break;
    } else cur = next;
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim());
  if (out.length === lines) {
    const used = out.join(" ").length;
    if (used < s.trim().length - 1) out[lines - 1] = fit(g, out[lines - 1] + " …", maxWidth);
  }
  return out;
}

function label(g: G, theme: AtlasTheme, s: string, x: number, y: number, align: CanvasTextAlign = "left") {
  setFont(g, 600, 10.5, theme.fonts.ui);
  tracking(g, getLocale() === "zh" ? 1 : 1.6);
  g.fillStyle = theme.colors.textSecondary;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(upper(s), x, y);
  tracking(g, 0);
}

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function hairline(g: G, theme: AtlasTheme, x1: number, y1: number, x2: number, y2: number) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = theme.colors.border;
  g.lineWidth = 1;
  g.setLineDash([]);
  g.stroke();
}

/** The wordmark's compass rose (Icons.tsx), at the given size. */
function rose(g: G, x: number, y: number, size: number, color: string) {
  const k = size / 32;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.fillStyle = color;
  const parts: [string, number][] = [
    ["M16 1.5 18 14 16 16 14 14Z", 1],
    ["M16 30.5 14 18 16 16 18 18Z", 0.55],
    ["M30.5 16 18 18 16 16 18 14Z", 0.55],
    ["M1.5 16 14 14 16 16 14 18Z", 1],
    ["M25.5 6.5 17.3 15.2 16 16 16.8 14.7Z", 0.4],
    ["M6.5 25.5 14.7 16.8 16 16 15.2 17.3Z", 0.4],
    ["M25.5 25.5 16.8 17.3 16 16 17.3 16.8Z", 0.4],
    ["M6.5 6.5 15.2 14.7 16 16 14.7 15.2Z", 0.4],
  ];
  for (const [d, a] of parts) {
    g.globalAlpha = a;
    g.fill(new Path2D(d));
  }
  g.globalAlpha = 1;
  g.restore();
}

/** A vehicle silhouette; the plane can be turned (radians, 0 = nose up). */
function glyph(g: G, mode: Transport, cx: number, cy: number, size: number, color: string, angle = 0) {
  g.save();
  g.translate(cx, cy);
  g.rotate(angle);
  g.scale(size / 24, size / 24);
  g.translate(-12, -12);
  g.fillStyle = color;
  g.fill(new Path2D(TRANSPORT_GLYPH[mode]), "evenodd");
  g.restore();
}

/** Decorative barcode, deterministic per seed. */
function barcode(g: G, x: number, y: number, w: number, h: number, seed: string, color: string) {
  let s = ticketHash(seed) || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  g.fillStyle = color;
  let cx = x;
  while (cx < x + w - 2) {
    const bw = 1 + Math.floor(rnd() * 3) * 0.9;
    if (cx + bw > x + w) break;
    g.fillRect(cx, y, bw, h);
    cx += bw + 1.2 + Math.floor(rnd() * 3) * 0.8;
  }
}

async function flagImages(codes: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    Array.from(new Set(codes.map((c) => c.toUpperCase())))
      .filter((c) => /^[A-Z]{2}$/.test(c))
      .map(async (c) => {
        const img = await loadImage("/flags/" + c + ".svg");
        if (img) out.set(c, img);
      })
  );
  return out;
}

function flag(g: G, img: HTMLImageElement | undefined, x: number, y: number, w: number) {
  if (!img) return;
  const h = (w * 2) / 3;
  g.save();
  roundRect(g, x, y, w, h, 2);
  g.clip();
  g.drawImage(img, x, y, w, h);
  g.restore();
  roundRect(g, x + 0.25, y + 0.25, w - 0.5, h - 0.5, 2);
  g.strokeStyle = "rgba(0,0,0,0.22)";
  g.lineWidth = 0.5;
  g.stroke();
}

function kindLabel(mode: Transport | "lived"): string {
  switch (mode) {
    case "lived":
      return t("Residence");
    case "plane":
      return t("Boarding pass");
    case "train":
      return t("Train ticket");
    case "bus":
      return t("Bus ticket");
    case "car":
      return t("Road trip");
  }
}

async function loadFonts(theme: AtlasTheme) {
  const f = theme.fonts;
  await Promise.all(
    [
      `${f.displayWeight} 40px ${f.display}`,
      `italic 400 18px ${f.body}`,
      `600 14px ${f.ui}`,
      `500 14px ${f.ui}`,
      `700 40px ${f.mono}`,
      `600 16px ${f.date}`,
    ].map((spec) => document.fonts.load(spec).catch(() => []))
  );
}

// --- the paper ----------------------------------------------------------------

/** Lays a ticket (drawn by `paint` on its own paper) onto the theme's ground:
 * texture, perforation notches cut out, a soft shadow beneath. */
async function compose(
  theme: AtlasTheme,
  w: number,
  h: number,
  notches: [number, number][],
  paint: (g: G) => Promise<void> | void
): Promise<Blob> {
  const paper = canvas(w, h);
  const pg = paper.g;
  roundRect(pg, 0, 0, w, h, 22);
  pg.clip();
  pg.fillStyle = theme.colors.surface;
  pg.fillRect(0, 0, w, h);
  const fibres = textureUrl(theme.texture.paper);
  if (fibres && theme.texture.paperOpacity > 0) {
    const img = await loadImage(fibres);
    const pattern = img && pg.createPattern(img, "repeat");
    if (pattern) {
      pg.globalAlpha = Math.min(0.5, theme.texture.paperOpacity * 3);
      pg.fillStyle = pattern;
      pg.fillRect(0, 0, w, h);
      pg.globalAlpha = 1;
    }
  }
  await paint(pg);
  const grain = textureUrl(theme.texture.grain);
  if (grain && theme.texture.grainOpacity > 0) {
    const img = await loadImage(grain);
    const pattern = img && pg.createPattern(img, "repeat");
    if (pattern) {
      pg.globalAlpha = Math.min(0.5, theme.texture.grainOpacity * 2.2);
      pg.fillStyle = pattern;
      pg.fillRect(0, 0, w, h);
      pg.globalAlpha = 1;
    }
  }
  // A hairline edge keeps light paper distinct from a light ground; drawn
  // before the notches are cut so it stops where they begin.
  roundRect(pg, 0.75, 0.75, w - 1.5, h - 1.5, 21.5);
  pg.strokeStyle = theme.colors.border;
  pg.lineWidth = 1.5;
  pg.stroke();
  pg.globalCompositeOperation = "destination-out";
  for (const [x, y] of notches) {
    pg.beginPath();
    pg.arc(x, y, NOTCH, 0, Math.PI * 2);
    pg.fill();
  }
  pg.globalCompositeOperation = "source-over";

  const W = w + MARGIN * 2;
  const H = h + MARGIN * 2;
  const out = canvas(W, H);
  const g = out.g;
  g.fillStyle = theme.colors.bg;
  g.fillRect(0, 0, W, H);
  g.save();
  g.shadowColor = theme.mode === "dark" ? "rgba(0,0,0,0.55)" : "rgba(60,45,25,0.16)";
  g.shadowBlur = 34;
  g.shadowOffsetY = 12;
  g.drawImage(paper.c, MARGIN, MARGIN, w, h);
  g.restore();
  // The notches: the ground shows through, rimmed by the paper's edge and a
  // little shade where the paper casts over it.
  g.save();
  g.translate(MARGIN, MARGIN);
  roundRect(g, 0, 0, w, h, 22);
  g.clip();
  for (const [x, y] of notches) {
    g.beginPath();
    g.arc(x, y, NOTCH, 0, Math.PI * 2);
    g.fillStyle = theme.mode === "dark" ? "rgba(0,0,0,0.28)" : "rgba(60,45,25,0.07)";
    g.fill();
    g.beginPath();
    g.arc(x, y, NOTCH - 0.75, 0, Math.PI * 2);
    g.strokeStyle = theme.colors.border;
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.restore();
  return new Promise((resolve, reject) =>
    out.c.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), "image/png")
  );
}

function perforation(g: G, theme: AtlasTheme, x1: number, y1: number, x2: number, y2: number) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.setLineDash([2, 6]);
  g.lineCap = "round";
  g.lineWidth = 1.6;
  g.strokeStyle = theme.colors.borderStrong;
  g.stroke();
  g.setLineDash([]);
  g.lineCap = "butt";
}

function header(g: G, theme: AtlasTheme, wordmark: string, x1: number, x2: number, y: number, kind: string, mode?: Transport) {
  rose(g, x1, y - 15, 20, theme.colors.textPrimary);
  setFont(g, theme.fonts.displayWeight, 19, theme.fonts.display);
  g.fillStyle = theme.colors.textPrimary;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(wordmark, x1 + 28, y);
  setFont(g, 650, 12, theme.fonts.ui);
  tracking(g, getLocale() === "zh" ? 2 : 2.4);
  g.fillStyle = theme.colors.accent;
  g.textAlign = "right";
  const text = upper(kind);
  g.fillText(text, x2, y - 1);
  tracking(g, 0);
  if (mode) {
    const tw = g.measureText(text).width + (getLocale() === "zh" ? text.length * 2 : text.length * 2.4);
    glyph(g, mode, x2 - tw - 14, y - 5, 16, theme.colors.accent, mode === "plane" ? Math.PI / 2 : 0);
  }
}

/** The line between two codes, in the trip's transport style. */
function connector(g: G, theme: AtlasTheme, mode: Transport, x1: number, x2: number, y: number) {
  const ink = theme.colors.textSecondary;
  g.save();
  g.strokeStyle = ink;
  g.lineWidth = 1.5;
  if (mode === "plane") {
    g.setLineDash([5, 6]);
    g.beginPath();
    g.moveTo(x1, y);
    g.quadraticCurveTo((x1 + x2) / 2, y - 22, x2, y);
    g.stroke();
  } else if (mode === "train") {
    g.beginPath();
    g.moveTo(x1, y);
    g.lineTo(x2, y);
    g.stroke();
    g.lineWidth = 1.3;
    for (let x = x1 + 4; x < x2; x += 9) {
      g.beginPath();
      g.moveTo(x, y - 4.5);
      g.lineTo(x, y + 4.5);
      g.stroke();
    }
  } else {
    g.globalAlpha = 0.35;
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x1, y);
    g.lineTo(x2, y);
    g.stroke();
    g.globalAlpha = 1;
    g.lineCap = "butt";
    g.lineWidth = 1.2;
    g.strokeStyle = theme.colors.surface;
    g.setLineDash([6, 5]);
    g.beginPath();
    g.moveTo(x1 + 4, y);
    g.lineTo(x2 - 4, y);
    g.stroke();
  }
  g.restore();
  const cx = (x1 + x2) / 2;
  const cy = mode === "plane" ? y - 11 : y;
  g.beginPath();
  g.arc(cx, cy, 17, 0, Math.PI * 2);
  g.fillStyle = theme.colors.surface;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = theme.colors.border;
  g.stroke();
  glyph(g, mode, cx, cy, 20, theme.colors.accent, mode === "plane" ? Math.PI / 2 : 0);
}

function dateText(g: G, theme: AtlasTheme, s: string, x: number, y: number, size: number, align: CanvasTextAlign = "left", maxWidth?: number) {
  setFont(g, 600, size, theme.fonts.date);
  g.fillStyle = theme.colors.dateInk;
  g.textAlign = align;
  g.fillText(maxWidth ? fit(g, s, maxWidth) : s, x, y);
}

// --- trip: a landscape boarding pass ------------------------------------------

async function drawTrip(tk: TripTicket, ctx: TicketContext): Promise<Blob> {
  const { theme } = ctx;
  const leg = tk.leg;
  const w = 1320;
  const h = 520;
  const stubW = 330;
  const perfX = w - stubW;
  const flags = await flagImages([leg.place.countryCode, leg.from?.countryCode ?? ""]);
  const photo = tk.photo ? await loadImage(mediaSrc(tk.photo, 960)) : null;
  const photoW = photo ? 280 : 0;
  const mode: Transport | "lived" = leg.visitType === "lived" ? "lived" : leg.mode;
  const glyphMode: Transport = leg.mode;

  return compose(theme, w, h, [[perfX, 0], [perfX, h]], (g) => {
    if (photo) {
      // The destination, cover-fitted, in the theme's photo treatment.
      const r = Math.max(photoW / photo.width, h / photo.height);
      const dw = photo.width * r;
      const dh = photo.height * r;
      g.save();
      g.beginPath();
      g.rect(0, 0, photoW, h);
      g.clip();
      g.filter = theme.image.filter === "none" ? "none" : theme.image.filter;
      g.drawImage(photo, (photoW - dw) / 2, (h - dh) / 2, dw, dh);
      g.filter = "none";
      g.restore();
      const frame = /(\d+(?:\.\d+)?)px solid (\S+)/.exec(theme.image.frame);
      if (frame) {
        g.strokeStyle = frame[2];
        g.lineWidth = Number(frame[1]) * 2;
        g.strokeRect(10, 10, photoW - 20, h - 20);
      }
    }

    const x1 = photoW + 48;
    const x2 = perfX - 44;
    header(g, theme, ctx.wordmark, x1, x2, 62, kindLabel(mode), mode === "lived" ? undefined : glyphMode);
    hairline(g, theme, x1, 84, x2, 84);

    // Codes, names, countries.
    const to = leg.place;
    const from = leg.from;
    setFont(g, 700, 60, theme.fonts.mono);
    g.textBaseline = "alphabetic";
    const toCode = placeCode(to.name);
    const nameFont = () => setFont(g, theme.fonts.displayWeight, 25, theme.fonts.display);
    const countryLine = (p: Place, x: number, align: "left" | "right") => {
      setFont(g, 500, 14, theme.fonts.ui);
      g.fillStyle = theme.colors.textSecondary;
      g.textAlign = align;
      const fl = flags.get(p.countryCode.toUpperCase());
      if (align === "left") {
        if (fl) flag(g, fl, x, 262, 21);
        g.fillText(p.country, x + (fl ? 29 : 0), 275);
      } else {
        g.fillText(p.country, x, 275);
        const tw = g.measureText(p.country).width;
        if (fl) flag(g, fl, x - tw - 29, 262, 21);
      }
    };
    if (from) {
      label(g, theme, t("From"), x1, 128);
      label(g, theme, t("To"), x2, 128, "right");
      const fromCode = placeCode(from.name);
      setFont(g, 700, 60, theme.fonts.mono);
      g.textAlign = "left";
      g.fillStyle = theme.colors.textPrimary;
      g.fillText(fromCode, x1, 196);
      const fw = g.measureText(fromCode).width;
      g.textAlign = "right";
      g.fillStyle = theme.colors.accent;
      g.fillText(toCode, x2, 196);
      const tw = g.measureText(toCode).width;
      connector(g, theme, glyphMode, x1 + fw + 26, x2 - tw - 26, 176);
      const half = (x2 - x1) / 2 - 12;
      nameFont();
      g.fillStyle = theme.colors.textPrimary;
      g.textAlign = "left";
      g.fillText(fit(g, from.name, half), x1, 238);
      g.textAlign = "right";
      g.fillText(fit(g, to.name, half), x2, 238);
      countryLine(from, x1, "left");
      countryLine(to, x2, "right");
    } else {
      label(g, theme, t("Destination"), x1, 128);
      setFont(g, 700, 60, theme.fonts.mono);
      g.textAlign = "left";
      g.fillStyle = theme.colors.accent;
      g.fillText(toCode, x1, 196);
      nameFont();
      g.fillStyle = theme.colors.textPrimary;
      g.fillText(fit(g, to.name, x2 - x1), x1, 238);
      countryLine(to, x1, "left");
    }

    // Fields.
    hairline(g, theme, x1, 304, x2, 304);
    const v = leg.visit;
    const when =
      leg.visitType === "lived" && v.startDate && !v.endDate
        ? t("Since {date}", { date: formatDateRange(v.startDate) })
        : formatDateRange(v.startDate, v.endDate) || t("Earlier");
    const fields: { k: string; v: string; weight: number; date?: boolean }[] = [
      { k: t("Date"), v: when, weight: 2.3, date: true },
    ];
    if (leg.days) fields.push({ k: t("Days"), v: String(leg.days), weight: 0.8 });
    fields.push({ k: t("Class"), v: visitTypeLabel(leg.visitType), weight: 1.1 });
    if (leg.visitType !== "lived") fields.push({ k: t("Company"), v: tk.withFriends ? t("With friends") : t("Solo"), weight: 1.25 });
    if (leg.season) fields.push({ k: t("Season"), v: seasonLabel(leg.season), weight: 1 });
    const total = fields.reduce((a, f) => a + f.weight, 0);
    let fx = x1;
    for (const f of fields) {
      const colW = ((x2 - x1) * f.weight) / total;
      label(g, theme, f.k, fx, 334);
      if (f.date) dateText(g, theme, f.v, fx, 364, 18, "left", colW - 14);
      else {
        setFont(g, 600, 17, theme.fonts.ui);
        g.fillStyle = theme.colors.textPrimary;
        g.textAlign = "left";
        g.fillText(fit(g, f.v, colW - 14), fx, 364);
      }
      fx += colW;
    }

    // A line of the reflection, as a quiet quote.
    if (tk.reflection) {
      setFont(g, 400, 17.5, theme.fonts.body, "italic");
      g.fillStyle = theme.colors.textSecondary;
      g.textAlign = "left";
      const lines = wrap(g, "“" + tk.reflection + "”", x2 - x1 - 18, 2);
      g.fillStyle = theme.colors.accent;
      g.fillRect(x1, 400, 2, lines.length * 26 + 2);
      g.fillStyle = theme.colors.textSecondary;
      lines.forEach((ln, i) => g.fillText(ln, x1 + 16, 420 + i * 26));
    }
    setFont(g, 500, 11, theme.fonts.mono);
    g.fillStyle = theme.colors.textTertiary;
    g.textAlign = "left";
    g.fillText(tk.number, x1, h - 30);

    // Stub.
    perforation(g, theme, perfX, 22, perfX, h - 22);
    const s1 = perfX + 34;
    const s2 = w - 32;
    rose(g, s1, 47, 16, theme.colors.textSecondary);
    setFont(g, 600, 11, theme.fonts.ui);
    tracking(g, 1.6);
    g.fillStyle = theme.colors.textSecondary;
    g.textAlign = "left";
    g.fillText(upper(ctx.wordmark), s1 + 24, 59);
    tracking(g, 0);
    setFont(g, 700, 30, theme.fonts.mono);
    g.textAlign = "left";
    g.fillStyle = theme.colors.textPrimary;
    let sx = s1;
    if (from) {
      const fc = placeCode(from.name);
      g.fillText(fc, sx, 132);
      sx += g.measureText(fc).width + 12;
      glyph(g, glyphMode, sx + 10, 121, 18, theme.colors.textSecondary, glyphMode === "plane" ? Math.PI / 2 : 0);
      sx += 32;
    }
    g.fillStyle = theme.colors.accent;
    g.fillText(toCode, sx, 132);
    label(g, theme, t("Date"), s1, 176);
    dateText(g, theme, v.startDate ? formatMonthYear(v.startDate) : t("Earlier"), s1, 200, 16, "left", s2 - s1);
    label(g, theme, t("Class"), s1, 238);
    setFont(g, 600, 15, theme.fonts.ui);
    g.fillStyle = theme.colors.textPrimary;
    g.fillText(fit(g, visitTypeLabel(leg.visitType) + (mode === "lived" ? "" : " · " + transportLabel(glyphMode)), s2 - s1), s1, 261);
    if (ctx.passenger) {
      label(g, theme, t("Passenger"), s1, 300);
      setFont(g, 600, 15, theme.fonts.ui);
      g.fillStyle = theme.colors.textPrimary;
      g.fillText(fit(g, ctx.passenger, s2 - s1), s1, 323);
    }
    barcode(g, s1, 372, s2 - s1, 70, tk.number, theme.colors.textPrimary);
    setFont(g, 500, 12, theme.fonts.mono);
    g.fillStyle = theme.colors.textSecondary;
    g.textAlign = "left";
    g.fillText(tk.number, s1, 468);
  });
}

// --- shared: itinerary rows -----------------------------------------------------

function itineraryRow(g: G, theme: AtlasTheme, leg: TicketLeg, x1: number, x2: number, y: number) {
  const v = leg.visit;
  dateText(g, theme, v.startDate ? formatMonthYear(v.startDate) : t("Earlier"), x1, y, 15, "left", 128);
  let cx = x1 + 140;
  setFont(g, 600, 16, theme.fonts.mono);
  g.textAlign = "left";
  if (leg.from && leg.visitType !== "lived") {
    g.fillStyle = theme.colors.textSecondary;
    const fc = placeCode(leg.from.name);
    g.fillText(fc, cx, y);
    cx += g.measureText(fc).width + 8;
    glyph(g, leg.mode, cx + 9, y - 6, 16, theme.colors.textSecondary, leg.mode === "plane" ? Math.PI / 2 : 0);
    cx += 26;
  }
  setFont(g, 700, 20, theme.fonts.mono);
  g.fillStyle = theme.colors.accent;
  const tc = placeCode(leg.place.name);
  g.fillText(tc, cx, y);
  const nameX = x1 + 330;
  setFont(g, theme.fonts.displayWeight, 21, theme.fonts.display);
  g.fillStyle = theme.colors.textPrimary;
  g.fillText(fit(g, leg.place.name, x2 - nameX - 190), nameX, y);
  setFont(g, 500, 13.5, theme.fonts.ui);
  g.fillStyle = theme.colors.textSecondary;
  g.textAlign = "right";
  const tail = leg.visitType === "lived" ? visitTypeLabel("lived") : transportLabel(leg.mode) + " · " + visitTypeLabel(leg.visitType);
  g.fillText(fit(g, tail, 180), x2, y);
  g.textAlign = "left";
}

function stub(
  g: G,
  theme: AtlasTheme,
  x1: number,
  x2: number,
  y: number,
  fields: { k: string; v: string }[],
  number: string
) {
  let fx = x1;
  for (const f of fields) {
    label(g, theme, f.k, fx, y + 40);
    setFont(g, 600, 17, theme.fonts.ui);
    g.fillStyle = theme.colors.textPrimary;
    g.textAlign = "left";
    g.fillText(fit(g, f.v, 150), fx, y + 66);
    fx += 170;
  }
  const bw = Math.min(330, x2 - fx - 10);
  barcode(g, x2 - bw, y + 26, bw, 56, number, theme.colors.textPrimary);
  setFont(g, 500, 12, theme.fonts.mono);
  g.fillStyle = theme.colors.textSecondary;
  g.textAlign = "right";
  g.fillText(number, x2, y + 102);
  g.textAlign = "left";
}

// --- country: outline + itinerary ----------------------------------------------

type Ring = [number, number][];

function countryPolygons(shapes: CountryShapes | null, cc: string): Ring[][] {
  const f = shapes?.features.find((x) => x.properties.ISO_A2?.toUpperCase() === cc);
  const geom = f?.geometry as { type: string; coordinates: unknown } | undefined;
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates as Ring[]];
  if (geom.type === "MultiPolygon") return geom.coordinates as Ring[][];
  return [];
}

function bbox(points: [number, number][]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; // prettier-ignore
  for (const [x, y] of points) {
    a = Math.min(a, x);
    b = Math.min(b, y);
    c = Math.max(c, x);
    d = Math.max(d, y);
  }
  return [a, b, c, d];
}

function drawOutline(g: G, theme: AtlasTheme, tk: CountryTicket, shapes: CountryShapes | null, x: number, y: number, w: number, h: number) {
  const p = theme.map.palette;
  roundRect(g, x, y, w, h, 18);
  g.fillStyle = p.water;
  g.fill();
  const cities: [number, number][] = tk.cities.map((c) => [c.coordinates.lng, c.coordinates.lat]);
  // Keep the polygons that hold the cities (France without Guiana), else the
  // largest one.
  const polys = countryPolygons(shapes, tk.countryCode);
  let keep = polys.filter((poly) => {
    const [a, b, c, d] = bbox(poly[0]);
    return cities.some(([lng, lat]) => lng >= a - 1.5 && lng <= c + 1.5 && lat >= b - 1.5 && lat <= d + 1.5);
  });
  if (keep.length === 0 && polys.length) {
    const area = (poly: Ring[]) => {
      const [a, b, c, d] = bbox(poly[0]);
      return (c - a) * (d - b);
    };
    keep = [polys.reduce((best, poly) => (area(poly) > area(best) ? poly : best))];
  }
  const pts = [...keep.flatMap((poly) => poly[0]), ...cities];
  if (pts.length === 0) return;
  const [a, b, c, d] = bbox(pts);
  const lat0 = ((b + d) / 2) * (Math.PI / 180);
  const kx = Math.cos(lat0);
  const spanX = Math.max((c - a) * kx, 0.6);
  const spanY = Math.max(d - b, 0.6);
  const pad = 42;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = x + (w - spanX * scale) / 2;
  const oy = y + (h - spanY * scale) / 2;
  const proj = (lng: number, lat: number): [number, number] => [ox + (lng - a) * kx * scale, oy + (d - lat) * scale];

  g.save();
  roundRect(g, x, y, w, h, 18);
  g.clip();
  g.beginPath();
  for (const poly of keep) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const [px, py] = proj(lng, lat);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.closePath();
    }
  }
  g.fillStyle = p.land;
  g.fill("evenodd");
  g.fillStyle = theme.countries.fill;
  g.fill("evenodd");
  g.strokeStyle = p.border;
  g.lineWidth = 1.4;
  g.stroke();
  g.restore();

  // Cities: pins with names.
  tk.cities.forEach((city, i) => {
    const [px, py] = proj(city.coordinates.lng, city.coordinates.lat);
    g.beginPath();
    g.arc(px, py, 6.5, 0, Math.PI * 2);
    g.fillStyle = i === 0 ? theme.markers.current : theme.markers.visited;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = theme.markers.visitedStroke;
    g.stroke();
    setFont(g, 600, 15, theme.fonts.ui);
    const right = px < x + w - 160;
    g.textAlign = right ? "left" : "right";
    g.lineJoin = "round";
    g.lineWidth = 4;
    g.strokeStyle = theme.markers.labelHalo;
    const tx = right ? px + 13 : px - 13;
    g.strokeText(city.name, tx, py + 5);
    g.fillStyle = theme.markers.label;
    g.fillText(city.name, tx, py + 5);
  });
  g.textAlign = "left";
}

async function drawCountry(tk: CountryTicket, ctx: TicketContext): Promise<Blob> {
  const { theme } = ctx;
  const w = 1000;
  const rowH = 58;
  const listTop = 726;
  const legs = tk.legs.slice(0, 12);
  const perfY = listTop + legs.length * rowH + (tk.legs.length > legs.length ? 40 : 14);
  const h = perfY + 150;
  const flags = await flagImages([tk.countryCode, ...tk.legs.map((l) => l.from?.countryCode ?? "")]);
  return compose(theme, w, h, [[0, perfY], [w, perfY]], (g) => {
    const x1 = 52;
    const x2 = w - 52;
    header(g, theme, ctx.wordmark, x1, x2, 66, t("Country pass"));
    hairline(g, theme, x1, 90, x2, 90);
    flag(g, flags.get(tk.countryCode), x1, 120, 57);
    setFont(g, theme.fonts.displayWeight, 58, theme.fonts.display);
    g.fillStyle = theme.colors.textPrimary;
    g.textAlign = "left";
    g.fillText(fit(g, tk.country, x2 - x1 - 80), x1 + 76, 166);
    setFont(g, 500, 16, theme.fonts.ui);
    g.fillStyle = theme.colors.textSecondary;
    const sub = [
      tn(tk.cities.length, "{n} place", "{n} places"),
      tn(tk.legs.length, "{n} visit", "{n} visits"),
      tk.since ? t("Since {year}", { year: tk.since }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    g.fillText(sub, x1 + 76, 200);
    drawOutline(g, theme, tk, ctx.countries, x1, 236, x2 - x1, 440);
    label(g, theme, t("Itinerary"), x1, 716);
    legs.forEach((leg, i) => {
      const y = listTop + i * rowH + 34;
      itineraryRow(g, theme, leg, x1, x2, y);
      if (i < legs.length - 1) hairline(g, theme, x1, y + 22, x2, y + 22);
    });
    if (tk.legs.length > legs.length) {
      setFont(g, 500, 14, theme.fonts.ui);
      g.fillStyle = theme.colors.textSecondary;
      g.fillText(tn(tk.legs.length - legs.length, "+ {n} more visit", "+ {n} more visits"), x1, listTop + legs.length * rowH + 26);
    }
    perforation(g, theme, 24, perfY, w - 24, perfY);
    const fields = [
      ...(ctx.passenger ? [{ k: t("Passenger"), v: ctx.passenger }] : []),
      { k: t("Country"), v: tk.countryCode },
      { k: t("Places"), v: String(tk.cities.length) },
    ];
    stub(g, theme, x1, x2, perfY, fields, tk.number);
  });
}

// --- journey: the atlas pass -----------------------------------------------------

async function drawJourney(tk: JourneyTicket, ctx: TicketContext): Promise<Blob> {
  const { theme } = ctx;
  const w = 1000;
  const rowH = 58;
  const codes = tk.facts.countries;
  const perRow = 13;
  const flagRows = Math.max(1, Math.ceil(codes.length / perRow));
  const flagsTop = 332;
  const listLabel = flagsTop + flagRows * 46 + 30;
  const listTop = listLabel + 10;
  const legs = tk.legs.slice(0, 10);
  const perfY = listTop + legs.length * rowH + (tk.legs.length > legs.length ? 40 : 14);
  const h = perfY + 150;
  const flags = await flagImages([...codes, tk.home?.countryCode ?? ""]);
  return compose(theme, w, h, [[0, perfY], [w, perfY]], (g) => {
    const x1 = 52;
    const x2 = w - 52;
    header(g, theme, ctx.wordmark, x1, x2, 66, t("Atlas pass"));
    hairline(g, theme, x1, 90, x2, 90);
    setFont(g, theme.fonts.displayWeight, 60, theme.fonts.display);
    g.fillStyle = theme.colors.textPrimary;
    g.textAlign = "left";
    g.fillText(fit(g, ctx.wordmark, x2 - x1), x1, 166);
    setFont(g, 500, 16, theme.fonts.ui);
    g.fillStyle = theme.colors.textSecondary;
    g.fillText(atlasFactsLine(tk.facts, false) + " · " + tn(tk.legs.length, "{n} journey", "{n} journeys"), x1, 200);

    if (tk.home) {
      label(g, theme, t("Home base"), x1, 246);
      setFont(g, 700, 22, theme.fonts.mono);
      g.fillStyle = theme.colors.accent;
      const hc = placeCode(tk.home.name);
      g.fillText(hc, x1, 278);
      const cw = g.measureText(hc).width;
      setFont(g, theme.fonts.displayWeight, 22, theme.fonts.display);
      g.fillStyle = theme.colors.textPrimary;
      const hn = fit(g, tk.home.name, 520);
      g.fillText(hn, x1 + cw + 14, 278);
      flag(g, flags.get(tk.home.countryCode.toUpperCase()), x1 + cw + 14 + g.measureText(hn).width + 12, 262, 24);
    }

    label(g, theme, t("Countries"), x1, flagsTop - 12);
    codes.forEach((cc, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      flag(g, flags.get(cc.toUpperCase()), x1 + col * 69, flagsTop + row * 46, 54);
    });

    label(g, theme, t("Itinerary"), x1, listLabel);
    legs.forEach((leg, i) => {
      const y = listTop + i * rowH + 34;
      itineraryRow(g, theme, leg, x1, x2, y);
      if (i < legs.length - 1) hairline(g, theme, x1, y + 22, x2, y + 22);
    });
    if (tk.legs.length > legs.length) {
      setFont(g, 500, 14, theme.fonts.ui);
      g.fillStyle = theme.colors.textSecondary;
      g.fillText(tn(tk.legs.length - legs.length, "+ {n} more journey", "+ {n} more journeys"), x1, listTop + legs.length * rowH + 26);
    }
    perforation(g, theme, 24, perfY, w - 24, perfY);
    const fields = [
      ...(ctx.passenger ? [{ k: t("Passenger"), v: ctx.passenger }] : []),
      ...(tk.facts.since ? [{ k: t("Since"), v: String(tk.facts.since) }] : []),
      { k: t("Countries"), v: String(codes.length) },
    ];
    stub(g, theme, x1, x2, perfY, fields, tk.number);
  });
}

export async function renderTicket(ticket: Ticket, ctx: TicketContext): Promise<Blob> {
  await loadFonts(ctx.theme);
  if (ticket.kind === "trip") return drawTrip(ticket, ctx);
  if (ticket.kind === "country") return drawCountry(ticket, ctx);
  return drawJourney(ticket, ctx);
}
