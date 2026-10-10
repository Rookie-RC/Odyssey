// Small line-icon set (1.5px strokes on a 20px grid, currentColor) so the
// Atlas carries one consistent, quiet icon language across every theme —
// never emoji, never a generic tourism icon pack (VISUAL_SPEC §29).
import type { Activity, InspirationType, Season, Transport } from "../lib/types";
import { TRANSPORT_GLYPH } from "../lib/transport";
import { ACTIVITY_GLYPH, OVERNIGHT_GLYPH } from "../lib/activity";

type IconProps = { size?: number; className?: string; title?: string; strokeWidth?: number };

function Svg({
  size = 16,
  className,
  title,
  strokeWidth = 1.5,
  children,
  fill = "none",
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** The wordmark's compass rose: an eight-point star, long N/S/E/W rays. */
export function CompassRose({ size = 22, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <g fill="currentColor">
        <path d="M16 1.5 18 14 16 16 14 14Z" />
        <path d="M16 30.5 14 18 16 16 18 18Z" opacity="0.55" />
        <path d="M30.5 16 18 18 16 16 18 14Z" opacity="0.55" />
        <path d="M1.5 16 14 14 16 16 14 18Z" />
        <path d="M25.5 6.5 17.3 15.2 16 16 16.8 14.7Z" opacity="0.4" />
        <path d="M6.5 25.5 14.7 16.8 16 16 15.2 17.3Z" opacity="0.4" />
        <path d="M25.5 25.5 16.8 17.3 16 16 17.3 16.8Z" opacity="0.4" />
        <path d="M6.5 6.5 15.2 14.7 16 16 14.7 15.2Z" opacity="0.4" />
      </g>
      <circle cx="16" cy="16" r="6.2" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}

export function SeasonIcon({ season, ...p }: IconProps & { season: Season }) {
  switch (season) {
    case "spring":
      return (
        <Svg {...p}>
          <path d="M10 17.5V9.5" />
          <path d="M10 11c0-3.2 2.2-5.6 5.6-5.6 0 3.3-2.3 5.6-5.6 5.6Z" />
          <path d="M10 13.2c0-2.6-1.9-4.6-4.7-4.6 0 2.7 1.9 4.6 4.7 4.6Z" />
        </Svg>
      );
    case "summer":
      return (
        <Svg {...p}>
          <circle cx="10" cy="10" r="3.4" />
          <path d="M10 2.2v1.9M10 15.9v1.9M2.2 10h1.9M15.9 10h1.9M4.5 4.5l1.3 1.3M14.2 14.2l1.3 1.3M4.5 15.5l1.3-1.3M14.2 5.8l1.3-1.3" />
        </Svg>
      );
    case "autumn":
      return (
        <Svg {...p}>
          <path d="M10 17.8v-4.3" />
          <path d="M10 13.5 5.2 11.6l1-1.6-2.6-2.1 2.5-.5-.6-2.6 2.6 1.2L10 2.6l1.9 3.4 2.6-1.2-.6 2.6 2.5.5-2.6 2.1 1 1.6Z" />
        </Svg>
      );
    case "winter":
      return (
        <Svg {...p}>
          <path d="M10 2.2v15.6M3.2 6.1l13.6 7.8M3.2 13.9l13.6-7.8" />
          <path d="m8.2 3.6 1.8 1.6 1.8-1.6M8.2 16.4l1.8-1.6 1.8 1.6M3.5 8.5l2.4-.4-.8-2.3M16.5 11.5l-2.4.4.8 2.3M3.5 11.5l2.4.4-.8 2.3M16.5 8.5l-2.4-.4.8-2.3" />
        </Svg>
      );
  }
}

export const PinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 18s5.6-5.3 5.6-9.6A5.6 5.6 0 0 0 4.4 8.4C4.4 12.7 10 18 10 18Z" />
    <circle cx="10" cy="8.4" r="2" />
  </Svg>
);

export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="7" r="2.6" />
    <path d="M2.6 16.2c.5-2.6 2.5-4.2 4.9-4.2s4.4 1.6 4.9 4.2" />
    <path d="M13 4.7a2.6 2.6 0 0 1 0 5" />
    <path d="M14.6 12.3c1.5.5 2.5 1.9 2.8 3.9" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.2" width="14" height="12.6" rx="2" />
    <path d="M3 8.2h14M7 2.6v3M13 2.6v3" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
  </Svg>
);

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.5 4.5 7 10l5.5 5.5" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 7.5 5.5 5.5 5.5-5.5" />
  </Svg>
);

export const ArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 10h12.5M11.5 5.5 16 10l-4.5 4.5" />
  </Svg>
);

export const ArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 10H4M8.5 5.5 4 10l4.5 4.5" />
  </Svg>
);

export const LongArrowLeft = (p: IconProps) => (
  <svg viewBox="0 0 40 12" width={p.size ?? 32} height={((p.size ?? 32) * 12) / 40} className={p.className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M38 6H2.5M7 1.5 2.5 6 7 10.5" />
  </svg>
);

export const LongArrowRight = (p: IconProps) => (
  <svg viewBox="0 0 40 12" width={p.size ?? 32} height={((p.size ?? 32) * 12) / 40} className={p.className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6h35.5M33 1.5 37.5 6 33 10.5" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4v12M4 10h12" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10h12" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Svg>
);

export const RecenterIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="5.4" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <path d="M10 1.8v2.6M10 15.6v2.6M1.8 10h2.6M15.6 10h2.6" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m10 3 7.5 4L10 11 2.5 7Z" />
    <path d="m2.5 10.5 7.5 4 7.5-4" />
    <path d="m2.5 13.8 7.5 4 7.5-4" />
  </Svg>
);

export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8.8" cy="8.8" r="5.3" />
    <path d="m12.8 12.8 4 4" />
  </Svg>
);

export const PaletteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.6a7.4 7.4 0 0 0 0 14.8c1.1 0 1.6-.8 1.3-1.7-.4-1.2.2-2.3 1.5-2.3h1.8a2.8 2.8 0 0 0 2.8-2.8c0-4.4-3.3-8-7.4-8Z" />
    <circle cx="6.4" cy="9.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="8.6" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.4" cy="6.2" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const SunMoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3a7 7 0 1 0 7 7 5.4 5.4 0 0 1-7-7Z" />
  </Svg>
);

export const RouteIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.6" cy="14.6" r="1.9" />
    <circle cx="15.4" cy="5.4" r="1.9" />
    <path d="M6.2 13.4c3.4-.6 2.1-5.8 5.6-6.8" strokeDasharray="1.6 2" />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor" strokeWidth={0}>
    <path d="M10 17.2s-6.8-4.1-6.8-9a3.8 3.8 0 0 1 6.8-2.3 3.8 3.8 0 0 1 6.8 2.3c0 4.9-6.8 9-6.8 9Z" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m10 2.8 2.1 4.5 4.9.6-3.6 3.4.9 4.9L10 13.8l-4.3 2.4.9-4.9L3 7.9l4.9-.6Z" />
  </Svg>
);

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.8 3.9 16.1 7.2 7.3 16H4v-3.3Z" />
    <path d="m11 5.7 3.3 3.3" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4H4.5v11.5H16V12" />
    <path d="M11 3.5h5.5V9M16.5 3.5 9 11" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.6" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </Svg>
);

export const ImageIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.8" y="3.8" width="14.4" height="12.4" rx="2" />
    <circle cx="7.3" cy="8.2" r="1.4" />
    <path d="m3.2 14.6 4.2-4 3 2.8 2.6-2.4 4 3.6" />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 12.2V2.8" />
    <path d="M6.6 6.1 10 2.7l3.4 3.4" />
    <path d="M6.4 9H5.2a1.8 1.8 0 0 0-1.8 1.8v4.6a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8v-4.6A1.8 1.8 0 0 0 14.8 9h-1.2" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.8v9.4" />
    <path d="M6.6 8.9 10 12.3l3.4-3.4" />
    <path d="M3.4 13.6v1.8a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8v-1.8" />
  </Svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.6" y="6.6" width="10.2" height="10.2" rx="1.8" />
    <path d="M13.4 6.6V5a1.8 1.8 0 0 0-1.8-1.8H5A1.8 1.8 0 0 0 3.2 5v6.6A1.8 1.8 0 0 0 5 13.4h1.6" />
  </Svg>
);

/** A ticket with its tear-off stub. */
export const TicketIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5.6A1.6 1.6 0 0 1 4.6 4h10.8A1.6 1.6 0 0 1 17 5.6v2a2.4 2.4 0 0 0 0 4.8v2a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 14.4v-2a2.4 2.4 0 0 0 0-4.8z" />
    <path d="M12.4 4.6v1.4M12.4 9.3v1.4M12.4 14v1.4" />
  </Svg>
);

export const CompassIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.4" />
    <path d="m12.9 7.1-1.6 4.2-4.2 1.6 1.6-4.2Z" />
  </Svg>
);

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 9.2 10 3.8l6.5 5.4" />
    <path d="M5.2 8v8.2h9.6V8" />
  </Svg>
);

export function InspirationIcon({ type, ...p }: IconProps & { type: InspirationType }) {
  switch (type) {
    case "video":
    case "movie":
      return (
        <Svg {...p} fill="currentColor" strokeWidth={0}>
          <path d="M6.5 4.6v10.8L15.5 10Z" />
        </Svg>
      );
    case "book":
      return (
        <Svg {...p}>
          <path d="M10 5.2C8.4 4 6 3.6 3.2 3.9v11.4c2.8-.3 5.2.1 6.8 1.3 1.6-1.2 4-1.6 6.8-1.3V3.9C14 3.6 11.6 4 10 5.2Z" />
          <path d="M10 5.2v11.4" />
        </Svg>
      );
    case "music":
      return (
        <Svg {...p}>
          <path d="M8 14.6V4.4l8-1.6v10" />
          <circle cx="5.8" cy="14.6" r="2.2" />
          <circle cx="13.8" cy="12.8" r="2.2" />
        </Svg>
      );
    case "photo":
      return <ImageIcon {...p} />;
    case "friend":
      return <PeopleIcon {...p} />;
    case "article":
      return (
        <Svg {...p}>
          <rect x="3.6" y="2.8" width="12.8" height="14.4" rx="1.6" />
          <path d="M6.6 6.6h6.8M6.6 9.6h6.8M6.6 12.6h4.2" />
        </Svg>
      );
    case "social_media":
      return (
        <Svg {...p}>
          <path d="M4 15.6V5.2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6.4a2 2 0 0 1-2 2H7.2Z" />
        </Svg>
      );
    default:
      return <StarIcon {...p} />;
  }
}

/** Vehicle silhouette for a trip's transport (the same glyph as on the map's
 * routes; filled, as it must read at small sizes). */
export function TransportIcon({ mode, size = 16, className }: { mode: Transport } & IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={TRANSPORT_GLYPH[mode]} />
    </svg>
  );
}

/** What a trip was for (lib/activity.ts): the same glyph as on its map pin. */
export function ActivityIcon({ activity, ...p }: IconProps & { activity: Activity | "overnight" }) {
  const glyph = activity === "overnight" ? OVERNIGHT_GLYPH : ACTIVITY_GLYPH[activity];
  return (
    <Svg {...p}>
      {/* A static constant from lib/activity.ts, never user content. */}
      <g dangerouslySetInnerHTML={{ __html: glyph }} />
    </Svg>
  );
}
