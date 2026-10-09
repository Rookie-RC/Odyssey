# Yu's Atlas

A local-first personal travel atlas centered on **space, time, memory, and future
travel inspiration** — one continuous page that opens on a full-screen map of
where life has happened, collapses into a seasonal **Journey Timeline**, and
ends on **Where Next**, a photographic shelf of places still to come.

It runs as a single self-contained executable (Go runtime + embedded Next.js
frontend). Your atlas is plain JSON and photos in a folder you own, exportable
as one portable `.atlas` file.

**What's in the box**

- **Hero Map** — relief-shaded MapLibre map with collision-aware place labels,
  a pulsing current base, a memory card per place, residence-based routes,
  optional wishlist pins, and visited-country washes.
- **Journey Timeline** — past ← NOW → future on a season-coloured line, with
  photographs hanging below it and seasons named above it.
- **Where Next** — one dominant destination per season plus companions, and an
  *All ideas* board for every wish.
- **Place Detail** — reflection, highlights, every visit, inspirations, a photo
  gallery with a full-screen lightbox, prev/next through the journey.
- **Five themes + Auto** — Light, Night, Journal, Minimal and Film change colour,
  type, texture, map style, markers and photo treatment (never your data).
- **English / 简体中文** interface, ⌘K search & commands, keyboard shortcuts.
- **Save map as image** — a poster of the map as it looks right now (pins,
  labels, routes, theme) with a caption band, from the map layers menu or ⌘K.
- **Share as a ticket** — a ticket-stub image in your theme: one trip as a
  boarding pass (train / bus / drive tickets follow its transport), a country
  as a multi-city pass with its outline, or the whole journey as an atlas pass.
  From *Share* on a place, the profile (journey, or a country's flag) or ⌘K;
  download, copy or send through the system share sheet. Drawn locally.
- **Manage Atlas** — add/edit places, visits, wishes and media with online place
  search; export/import, automatic backups with one-click restore, New Atlas;
  read-only **sharing on your local network** with a QR code.

## 中文简介

Yu's Atlas 是一个本地优先的个人旅行地图集：打开即是一张全屏地图，标出生活与旅行过的地方；向下滚动，地图收成顶部的一条，下面依次是按季节着色的**旅程时间线**和**下一站**心愿墙。数据是你自己文件夹里的 JSON 与照片，可以整体导出为一个 `.atlas` 文件。程序只有一个可执行文件（Windows 下为 `Atlas.exe`），双击即用，无需安装。

- **五套主题 + 自动**：浅色、夜间（城市灯火）、手账（米色纸与墨迹）、极简（生成色与朱印）、胶片（颗粒与日期印记）。主题会改变配色、字体、纹理、地图风格与照片处理，但不改变数据。
- **地图**：去过的地点插一面小国旗，去过的国家实心着色、想去的国家斜线标出；每次旅行可选交通方式（飞机为默认、火车、大巴、自驾），路线分别画成虚线航线、铁轨、公路，中点显示对应的交通工具。
- **液态玻璃（Liquid Glass）**：浮在地图与照片之上的控件（顶栏、缩放与图层、照片上的按钮）是带高光边的玻璃，在 Chrome / Edge 中还会折射下方的地图；内容本身仍是纸面。
- **中英文界面**：在个人主页、设置或 ⌘K 中切换；日期、季节、地图地名都会随之本地化，你写下的内容保持原样。
- **⌘K 搜索与命令**、键盘快捷键（按 `?` 查看）、照片灯箱、全部心愿面板、地图图层（路线 / 心愿标记 / 国家底色）、**保存地图为图片**。
- **票根分享**：把一次旅程做成登机牌（火车、大巴、自驾会变成对应的车票），把一个国家的所有城市做成带国家轮廓的通行证，或把整段旅程做成地图集通行证；配色字体随当前主题。入口在地点详情的「分享」、个人主页（整个旅程或点国旗）和 ⌘K；可下载、复制或调用系统分享。图片在本机生成，不会上传。
- **管理地图集**：在线搜索地点添加到访与心愿、上传照片、导入导出、自动备份与一键恢复、**局域网只读共享**（附二维码）。

开发：`cd apps/runtime && go run ./cmd/atlas -data ../../examples/atlas-data` 与 `cd apps/web && pnpm dev`；构建：`./scripts/build.sh`；测试：`pnpm test` 与 `go test ./...`。

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
  web/                         Next.js frontend
    src/components/            Atlas UI (HeroMap, JourneyTimeline, WhereNext, PlaceDetailSheet,
                               ProfileDrawer, IdeasBoard, CommandPalette, …) + manage/ + edit/
    src/lib/                   domain layer: types, api, repository, timeline, routes, map-data,
                               map-style (theme → basemap adapter), i18n (+ zh dictionaries)
    src/themes/                theme contract + light / night / journal / minimal / film
    src/styles/                base, topbar, map, journey, wherenext, overlays, palette, manage
    scripts/copy-flags.mjs     copies SVG country flags into public/flags (dev/build)
  runtime/                     Go runtime: cmd/atlas, internal/{api,atlas,config,domain,
                               geocode,lan,media,storage}, assets (embedded frontend)
docs/                          PRODUCT_SPEC.md, design/ (VISUAL_SPEC, references, Claude Design export)
examples/atlas-data/           sample data (data/*.json, CC-licensed photos, runtime-config.json)
scripts/build.sh               one-shot full build (frontend export → embed → native + Windows)
```

## Prerequisites

- Node.js >= 18 and pnpm
- Go >= 1.22

## Run (development)

Two terminals:

```bash
# 1. Go runtime (serves API + embedded frontend, opens browser)
cd apps/runtime && go run ./cmd/atlas -data ../../examples/atlas-data
```

In development always pass `-data examples/atlas-data`. Without `-data`, the
runtime uses the **portable** default location (see “Data directory” below),
not the sample data. The effective path is logged at startup and exposed via
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

### Tests

```bash
cd apps/web && pnpm test        # Vitest: timeline, routes, map data, map-style adapter,
                                #         date formats (en/zh), theme contrast guard
cd apps/runtime && go test ./... # storage, API, LAN access policy, thumbnails, backups
```

The theme test is a legibility guard: every theme must keep primary text at
≥ 7:1 and secondary text at ≥ 4.5:1 against its grounds, season labels at ≥ 3:1,
and white text on its accent at ≥ 4.5:1 (WCAG).

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

## Run as a website (cloud mode)

The same binary can serve many people, each with a private Atlas behind an
account (email + password):

```bash
./bin/atlas -mode cloud -data /var/lib/atlas \
  -public-origin https://atlas.example.com -trust-proxy
```

`-data` is the root for every account (`users.json`, `secret.key`,
`users/<id>/` — each a complete atlas-data directory). It never opens a
browser or starts LAN sharing; put it behind a TLS reverse proxy. Flags:
`-public-origin` (comma-separated origins the site is served from),
`-allow-signup` (default true), `-user-quota-mb` (default 500),
`-trust-proxy` (client IP/scheme from a proxy on the same machine). The
session key comes from `ATLAS_SESSION_SECRET` or is generated into
`<data>/secret.key`.

For frontend development against cloud mode, run the runtime with
`-mode cloud -data /tmp/atlas-cloud -public-origin http://localhost:3000`
and `pnpm dev` as usual.

Deployment guide (VPS, systemd, Caddy, backups, pre-launch checklist):
[docs/DEPLOY.md](docs/DEPLOY.md) (中文). Example configs in `deploy/`.

## Data directory

Atlas keeps the application binary and user data strictly separate
(PRODUCT_SPEC §2–3). Without `-data` / `YUATLAS_DATA`, the data directory is
resolved deterministically, never from the process working directory:

1. **Portable** — `<executable-dir>/atlas-data`. When you ship `Atlas.exe` (or
   `atlas`) on its own, it creates a sibling `atlas-data/` next to itself and
   uses it. This is the V1 layout: replace the executable, keep your data.
2. **Per-user** — when the executable lives in a read-only location (e.g.
   Program Files):
   - Windows: `%LOCALAPPDATA%\YuAtlas\atlas-data`
   - macOS: `~/Library/Application Support/YuAtlas/atlas-data`
   - Linux: `$XDG_DATA_HOME/yu-atlas/atlas-data` or `~/.local/share/yu-atlas/atlas-data`

`atlas-data/` contains `data/*.json` (the collections), `media/…` (photos, by
Place), `backups/…` (automatic `.atlas` backups) and optional
`runtime-config.json` (machine config, never exported).

## Build

```bash
./scripts/build.sh
```

This builds the frontend static export, embeds it into the Go runtime, and
produces two binaries in `bin/`:

```text
bin/atlas      native binary (for local testing on this OS)
bin/Atlas.exe  Windows amd64 release (self-contained)
```

To cross-compile the Windows executable by hand:

```bash
cd apps/runtime
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../bin/Atlas.exe ./cmd/atlas
```

The `Atlas.exe` is fully self-contained (embedded frontend; no Node/Go/runtime
required on the target machine). Ship it alone — no source, `node_modules`, or
development caches. On Windows it is an **unsigned** binary, so SmartScreen may
warn on first launch; that warning is expected and is not worked around by
disabling security features.

## Local API

| Method | Path | Description |
|---|---|---|
| GET | `/api/runtime` | mode, `writable`, port, data dir, provider, `remote` (request came over LAN), `lan: {enabled, urls[], error?}` |
| GET / PUT | `/api/profile` | read / write profile |
| GET / POST | `/api/places` | list / create places |
| PUT / DELETE | `/api/places/:id` | update / delete a place |
| GET / POST | `/api/visits` | list / create visits |
| PUT / DELETE | `/api/visits/:id` | update / delete a visit |
| GET / POST | `/api/wishlist` | list / create wishlist entries |
| PUT / DELETE | `/api/wishlist/:id` | update / delete a wishlist entry |
| GET / POST | `/api/media` | list media / upload an image (multipart) |
| PUT / DELETE | `/api/media/:id` | update caption & credits / delete |
| GET | `/media/<path>?w=320` | a photo; `w` ∈ 160/320/640/960/1280/1920 serves a cached, EXIF-oriented JPEG thumbnail |
| GET / PUT | `/api/settings` | read / write settings (theme, language, map layers, LAN sharing — applied live) |
| GET | `/api/geocode/search?q=...` | online place search (normalized) |
| GET | `/api/geocode/reverse?lat=...&lng=...` | reverse geocoding |
| POST | `/api/atlas/export` | download the whole Atlas as a `.atlas` file |
| POST | `/api/atlas/import` | replace the Atlas with a `.atlas` file (backup first) |
| POST | `/api/atlas/new` | start a blank Atlas (backup first) |
| GET | `/api/atlas/backups` | automatic backups, newest first |
| POST | `/api/atlas/backups/:name/restore` | restore a backup (the current Atlas is backed up first) |
| DELETE | `/api/atlas/backups/:name` | delete a backup |

Requests from other devices on the LAN are **read-only**: only GET/HEAD of the
frontend, `/media/*` and read-only API endpoints; every write, geocoding and
`/api/atlas/*` call gets `403`. Writes are also refused when their `Origin` is
not loopback, and the runtime only accepts `localhost` / IP-literal `Host`
headers (DNS-rebinding protection).

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

The default view is a fullscreen MapLibre GL map framed on the visited places
(Europe for the sample data; a Settings default position overrides it).

- **Markers** derive from `places.json` + `visits.json` (a place referenced by a
  Visit gets a marker). Each visited place (except the current base and mere
  transits) plants a small country flag on a hairline pole.
- **Current location** comes from `profile.currentBase.placeId` and renders as a
  distinct accent-colored marker with a subtle pulse ring.
- **Visited countries** are the distinct `countryCode`s of visited places, drawn
  as a clear wash from `public/geodata/countries.geojson` (Natural Earth 110m),
  layered beneath the basemap water so the precise coastline trims it.
  Countries only on the wishlist are **hatched** in the wish colour — solid is
  "been there", hatched is "would like to go". Countries are never markers or
  first-class Places.
- **Wishlist pins** (on by default): a star in a soft ring with the place's
  name, which yields to every visited label; when-to-go shows on hover.
- **Routes by transport**: each trip may record how it was travelled
  (`visit.transport`: `plane` — the default — `train`, `bus` or `car`, chosen
  in the visit form). Flights are fine dashed arcs with a plane turning along
  them; trains a rail line with sleepers; bus and car a soft road with a dashed
  centre line. The vehicle sits at the route's midpoint once the route is long
  enough on screen not to crowd the pins.
- **Hover** shows a micro preview (place, country, date, visit type); **click**
  opens the memory card and focuses the matching Timeline node.
- **Layers** (map layers button, persisted in Settings): residence-based routes,
  wishlist pins and hatching, visited-country wash.
- **Themes** are semantic tokens (`src/themes/`) applied as CSS variables; the
  map adapter restyles CARTO Positron (light themes) or Dark Matter (Night).

## Journey Timeline (Phase 3)

Scrolling past the hero map collapses it into a compact, inset contextual strip
(84px) that stays pinned to the top, centred on the current base, and reveals
the horizontal Journey Timeline. Scrolling back up restores the fullscreen map
and camera.

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
- **Node hierarchy**: past = filled (size by visit depth), current = NOW ring,
  future = outline (season-tinted) with a dashed photo frame. Hover/focus shows a
  preview card; click focuses the place on the map; *View memory* / double-click
  opens the Detail Sheet.
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

**Phase 5 (manage atlas):** the local content-management utility
(`src/components/manage/*`) behind Profile → Manage Atlas — overview, Places /
Visits / Wishlist / Media / Settings editors, online place search (Photon via
the runtime), media upload/delete, and add-Visit / add-Wishlist flows.

**Phase 6 (portability):** the portable `.atlas` container
(`apps/runtime/internal/atlas`) — ZIP-based export / import with a
`schemaVersion`-validated `manifest.json`, automatic backups in
`atlas-data/backups/`, "New Atlas" reset, and traversal-safe extraction.
Machine config (`runtime-config.json`) is never exported.

**Phase 7 (release packaging):** portable single-file distribution — `bin/Atlas.exe`
(Windows amd64, self-contained, embedded frontend) plus a native `bin/atlas`
for local testing. Data lives next to the executable (or in a per-user directory
for read-only install locations); see “Data directory”.

**Phase 8 (design & experience — this release):** the Claude Design
redesign (`docs/Yu's Atlas page redesign.zip`, references in `docs/design/`)
carried through every surface, the theme system, bilingual UI, search, LAN
sharing, thumbnails, backups UI and tests — see the sections below.

Explicitly **not** implemented (out of scope per PRODUCT_SPEC §45 or later):
an installer/MSI, auto-updater, code signing, statistics dashboards, accounts
and cloud sync.

## Design

The page follows the Claude Design reference composition
(`docs/Yu's Atlas page redesign.zip` → `Yu's Atlas.dc.html`, plus
`docs/design/light-reference.png` / `night-reference.png`) within the rules of
VISUAL_SPEC:

- **Header** — compass-rose wordmark (named after the profile: “Yu’s Atlas”),
  search, theme and profile pills. The wordmark belongs to the full-screen map
  and fades as it collapses; the actions settle over the strip, where
  *Expand map* joins them.
- **Hero Map** — CARTO vector tiles restyled per theme (`lib/map-style.ts`),
  shaded relief from open elevation tiles, sea names at hero zoom, night city
  lights from the tiles' own place layer. Every visited place carries a label;
  labels that would collide with another label or pin hide themselves
  (selective by geometry, not by a fixed list). Clicking a pin opens a memory
  card (photos, company, reflection, *View memory*).
- **Scroll collapse** — the map stays full-bleed for the first half of the
  scroll, then insets into a rounded strip centred on the current base.
- **Journey** — season marks above the line, memory fragments below, a NOW
  pill and rule, an open *Where next?* node at the end, arrows and a scroll
  indicator.
- **Where Next** — season tabs with counts, a cinematic primary card with
  season badge, flag and inspiration row, photo-topped companions, *Also
  dreaming of*, and the *All ideas* board.
- **Liquid glass** — chrome that floats over the world (header pills, map
  controls and their menus, actions over photographs) is a pane of glass:
  tinted, frosted, with a specular rim. In Chromium (Chrome, Edge — the
  Windows default) the rim also refracts what lies beneath, from a displacement
  map drawn per element size (`lib/liquid-glass.ts`); other engines keep the
  frosted pane, and *reduce transparency* turns it solid. Content — timeline,
  cards, sheets — stays on paper, so the two never compete. Each theme tunes
  its glass (Minimal keeps a flat frosted pane), and a test keeps text on
  glass legible over every part of the map.

### Themes

| Theme | Character |
|---|---|
| Light | airy parchment, sage relief, forest-green pins, green NOW |
| Night | deep navy, city lights, amber memories, blue NOW |
| Journal | cream paper with fibres, sepia ink, terracotta present, routes drawn as ink dashes, framed photos |
| Minimal | kinari white, sumi-ink pins, a single vermilion seal, flat geography, hairline geometry |
| Film | warm faded stock, grain over everything, photos printed warm, dates stamped in orange mono |
| Auto | follows the OS: Light or Night |

A theme (`apps/web/src/themes/*.ts`) is pure tokens: colours, fonts
(self-hosted Inter, Newsreader, Fraunces, Instrument Serif, Cormorant
Garamond, JetBrains Mono), radii, shadows, paper/grain textures, photo filter,
map palette, relief, city lights, glass, markers, routes and two season palettes (line
colours and legible season ink). `applyTheme()` writes them as CSS variables
and snapshots them so the next load paints the right theme before React
hydrates. Switch with the palette button, **T**, ⌘K, Profile or Settings.

### Language

English or 简体中文 (or Auto, following the system) from Profile, Settings or
⌘K. Interface strings, dates (`2025年11月10日–15日`), seasons and visit types
are localized; your own words — place names, reflections, notes — are always
shown as written. Strings are keyed by their English text (`lib/i18n.ts`);
translations live in `lib/i18n-zh.ts` and `lib/i18n-zh-manage.ts`.

### Keyboard

| Keys | Action |
|---|---|
| ⌘K / Ctrl K, `/` | search places, memories, wishes and commands (Shift+Enter: show on map) |
| `M` `J` `W` | jump to map / journey / where next |
| `I` · `P` | all ideas · profile |
| `T` · `R` | next theme · routes on/off |
| ← → | move through time (timeline focused) / previous–next place (detail open) |
| Ctrl + wheel | zoom the map |
| `?` · Esc | shortcuts · close |

## Sharing on your local network

Manage Atlas → Settings → *Share on local network* (or start with `-lan`).
The runtime additionally listens on this computer's private IPv4 addresses on
the same port and shows each URL with a QR code. Other devices get a read-only
Atlas; editing stays on this computer. Turning it off closes those listeners
immediately.

## Backups

Every import, restore and New Atlas first writes a `.atlas` backup to
`atlas-data/backups/`. Manage Atlas → Import / Export lists them with one-click
restore (which itself backs up the current Atlas first) and delete.

## Third-party assets

- Fonts: Inter, Newsreader, Fraunces, Instrument Serif, Cormorant Garamond,
  JetBrains Mono — SIL Open Font License, via `@fontsource`.
- Country flags: `country-flag-icons` (MIT), copied to `public/flags` at build.
- Basemap © CARTO, © OpenStreetMap contributors; relief from Mapzen / AWS
  Terrain Tiles; country polygons from Natural Earth.
- Sample photos: Wikimedia Commons under CC0 / CC BY / CC BY-SA — author,
  licence and source page are recorded per photo in
  `examples/atlas-data/data/media.json` and credited in the app.
