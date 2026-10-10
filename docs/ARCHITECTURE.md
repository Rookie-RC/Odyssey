# Architecture

How the code is organised and why. What the app does is in PRODUCT_SPEC; how it looks is in design/VISUAL_SPEC; what comes next is in ROADMAP.

## 1. One app, three ways to run it

```
            ┌──────────────────────────── apps/web (Next.js static export) ───────────────────────────┐
            │  the whole interface: map, journey, where next, me, managing the atlas                  │
            └───────────────────────────────────────────────┬─────────────────────────────────────────┘
                                                            │ fetch /api/* (same origin)
            ┌───────────────────────────── apps/runtime (Go, frontend embedded) ──────────────────────┐
            │  JSON storage, media, thumbnails, import/export, backups, geocoding proxy               │
            └───────────────────────────────────────────────┬─────────────────────────────────────────┘
          ┌─────────────────────────────────┬───────────────┴──────────────────┐
   Phone (main target)               Web (cloud mode)                   Development
   apps/android: WebView shell;      `atlas -mode cloud` behind         `next dev` on :3000 with
   runtime runs as libodyssey.so     Caddy (deploy/); accounts,         NEXT_PUBLIC_API_BASE pointing
   on 127.0.0.1, data on the phone   one atlas per user                 at a local runtime on :4317
```

- There is one interface. The phone app, the browser and development all load the same build of apps/web. There is no separate "mobile" or "desktop" code path; the layout adapts by width.
- The Go runtime is the only thing that touches disk. The frontend never assumes it can write files; saving or sharing a file goes through `lib/native.ts`, which uses the Android bridge when it is there and a download link when it is not.
- In local mode the runtime trusts loopback only: a request from another device on the network is read-only (`internal/api/access.go`). Cloud mode replaces this with sign-in (`internal/cloud`).

## 2. Repository layout

| Path | What it holds |
| --- | --- |
| `apps/web` | The interface. Next.js 14, static export (`out/`), TypeScript, plain CSS, MapLibre GL, vitest. |
| `apps/runtime` | The Go server. `cmd/atlas` is the entry point; `assets/web` is the embedded frontend (generated, do not edit). |
| `apps/android` | The Android shell: Java, no Gradle (`build.sh` uses the SDK tools directly). |
| `scripts/build.sh` | Builds the frontend, embeds it and builds the runtime into `bin/`. |
| `deploy/` | Cloud mode on a server: Caddyfile and a systemd unit. |
| `examples/atlas-data` | A sample atlas for trying the app. |
| `docs/` | This file, PRODUCT_SPEC, ROADMAP, DEPLOY; `design/` holds VISUAL_SPEC and its reference images. |

## 3. The web app (`apps/web/src`)

```
app/         Next.js entry: layout.tsx (fonts, stylesheets, theme boot), page.tsx → CloudGate
components/  screens and their parts (React)
  manage/    managing the atlas: add flow, editors, lists, media, import/export, settings
  edit/      Direct Edit inside the place sheet
lib/         everything that is not React: types, data access, derived views, platform glue
styles/      one stylesheet per surface
themes/      Light and Night as token sets; Auto picks one from the system
```

### 3.1 Layers and the rules between them

1. **Types**: `lib/types.ts` mirrors `apps/runtime/internal/domain/domain.go`. A field added on one side is added on the other in the same commit.
2. **Data access**: components read and write through `AtlasRepository` (`lib/repository.ts`), which calls `lib/api.ts`. No component calls `fetch` for atlas data.
3. **Derived views**: the timeline, map markers, routes, Where next shelves, study-abroad stays, share tickets and the footprint are pure functions of the atlas records (`lib/timeline.ts`, `map-data.ts`, `routes.ts`, `domain.ts`, `abroad.ts`, `share.ts`). Nothing derived is stored. These modules are where the logic lives and where the tests are.
4. **Rendering**: components take records and derived views as props and keep only UI state. `AtlasApp` owns the loaded atlas and the navigation state.
5. **Platform**: `lib/native.ts` (Android bridge: `saveFile`, `shareFile`, back button through `window.odysseyBack`), `lib/account.ts` (cloud sessions).

A module in `lib/` never imports from `components/`.

### 3.2 Screens

`AtlasApp` is the whole app once the atlas is loaded:

- **Map** is a full-screen layer that stays mounted, so its camera and markers survive a tab switch (`HeroMap`, `styles/map.css`).
- **Tabs**: Map, Journey, Where next and Me (`TabBar`, `styles/tabs.css`). The other tabs are pages laid over the map. The `?tab=` query keeps the tab across reloads. The round "+" beside the tab bar records a trip.
- **Overlays** open over any tab, one at a time: the place sheet (`PlaceDetailSheet`), all ideas (`IdeasBoard`), search (`SearchPanel`) and sharing (`ShareDialog`). The tab bar hides while one is open.
- **Manage** (`manage/ManageAtlas`) covers the screen for adding and editing; on a read-only atlas it is not offered.

The Android back button calls `window.odysseyBack`, which closes the topmost thing in this order: search, share, anything marked `data-owns-keyboard`, the overlay, Manage, then returns to the Map tab. When it returns false the app goes to the background.

### 3.3 Conventions

- **Strings**: `t("English text")` everywhere; Chinese lives in `lib/i18n-zh*.ts`, keyed by the English. User content is never translated.
- **Themes**: components use CSS variables only (`--bg`, `--text-primary`, `--accent` …). The values come from `themes/light.ts` and `themes/night.ts`. A colour written directly in a component or stylesheet is a bug.
- **CSS**: classes are `atlas-<block>__<element>--<modifier>`, with state as `is-<state>`. Each stylesheet owns one surface and is imported in `app/layout.tsx`, after `styles/reset.css`. There is no CSS framework.
- **Touch first**: hit areas are at least 44px, nothing depends on hover, and sheets respect the safe areas. Hover may add detail but never hides a function.
- **Icons**: `components/Icons.tsx`, one line style, no emoji in the chrome.

## 4. The runtime (`apps/runtime`)

| Package | Role |
| --- | --- |
| `cmd/atlas` | Flags (`-data`, `-port`, `-mode`), wiring, serving the embedded frontend. `-data` (or `YUATLAS_DATA`) is required. |
| `internal/domain` | The record types (mirrored in `lib/types.ts`). |
| `internal/storage` | JSON files under the data directory, with atomic writes. |
| `internal/atlas` | Export and import of the `.atlas` package, and the backups kept before an import. |
| `internal/media` | Uploads, EXIF, thumbnails. |
| `internal/geocode` | Place search through Photon, behind a provider interface. |
| `internal/api` | The HTTP API (`/api/runtime`, `/api/profile`, `/api/places`, `/api/visits`, `/api/wishlist`, `/api/media`, `/api/settings`, `/api/geocode/*`, `/api/atlas/*`) and the remote read-only gate. |
| `internal/cloud` | Cloud mode: accounts, sessions, rate limits, one storage directory per user. |
| `internal/config` | Per-machine settings kept out of the atlas and its exports (the geocoder and its credentials). |

## 5. The Android app (`apps/android`)

- `MainActivity` hosts a WebView on the local runtime and exposes the `OdysseyAndroid` bridge (`saveFile`, `shareFile`).
- `LocalRuntime` starts `lib/<abi>/libodyssey.so` with the app's private data directory and waits for it to answer.
- `ShareProvider` hands files to the system share sheet.

The APK carries the same frontend as the web build; it is embedded in the runtime binary.

## 6. Checks

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
(cd apps/runtime && go vet ./... && go test ./...)
./scripts/build.sh
```

Commits follow `type(scope): what changed` (`feat(web)`, `refactor(runtime)`, `docs`). Each commit has one concern and leaves these checks green. Docs change in the same commit as the behaviour they describe.
