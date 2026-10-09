// Building blocks shared by the built-in themes: font stacks and procedural
// textures. Fonts are self-hosted (@fontsource, imported in app/layout.tsx) so
// the single-file runtime renders identically offline. Every stack falls back
// to CJK system fonts, because Place names and reflections may well be Chinese.

const CJK_SANS = '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const CJK_SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif';

export const FONT = {
  inter: `"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ${CJK_SANS}`,
  newsreader: `"Newsreader Variable", Newsreader, Georgia, "Times New Roman", ${CJK_SERIF}`,
  fraunces: `"Fraunces Variable", Fraunces, Georgia, "Times New Roman", ${CJK_SERIF}`,
  instrument: `"Instrument Serif", "Newsreader Variable", Georgia, ${CJK_SERIF}`,
  cormorant: `"Cormorant Garamond", "Newsreader Variable", Georgia, ${CJK_SERIF}`,
  mono: `"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`,
};

// Fractal-noise grain as an inline SVG (no network, tiles seamlessly).
function noise(opts: { freq: number; octaves: number; alpha: number; tint?: string }): string {
  const [r, g, b] = opts.tint ? hexToRgb01(opts.tint) : [0, 0, 0];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${opts.freq}' numOctaves='${opts.octaves}' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${opts.alpha} 0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function hexToRgb01(hex: string): [string, string, string] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) =>
    v.toFixed(3)
  ) as [string, string, string];
}

export const TEXTURE = {
  /** Fine photographic grain. */
  grain: noise({ freq: 0.9, octaves: 3, alpha: 0.55 }),
  /** Softer, larger fibres: paper. */
  paper: noise({ freq: 0.55, octaves: 4, alpha: 0.5, tint: "#5a4630" }),
  /** Paper fibres faint enough to lie directly over the map canvas. */
  paperFaint: noise({ freq: 0.6, octaves: 4, alpha: 0.12, tint: "#5a4630" }),
  none: "none",
};
