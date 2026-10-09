// "Save map as image": composes a poster of the Hero Map as it looks right
// now — the WebGL basemap (relief, country wash, routes), the visited pins and
// their visible labels redrawn in the theme's colours, and a caption band with
// the wordmark and a quiet line of facts. Everything is drawn locally on a 2D
// canvas; nothing is uploaded anywhere.
import type maplibregl from "maplibre-gl";
import type { AtlasTheme } from "../themes";
import { markerHasFlag, type MapMarker, type WishMarker } from "./map-data";

export interface PosterInput {
  map: maplibregl.Map;
  markers: MapMarker[];
  /** Wishlist pins, when that layer is shown. */
  wishes: WishMarker[];
  /** placeId → label placement chosen by the on-screen collision layout. */
  labelSides: Map<string, "left" | "right" | null>;
  theme: AtlasTheme;
  title: string;
  subtitle: string;
}

/** Grabs the WebGL canvas inside a render callback (the drawing buffer is only
 * guaranteed intact during the frame, as preserveDrawingBuffer is off). */
function captureMap(map: maplibregl.Map): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    map.once("render", () => {
      try {
        const url = map.getCanvas().toDataURL("image/png");
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("could not read the map image"));
        img.src = url;
      } catch (e) {
        reject(e);
      }
    });
    map.triggerRepaint();
  });
}

// Built on first use: Path2D exists only in the browser, and this module is
// also imported (for downloadBlob) by components rendered on the server.
const STAR_PATH = "M12 2.6l2.85 5.95 6.55.8-4.83 4.5 1.25 6.5L12 17.15 6.18 20.35l1.25-6.5L2.6 9.35l6.55-.8z";
let star: Path2D | null = null;

/** The country flags planted on visited places (same files as on screen). */
async function loadFlags(codes: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    codes.map(
      (cc) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            out.set(cc, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = "/flags/" + cc + ".svg";
        })
    )
  );
  return out;
}

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  halo: string,
  width: number
) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = halo;
  ctx.lineWidth = width;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export async function renderPoster(input: PosterInput): Promise<Blob> {
  const { map, markers, wishes, labelSides, theme, title, subtitle } = input;
  const ui = theme.fonts.ui;
  const display = theme.fonts.display;
  await Promise.all([
    document.fonts.load(`600 26px ${ui}`),
    document.fonts.load(`${theme.fonts.displayWeight} 40px ${display}`),
  ]).catch(() => {});

  const flags = await loadFlags(
    Array.from(new Set(markers.filter(markerHasFlag).map((m) => m.place.countryCode.toUpperCase())))
  );
  const base = await captureMap(map);
  const canvas = map.getCanvas();
  const dpr = canvas.width / canvas.clientWidth || 1;
  const W = canvas.width;
  const H = canvas.height;
  const band = Math.round(120 * dpr);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H + band;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  ctx.drawImage(base, 0, 0, W, H);

  // Soft vignette, echoing the on-screen tint.
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.35, W / 2, H * 0.42, Math.max(W, H) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, theme.mode === "dark" ? "rgba(0,0,0,0.35)" : "rgba(80,60,30,0.14)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  const s = dpr;

  // Wishlist pins first (beneath the visited ones): a star in a soft ring.
  ctx.textBaseline = "middle";
  for (const w of wishes) {
    const p = map.project([w.place.coordinates.lng, w.place.coordinates.lat]);
    const x = p.x * s;
    const y = p.y * s;
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    ctx.beginPath();
    ctx.arc(x, y, 11.5 * s, 0, Math.PI * 2);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = theme.markers.wish;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, 8.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = theme.colors.surface;
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = theme.markers.wish;
    ctx.stroke();
    ctx.save();
    ctx.translate(x - 5 * s, y - 5 * s);
    ctx.scale((10 / 24) * s, (10 / 24) * s);
    ctx.fillStyle = theme.markers.wish;
    ctx.fill((star ??= new Path2D(STAR_PATH)));
    ctx.restore();
    ctx.textAlign = "left";
    ctx.font = `italic 550 ${12.5 * s}px ${ui}`;
    haloText(ctx, w.place.name, x + 13 * s, y, theme.markers.wish, theme.markers.labelHalo, 4 * s);
  }

  // Pins, weakest first so the current base ends on top.
  const ordered = [...markers].sort((a, b) => a.rank - b.rank);
  ctx.textBaseline = "middle";
  for (const m of ordered) {
    const p = map.project([m.place.coordinates.lng, m.place.coordinates.lat]);
    const x = p.x * s;
    const y = p.y * s;
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    if (m.isCurrent) {
      ctx.beginPath();
      ctx.arc(x, y, 17 * s, 0, Math.PI * 2);
      ctx.fillStyle = theme.markers.currentGlow;
      ctx.fill();
      ctx.lineWidth = 1.5 * s;
      ctx.strokeStyle = theme.markers.currentRing;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 7 * s, 0, Math.PI * 2);
      ctx.fillStyle = theme.mode === "dark" ? theme.markers.visitedStroke : theme.markers.current;
      ctx.fill();
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = theme.mode === "dark" ? theme.markers.current : theme.markers.visitedStroke;
      ctx.stroke();
    } else {
      const flag = markerHasFlag(m) ? flags.get(m.place.countryCode.toUpperCase()) : undefined;
      if (flag) {
        // Pole rising from the pin, the flag at its top.
        ctx.fillStyle = theme.markers.visited;
        ctx.fillRect(x - 0.65 * s, y - 22 * s, 1.3 * s, 20 * s);
        ctx.drawImage(flag, x + 0.65 * s, y - 22 * s, 13 * s, 9 * s);
        ctx.lineWidth = 0.5 * s;
        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.strokeRect(x + 0.65 * s, y - 22 * s, 13 * s, 9 * s);
      }
      const r = (m.visitType === "transit" ? 3 : m.visitType === "stopover" || m.visitType === "day_trip" ? 4.5 : 5.5) * s;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = m.visitType === "stopover" ? theme.markers.visitedStroke : theme.markers.visited;
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = m.visitType === "stopover" ? theme.markers.visited : theme.markers.visitedStroke;
      ctx.stroke();
    }

    const side = labelSides.get(m.place.id) ?? (m.isCurrent ? "right" : null);
    if (!side) continue;
    const off = (m.isCurrent ? 18 : 11) * s;
    ctx.textAlign = side === "right" ? "left" : "right";
    const lx = side === "right" ? x + off : x - off;
    ctx.font = `${m.isCurrent ? 650 : 550} ${(m.isCurrent ? 16 : 13) * s}px ${ui}`;
    haloText(ctx, m.place.name, lx, m.isCurrent ? y - 5 * s : y, theme.markers.label, theme.markers.labelHalo, 4 * s);
    if (m.isCurrent) {
      ctx.font = `600 ${10.5 * s}px ${ui}`;
      haloText(ctx, m.place.country.toUpperCase(), lx, y + 11 * s, theme.colors.textSecondary, theme.markers.labelHalo, 3 * s);
    }
  }

  // Caption band.
  ctx.fillStyle = theme.colors.bg;
  ctx.fillRect(0, H, W, band);
  ctx.fillStyle = theme.colors.border;
  ctx.fillRect(0, H, W, Math.max(1, s));
  const pad = 40 * s;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = theme.colors.textPrimary;
  ctx.font = `${theme.fonts.displayWeight} ${38 * s}px ${display}`;
  ctx.fillText(title, pad, H + band / 2 + 6 * s);
  ctx.textAlign = "right";
  ctx.fillStyle = theme.colors.textSecondary;
  ctx.font = `500 ${15 * s}px ${ui}`;
  ctx.fillText(subtitle, W - pad, H + band / 2 + 4 * s);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), "image/png")
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
