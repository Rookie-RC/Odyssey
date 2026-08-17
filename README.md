# Yu's Atlas

A local-first personal travel atlas centered on **space, time, memory, and future
travel inspiration**. Phase 1 built the working foundation (Next.js + TypeScript
frontend, Go local runtime, JSON-backed storage, repository abstraction, local
API, Photon geocoding). Phase 2 adds the fullscreen MapLibre Hero Map with
data-driven markers, a distinct current-location marker, visited-country
polygons, hover/focus previews, and Light/Night theme foundations. Phase 3 adds
the scroll-driven Hero Map → Journey transition and the horizontal, draggable,
season-coloured Journey Timeline derived from domain data. Phase 4 completes the
single-page Atlas after the Journey: a Wishlist-driven **Where Next** season
shelf, a spatial **Place Detail Sheet**, the **Profile Drawer**, URL state
(`?place=… ?season=… ?profile=true`), and local media serving
(`atlas-data/media/…`) through the runtime.

> Authoritative specs: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) and
> [docs/design/VISUAL_SPEC.md](docs/design/VISUAL_SPEC.md).

## Architecture

```text
YuAtlas executable
        |
        +-- embedded frontend (Next.js static export)
        |
        +-- local HTTP server (Go, net/http)
        |
        +-- local file API  ->  atlas-data/
```

- **Frontend** (`apps/web`): Next.js 14 + TypeScript + Tailwind. Static export
  (`output: "export"`), served by the Go runtime.
- **Runtime** (`apps/runtime`): Go 1.22, `net/http`, embedded frontend assets,
  JSON read/write, geocoding proxy/cache, browser auto-launch.
- **Storage**: JSON files on disk (no database). Personal data lives in
  `atlas-data/`, separate from the application binary.

## Repository layout

```text
apps/
  web/                 Next.js frontend (src/lib: types, api, repository, geocode)
  runtime/             Go runtime (cmd/atlas, internal/{domain,storage,geocode,api,config}, assets)
docs/                  PRODUCT_SPEC.md, design/
examples/atlas-data/   sample data (data/*.json + runtime-config.json)
scripts/build.sh       one-shot full build
```

## Prerequisites

- Node.js >= 18 and pnpm
- Go >= 1.22

## Run (development)

Two terminals:

```bash
# 1. Go runtime (serves API + embedded frontend, opens browser)
go run ./apps/runtime/cmd/atlas -data examples/atlas-data
```

Without `-data`, the runtime deterministically locates an existing
`atlas-data` directory (next to the executable, then `./atlas-data`, then the
dev-tree `apps/runtime/atlas-data` / `examples/atlas-data`) and resolves it to
an **absolute** path, so the data location never depends on the working
directory. The effective path is logged at startup and exposed via
`GET /api/runtime`.

For frontend hot-reload, run the Next dev server separately. It automatically
proxies `/api/*` to the Go runtime at `http://127.0.0.1:4317` (rewrites in
`apps/web/next.config.mjs`), so no environment variable is needed:

```bash
# 2. Frontend dev server (in another terminal)
cd apps/web
pnpm dev
```

`NEXT_PUBLIC_API_BASE` still works as an override of the proxy target if the
runtime is on a non-default port.

## Run (production-style / one-click)

```bash
./scripts/build.sh
./bin/atlas -data examples/atlas-data
```

The runtime:

1. locates/creates the data directory,
2. picks port 4317 (or a free port),
3. serves the embedded frontend and the local API,
4. opens the default browser (disable with `-open-browser=false`).

```text
http://127.0.0.1:4317
```

## Build

```bash
# Frontend static export
cd apps/web && pnpm install && pnpm run build

# Copy export into the runtime embed dir, then build the binary
rm -rf apps/runtime/assets/web && cp -r apps/web/out apps/runtime/assets/web
cd apps/runtime && go build -o bin/atlas ./cmd/atlas
```

`scripts/build.sh` performs all of the above.

## Local API

| Method | Path | Description |
|---|---|---|
| GET | `/api/runtime` | runtime mode, port, data dir, provider |
| GET / PUT | `/api/profile` | read / write profile |
| GET / POST | `/api/places` | list / create places |
| PUT / DELETE | `/api/places/:id` | update / delete a place |
| GET / POST | `/api/visits` | list / create visits |
| PUT / DELETE | `/api/visits/:id` | update / delete a visit |
| GET / POST | `/api/wishlist` | list / create wishlist entries |
| PUT / DELETE | `/api/wishlist/:id` | update / delete a wishlist entry |
| GET | `/api/media` | list media |
| GET / PUT | `/api/settings` | read / write settings (theme, etc.) |
| GET | `/api/geocode/search?q=...` | online place search (normalized) |
| GET | `/api/geocode/reverse?lat=...&lng=...` | reverse geocoding |

## Domain model

- **Place** (`city | region | island | natural_area`) — countries are metadata
  (`country`, `countryCode`) and are **not** Place records; they never get pins.
- **Visit** (`lived | trip | day_trip | stopover | transit`) — references a Place.
- **Wishlist** — references a Place; seasons, target time, priority, why, inspirations.
- **Media**, **Profile**, **Settings**.

The TS domain types live in `apps/web/src/lib/types.ts`; Go mirrors them in
`apps/runtime/internal/domain/domain.go`.

## Geocoding

The frontend calls the local runtime; the runtime calls Photon (zero-key default)
through a provider-neutral interface (`internal/geocode`), normalizes responses,
filters out country-level and POI/street results, and caches searches (5 min).
Provider and credentials are machine config in `atlas-data/runtime-config.json`
(not part of portable Atlas data).

## Hero Map (Phase 2)

The default view is a fullscreen MapLibre GL map framed on Europe.

- **Markers** derive from `places.json` + `visits.json` (a place referenced by a
  Visit gets a marker; Wishlist-only places do not appear on the default map).
- **Current location** comes from `profile.currentBase.placeId` and renders as a
  distinct accent-colored marker with a subtle pulse ring.
- **Visited countries** are the distinct `countryCode`s of visited places, drawn
  as a subtle polygon fill + outline from `public/geodata/countries.geojson`
  (Natural Earth 110m). Countries are never markers or first-class Places.
- **Hover** shows a micro preview (place, country, date, visit type); **click**
  focuses the marker and reveals the expanded preview.
- **Themes** are semantic tokens (`src/themes/`) applied as CSS variables, with
  Light (Carto Positron) and Night (Carto Dark Matter) base maps and a toggle
  persisted through `settings.json`.

## Journey Timeline (Phase 3)

Scrolling past the hero map collapses it into a compact contextual strip
(140px) that stays pinned to the top, and reveals the horizontal Journey
Timeline. Scrolling back up restores the fullscreen map.

- **Timeline data is derived, never hand-maintained** (`src/lib/timeline.ts`):
  past nodes come from `visits.json`, the NOW anchor from
  `profile.currentBase.placeId`, and future nodes only from Wishlist entries
  with a `targetTime` (year and/or season).
- **Approximate Wishlist timing**: `year + season` places at that season;
  `year` only places mid-year; `season` only ("Summer, year unknown") places at
  the next occurrence of that season after NOW. No target time → not on the
  Timeline.
- **NOW positioning**: the Timeline initially pans so NOW sits at the viewport
  centre, with a "Now" tick on the line; a "future runway" keeps the open-ended
  future readable.
- **Season on the line**: the line is a gradient whose segments take each
  node's season colour (spring green / summer gold / autumn amber / winter
  blue), gently segmented at node boundaries — not large season bars.
- **Node hierarchy**: past = filled (size by visit depth), current = accent
  ring, future = outline (season-tinted). Hover focuses, click expands a
  lightweight preview (no full Detail Sheet yet).
- **Navigation**: mouse drag, trackpad, horizontal wheel, touch swipe, arrow
  keys; `prefers-reduced-motion` is respected.

## Phase 1–3 scope

**Phase 1 (foundation):** repository structure, domain types, sample JSON data,
repository abstraction, Go runtime, local API, geocoding-provider abstraction,
Photon search, geocoding cache/proxy, static frontend serving, browser
auto-launch, minimal dev UI.

**Phase 2 (hero map):** fullscreen MapLibre hero map, data-driven
visited-location markers, a visually distinct current-location marker, subtle
visited-country polygon/outline layer derived from `countryCode`, hover/focus
preview cards, Light/Night theme tokens + map styles, theme toggle.

**Phase 3 (journey):** scroll-driven Hero Map collapse into a contextual strip,
horizontal draggable Journey Timeline, derived past/current/future nodes,
season-coloured line, NOW-centred initial position, Light/Night support,
lightweight preview/focus interaction.

**Phase 4 (where next + detail + profile):** the single-page Atlas continues
after the Journey Timeline with:

- **Where Next** — a season-driven inspiration shelf (`src/components/WhereNext.tsx`).
  Every Wishlist entry is eligible (even without timing); an entry matches a
  season when it lists that season in `seasons`, or is "timeless" when it has no
  season info. Ranking is priority first, then a matching target season
  (`src/lib/domain.ts` → `getWhereNextItems`). One dominant destination plus
  smaller secondary cards — no equal card grid. Season selection also softly
  emphasises matching future Timeline nodes.
- **Place Detail Sheet** — a right-side spatial sheet (bottom sheet on small
  screens) that opens from map previews ("View memory"), Timeline previews
  ("View memory" / "View wish") and Where Next cards. Visited stories show
  date range, visit type, with-friends, photos, highlights and reflection;
  Wishlist stories show target time, why, inspirations and notes. It is a
  continuation of the Atlas, not a modal page.
- **Profile Drawer** — right drawer (`min(420px, 90vw)`) with avatar, name,
  current base, bio, interests, links, and the Manage Atlas entry point in
  local writable mode (the full Manage Atlas UI is a later phase).
- **Single overlay state** (`type ActiveOverlay = place | profile | null`):
  Place Detail and Profile are mutually exclusive and never stack.
- **URL state** (PRODUCT_SPEC §36): `/?place=…`, `/?season=…`, `/?profile=true`
  open directly and stay in sync without reloads.
- **Local media** — the runtime now serves `atlas-data/media/…` (`/media/*`,
  read-only, traversal-safe) and the dev server proxies `/media/*` to it;
  sample data ships with CC-licensed photos under `examples/atlas-data/media/`.

Explicitly **not** implemented yet (next phases): full Manage Atlas CRUD,
online place-search UI, media upload, `.yuatlas` import/export, LAN mode.
