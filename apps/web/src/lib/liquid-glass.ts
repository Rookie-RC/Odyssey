// Liquid glass refraction. Every `.atlas-glass` element is a frosted, tinted
// pane (styles/glass.css); where the engine can run an SVG filter inside
// backdrop-filter (Chromium: Chrome, Edge, the Windows default), the pane also
// bends what lies beneath it at its rim, the way a thick, rounded piece of
// glass does. The bend comes from a displacement map drawn per element size
// from the rounded-rect distance field. Elsewhere the pane stays frosted.

const SVG_NS = "http://www.w3.org/2000/svg";
const GLASS = ".atlas-glass";

export function supportsRefraction(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData
    ?.brands;
  if (brands?.some((b) => b.brand === "Chromium")) return true;
  return /\bChrome\/\d+/.test(navigator.userAgent);
}

/** Displacement map for a w×h rounded rectangle of radius r. Within `bezel`
 * px of the rim each pixel samples the backdrop from further inside — most at
 * the very edge, easing to nothing — so the rim magnifies and curves what lies
 * beneath, while the centre stays true. R/G encode x/y around 128. */
export function displacementMap(w: number, h: number, r: number, bezel: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const hx = w / 2;
  const hy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx;
      const py = y + 0.5 - hy;
      const qx = Math.abs(px) - (hx - r);
      const qy = Math.abs(py) - (hy - r);
      let dist: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy);
        dist = l - r;
        nx = qx / l;
        ny = qy / l;
      } else if (qx > qy) {
        dist = qx - r;
        nx = 1;
        ny = 0;
      } else {
        dist = qy - r;
        nx = 0;
        ny = 1;
      }
      if (px < 0) nx = -nx;
      if (py < 0) ny = -ny;
      const t = Math.min(1, Math.max(0, -dist / bezel));
      const m = (1 - t) * (1 - t);
      const i = (y * w + x) * 4;
      data[i] = 128 - nx * m * 127;
      data[i + 1] = 128 - ny * m * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

function radiusOf(el: HTMLElement, w: number, h: number): number {
  const raw = getComputedStyle(el).borderTopLeftRadius;
  const n = parseFloat(raw);
  const r = raw.endsWith("%") ? (Math.min(w, h) * n) / 100 : n;
  return Math.max(0, Math.min(Number.isFinite(r) ? r : 0, w / 2, h / 2));
}

export interface LiquidGlass {
  /** Redraws every pane for a new theme (refraction strength, corner radii). */
  update(refraction: number): void;
  stop(): void;
}

/** Watches the document for glass panes (added, removed, resized) and keeps
 * each one's refraction filter in step with its size. */
export function startLiquidGlass(initialRefraction: number): LiquidGlass {
  let refraction = initialRefraction;
  const enabled = supportsRefraction();
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  document.body.appendChild(svg);
  // size key → filter id, resolved once its displacement map has decoded.
  // Chromium does not re-run a backdrop filter when an feImage finishes
  // loading, so a pane only points at a filter whose map is already there.
  const filters = new Map<string, Promise<string>>();
  let seq = 0;
  let generation = 0;

  const filterFor = (w: number, h: number, r: number): Promise<string> => {
    const bezel = Math.round(Math.max(5, Math.min(16, Math.min(w, h) * 0.32)));
    const key = `${w}x${h}r${Math.round(r)}b${bezel}s${refraction}`;
    const known = filters.get(key);
    if (known) return known;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.putImageData(displacementMap(w, h, r, bezel), 0, 0);
    const url = canvas.toDataURL();
    const id = "atlas-glass-" + ++seq;
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(w));
    filter.setAttribute("height", String(h));
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const image = document.createElementNS(SVG_NS, "feImage");
    image.setAttribute("href", url);
    image.setAttribute("x", "0");
    image.setAttribute("y", "0");
    image.setAttribute("width", String(w));
    image.setAttribute("height", String(h));
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("result", "map");
    const disp = document.createElementNS(SVG_NS, "feDisplacementMap");
    disp.setAttribute("in", "SourceGraphic");
    disp.setAttribute("in2", "map");
    disp.setAttribute("scale", String(refraction * 2));
    disp.setAttribute("xChannelSelector", "R");
    disp.setAttribute("yChannelSelector", "G");
    filter.append(image, disp);
    svg.appendChild(filter);
    const probe = new Image();
    probe.src = url;
    const ready = probe
      .decode()
      .catch(() => {})
      .then(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))))
      .then(() => id);
    filters.set(key, ready);
    return ready;
  };

  const frost = "blur(var(--glass-blur)) saturate(var(--glass-saturate))";
  // With refraction the pane frosts far less, so the bent rim stays visible
  // (as with Apple's clear glass); the tint carries legibility.
  const refracted = (id: string) =>
    `url(#${id}) blur(calc(var(--glass-blur) * 0.4)) saturate(var(--glass-saturate))`;
  const pendingFor = new WeakMap<HTMLElement, number>();
  const apply = (el: HTMLElement) => {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const ticket = ++seq;
    pendingFor.set(el, ticket);
    if (!enabled || refraction <= 0 || w < 8 || h < 8) {
      el.style.removeProperty("--glass-filter");
      return;
    }
    const gen = generation;
    const current = () => pendingFor.get(el) === ticket && gen === generation;
    filterFor(w, h, radiusOf(el, w, h)).then((id) => {
      if (!current()) return; // a newer size or theme superseded this request
      const value = refracted(id);
      el.style.setProperty("--glass-filter", value);
      // Chromium fetches an feImage on the filter's first use and does not
      // repaint the backdrop once it arrives: re-apply the filter shortly
      // after (one frame of plain frost in between forces a rebuild).
      window.setTimeout(() => {
        if (!current()) return;
        el.style.setProperty("--glass-filter", frost);
        requestAnimationFrame(() => {
          if (current()) el.style.setProperty("--glass-filter", value);
        });
      }, 180);
    });
  };

  const resize = new ResizeObserver((entries) => {
    for (const e of entries) apply(e.target as HTMLElement);
  });
  const watched = new Set<HTMLElement>();
  const watch = (el: HTMLElement) => {
    if (watched.has(el)) return;
    watched.add(el);
    resize.observe(el);
  };
  const scan = (root: ParentNode) => {
    if (root instanceof HTMLElement && root.matches(GLASS)) watch(root);
    root.querySelectorAll<HTMLElement>(GLASS).forEach(watch);
  };
  const mutations = new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) scan(n);
      });
      // A class toggled onto an existing element (e.g. a glass variant).
      if (rec.type === "attributes" && rec.target instanceof HTMLElement && rec.target.matches(GLASS)) {
        watch(rec.target);
      }
    }
    for (const el of watched) {
      if (!el.isConnected) {
        resize.unobserve(el);
        watched.delete(el);
      }
    }
  });
  scan(document.body);
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  return {
    update(px: number) {
      refraction = px;
      generation++;
      filters.clear();
      svg.replaceChildren();
      watched.forEach(apply);
    },
    stop() {
      mutations.disconnect();
      resize.disconnect();
      watched.forEach((el) => el.style.removeProperty("--glass-filter"));
      watched.clear();
      svg.remove();
    },
  };
}
