# Yu's Atlas

A local-first personal travel atlas centered on **space, time, memory, and future
travel inspiration**. Phase 1 built the working foundation (Next.js + TypeScript
frontend, Go local runtime, JSON-backed storage, repository abstraction, local
API, Photon geocoding). Phase 2 adds the fullscreen MapLibre Hero Map with
data-driven markers, a distinct current-location marker, visited-country
polygons, hover/focus previews, and Light/Night theme foundations.

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

## Phase 1–2 scope

**Phase 1 (foundation):** repository structure, domain types, sample JSON data,
repository abstraction, Go runtime, local API, geocoding-provider abstraction,
Photon search, geocoding cache/proxy, static frontend serving, browser
auto-launch, minimal dev UI.

**Phase 2 (hero map):** fullscreen MapLibre hero map, data-driven
visited-location markers, a visually distinct current-location marker, subtle
visited-country polygon/outline layer derived from `countryCode`, hover/focus
preview cards, Light/Night theme tokens + map styles, theme toggle.

Explicitly **not** implemented yet (Phase 3+): scroll-driven map collapse,
Journey Timeline, seasonal Timeline behavior, Where Next, Place Detail Sheet,
Profile Drawer, Manage Atlas redesign, `.yuatlas` import/export, LAN mode.
