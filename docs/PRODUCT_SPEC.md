# Yu's Atlas — PRODUCT_SPEC

## 0. Product Definition

**Yu's Atlas** is a local-first personal travel atlas centered on:

- space
- time
- memory
- future travel inspiration

It is **not**:

- a travel booking platform
- an itinerary planner
- a travel-management dashboard
- a generic travel blog
- a social network

The conceptual model is:

- **Map = Space**
- **Timeline = Time**
- **Where Next = Future**
- **Place Detail = Memory / Intention**
- **Profile = Identity**

The first version runs locally on the user's computer and stores all personal data and images locally.

The architecture must also support:

1. one-click local launch
2. sharing the app binary with friends
3. local editing through the browser UI
4. importing/exporting complete Atlas data packages
5. future public deployment
6. future migration from local files to a remote backend
7. future custom themes/skins without rewriting application logic

---

# 1. Product Architecture

Yu's Atlas consists of two main layers:

```text
YuAtlas executable
        │
        ├── embedded frontend
        │
        ├── local HTTP server
        │
        └── local file API
                │
                ▼
           atlas-data/
```

The browser UI communicates with a lightweight local runtime.

Recommended implementation:

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- MapLibre GL JS
- Motion / Framer Motion
- static export

### Local runtime

- Go
- `net/http`
- embedded static frontend assets
- filesystem-based storage
- JSON read/write
- media upload handling
- import/export handling
- browser auto-launch

### Storage

No database in V1.

Use:

```text
JSON + filesystem
```

---

# 2. Distribution Model

The application should be distributable as a portable package.

Example releases:

```text
YuAtlas-Windows-x64.zip
YuAtlas-macOS-arm64.zip
YuAtlas-macOS-x64.zip
YuAtlas-Linux-x64.tar.gz
```

Example Windows package:

```text
YuAtlas/
├── YuAtlas.exe
└── atlas-data/
```

The user should not need:

- Node.js
- npm
- pnpm
- Python
- Docker
- PostgreSQL
- a database
- a development environment

Expected behavior:

```text
double-click YuAtlas.exe
        ↓
check/create atlas-data/
        ↓
choose available localhost port
        ↓
start local server
        ↓
open default browser
        ↓
http://127.0.0.1:<port>
```

Preferred default port:

```text
4317
```

If unavailable, automatically select another free port.

---

# 3. Portable Data Separation

Application code and personal data must be separated.

```text
YuAtlas executable     = application
atlas-data/            = user-owned content
```

Updating the application must not require replacing user data.

Example:

```text
YuAtlas v1.0
      ↓ replace executable
YuAtlas v1.1

atlas-data/ remains unchanged
```

The user must be able to copy `atlas-data/` independently.

---

# 4. Local and LAN Modes

Default mode:

```text
127.0.0.1
```

Only the local computer can access the app.

Optional future-compatible mode:

```text
Share on local network
```

which binds to the local network interface and exposes something like:

```text
http://192.168.x.x:<port>
```

If LAN mode is implemented in V1:

- LAN access must be **read-only by default**
- editing must only be available from localhost
- display the local-network URL clearly
- QR code is optional

Do not make LAN sharing required for the first implementation milestone.

---

# 5. Core Domain Model

The domain model should remain independent from the filesystem implementation.

---

## 5.1 Place

A `Place` represents a geographical entity.

```ts
type PlaceType =
  | "city"
  | "region"
  | "island"
  | "natural_area";

interface Place {
  id: string;

  name: string;

  // Country is metadata/context for this location.
  // Countries are not first-class Place records and never receive pins.
  country: string;
  countryCode: string;

  type: PlaceType;

  coordinates: {
    lat: number;
    lng: number;
  };
}
```

Examples:

```text
Portugal   country
Rome       city
Lofoten    region
Sardinia   island
Dolomites  natural_area
```

Individual attractions should generally **not** become Place objects.

Example:

```text
Colosseum
Pantheon
Trevi Fountain
```

should normally appear as Visit highlights.

This avoids excessive map density.

---

# 6. Visit

A Visit describes the user's relationship with a Place.

```ts
type VisitType =
  | "lived"
  | "trip"
  | "day_trip"
  | "stopover"
  | "transit";

interface VisitHighlight {
  name: string;
  note?: string;
}

interface Visit {
  id: string;
  placeId: string;

  visitType: VisitType;

  startDate?: string;
  endDate?: string;

  withFriends?: boolean;

  highlights?: VisitHighlight[];

  mediaIds?: string[];

  reflection?: string;
}
```

Meaning:

| Type | Meaning |
|---|---|
| lived | lived there for an extended period |
| trip | intentional travel destination |
| day_trip | short intentional visit |
| stopover | short stay while transferring / passing through, but explored |
| transit | only passed through / transferred |

Do not simplify these into:

```text
visited = true
```

because visit depth is part of the visual story.

---

# 7. Wishlist

Wishlist represents places the user may want to visit.

It must remain intentionally flexible.

```ts
type Season =
  | "spring"
  | "summer"
  | "autumn"
  | "winter";

interface Inspiration {
  type:
    | "book"
    | "movie"
    | "video"
    | "social_media"
    | "article"
    | "friend"
    | "photo"
    | "music"
    | "other";

  title?: string;
  creator?: string;
  platform?: string;
  url?: string;
  note?: string;
}

interface Wishlist {
  id: string;
  placeId: string;

  seasons?: Season[];

  targetTime?: {
    year?: number;
    season?: Season;
  };

  priority?: 1 | 2 | 3 | 4 | 5;

  why?: string;

  inspirations?: Inspiration[];

  mediaIds?: string[];

  note?: string;
}
```

Important distinction:

### `why`

Short display-oriented reason.

Example:

> Midnight sun, dramatic mountains and hiking.

### `note`

Free-form personal planning/thought field.

Example:

> Maybe 2027 or 2028. Could go with friends. Need to check whether renting a car is necessary.

Wishlist target time may be:

```text
Summer 2027
Summer, year unknown
2028, season unknown
No target time
```

Only wishlist entries with sufficiently meaningful target timing should appear on the Timeline.

All Wishlist entries may appear in Where Next.

Do not require a specific itinerary or must-see-place list.

---

# 8. Media

```ts
interface Media {
  id: string;

  type: "image";

  source:
    | "local"
    | "web";

  path: string;

  caption?: string;

  sourceUrl?: string;
  author?: string;
  license?: string;
}
```

Past travel should normally use personal photos.

Future destinations may use inspiration images.

Keep:

```text
sourceUrl
author
license
```

because the Atlas may later be published publicly.

---

# 9. Profile

```ts
interface Profile {
  name: string;

  avatar?: string;

  currentBase?: {
    placeId: string;
  };

  bio?: string;

  interests?: string[];

  links?: {
    label: string;
    url: string;
  }[];
}
```

Keep Profile concise.

Do not build a full research portfolio or blog in V1.

---

# 10. Runtime Storage Layout

Actual runtime data must live outside the compiled frontend.

Use:

```text
atlas-data/
├── data/
│   ├── profile.json
│   ├── places.json
│   ├── visits.json
│   ├── wishlist.json
│   ├── media.json
│   └── settings.json
│
├── media/
│   ├── bordeaux/
│   ├── lofoten/
│   ├── portugal/
│   └── ...
│
├── themes/
│   └── custom/
│
└── backups/
```

Do not organize media folders by status such as:

```text
visited/
wishlist/
```

because wishlist destinations may later become visited.

Organize media by Place.

---

# 11. Data Repository Abstraction

The UI must not directly depend on JSON files.

Define a repository abstraction.

Conceptually:

```ts
interface AtlasRepository {
  getProfile(): Promise<Profile>;

  getPlaces(): Promise<Place[]>;
  getVisits(): Promise<Visit[]>;
  getWishlist(): Promise<Wishlist[]>;
  getMedia(): Promise<Media[]>;

  saveProfile(profile: Profile): Promise<void>;

  createPlace(place: Place): Promise<void>;
  updatePlace(place: Place): Promise<void>;

  createVisit(visit: Visit): Promise<void>;
  updateVisit(visit: Visit): Promise<void>;

  createWishlist(item: Wishlist): Promise<void>;
  updateWishlist(item: Wishlist): Promise<void>;

  uploadMedia(...): Promise<Media>;

  exportAtlas(): Promise<void>;
  importAtlas(...): Promise<void>;
}
```

V1 implementation:

```text
LocalFileRepository
```

Future:

```text
SupabaseRepository
RemoteApiRepository
```

The UI should not need major changes when the repository implementation changes.

---

# 12. Domain Query Layer

Provide higher-level functions such as:

```ts
getPlace(id)

getVisitedPlaces()

getCurrentPlace()

getVisitsByPlace(placeId)

getWishlistByPlace(placeId)

getWishlistBySeason(season)

getTimelineItems()

getPlaceStory(placeId)

getPrimaryMediaForPlace(placeId)
```

Derived UI structures such as Timeline must be generated from domain data.

Do not maintain duplicate Timeline JSON manually.

---

# 13. Online Location Search and Geocoding

**Online place search is mandatory in V1.**

Adding or editing a Place must use online search as the primary workflow. Users should not normally type latitude/longitude or manually hunt for every destination on the map.

Primary interaction:

```text
type place name
    ↓
online search / autocomplete
    ↓
select result
    ↓
auto-fill name + country + countryCode + coordinates + suggested PlaceType
    ↓
map flies to result
    ↓
confirm or drag marker to refine
    ↓
save
```

The search must support the geographic scales used by Yu's Atlas:

- city
- region
- island
- natural area

Examples:

```text
Bordeaux
Lofoten
Sardinia
Dolomites
```

Country-level Places are not valid in V1. Country names may appear as search context, but saved Wishlist entries must reference a concrete city, region, island, or natural area.

## 13.1 Geocoding Provider Abstraction

Do not couple the UI or domain model to one vendor.

Use a provider interface similar to:

```ts
interface GeocodingProvider {
  id: string;

  search(
    query: string,
    options?: GeocodingSearchOptions
  ): Promise<GeocodingResult[]>;

  reverse?(
    lat: number,
    lng: number
  ): Promise<GeocodingResult | null>;
}
```

Normalize provider responses:

```ts
interface GeocodingResult {
  name: string;
  displayName: string;

  country?: string;
  countryCode?: string;

  suggestedType?:
    | "city"
    | "region"
    | "island"
    | "natural_area";

  coordinates: {
    lat: number;
    lng: number;
  };

  bbox?: [number, number, number, number];

  provider: string;
  providerId?: string;
}
```

Once a result is selected, save ordinary Atlas `Place` data. The Atlas must continue to render correctly even when the geocoding service is offline later.

## 13.2 V1 Provider Strategy

V1 must preserve the application's one-click portability.

### Preferred zero-key provider for personal/local use: Photon

Use Photon as the default zero-key provider for local/personal V1 usage.

It supports search-as-you-type and is appropriate for this lightweight personal workflow.

Requirements:

- frontend calls the local Go runtime, not Photon directly
- debounce requests
- use a minimum query length
- request only a small number of results
- cache recent/repeated searches
- keep the endpoint/provider configurable
- treat public-service availability as non-guaranteed

### Optional configured provider: MapTiler

Support MapTiler Search/Geocoding when the user supplies an API key.

This is useful for:

- public deployment
- users wanting a managed geocoding provider
- production-style autocomplete

API credentials are machine/runtime configuration and must not be exported inside `.yuatlas` files.

### Nominatim-compatible fallback

A Nominatim-compatible provider may be available for explicit user-triggered searches.

When using the public OpenStreetMap Nominatim service:

- do not use it for client-side autocomplete
- obey its request limits
- identify the application
- cache repeated queries
- keep the provider switchable

## 13.3 Search UX

Concept:

```text
Search location
┌────────────────────────────────────┐
│ Lofoten                            │
└────────────────────────────────────┘

Lofoten, Nordland, Norway
Region

Lofoten Islands, Norway
Region
```

After selecting a result:

```text
┌────────────────────────────────────┐
│            map preview             │
│                 ●                  │
└────────────────────────────────────┘

Lofoten
Norway
Region

[ Use this location ]
```

Selection should:

1. fill the place name
2. fill country
3. fill coordinates
4. suggest PlaceType
5. zoom/pan the map
6. place a confirmation marker

The user may drag the marker before saving.

If provider type mapping is uncertain, allow manual correction between:

```text
City
Region
Island
Natural area
```

## 13.4 Search Behavior

For autocomplete-capable providers:

- debounce approximately 300–500 ms
- begin after roughly 2–3 meaningful characters
- return around 5–8 results
- cancel stale in-flight searches
- cache recent results
- prioritize geographical destinations over restaurants, shops, and generic POIs

Yu's Atlas is a destination atlas, not a POI database.

## 13.5 Reverse Geocoding

After the marker is manually moved, reverse geocoding may suggest:

- country
- nearby city/region
- display name

Manual positioning must still work if reverse geocoding is unavailable.

Coordinates are the authoritative spatial value.

## 13.6 Local Runtime API

The Go runtime should expose provider-neutral endpoints such as:

```text
GET /api/geocode/search?q=lofoten
GET /api/geocode/reverse?lat=...&lng=...
```

The runtime handles:

- provider selection
- provider credentials
- required request headers
- rate limiting
- debouncing/caching support
- response normalization
- fallback behavior

The frontend must not contain vendor-specific geocoder logic.

## 13.7 Runtime Configuration

Geocoder credentials and machine-specific service configuration are not portable Atlas content.

Use a separate local runtime configuration, for example:

```text
atlas-data/
├── data/
│   └── settings.json
└── runtime-config.json
```

Example:

```json
{
  "geocodingProvider": "photon",
  "mapTilerApiKey": null
}
```

Do not include API credentials in normal `.yuatlas` exports.

Portable user data and machine-specific credentials/configuration are separate concerns.

---

# Country Display and Map Semantics

Country information is always preserved and displayed where it provides context.

Examples:

```text
Bordeaux
France
```

```text
Lofoten
Norway
```

Country should normally appear in:

- map hover previews
- expanded cards
- Timeline previews
- Where Next cards
- Place Detail Sheets
- search results
- Manage Atlas forms

However:

- countries are not first-class Place records
- countries do not receive pins
- countries are not independent Timeline nodes
- countries are not independent Wishlist items in V1

Visited-country highlighting is derived from visited location data through `countryCode` and rendered only as a subtle polygon/outline layer.

---

# 14. Main User Experience

The application is primarily a continuous single-page experience.

Order:

1. Fullscreen Europe Map
2. Scroll-driven map collapse
3. Horizontal Journey Timeline
4. Where Next
5. Place preview
6. Place Detail Sheet
7. Profile Drawer

These should not feel like disconnected website pages.

---

# 15. Hero Map

Initial state:

```text
100vw × 100vh
```

The map visually behaves as the page.

Do not place it inside a visible card frame.

Default geography:

```text
Europe
```

Initial map displays:

- previously visited location pins
- current location
- very subtle country polygons/outlines derived from visited Places

Do **not** display Wishlist locations on the default hero map.

Do not display country pins. Countries never receive map pins.

The hero answers:

> Where have I been, and where am I now?

---

# 16. Map Marker Hierarchy

Use importance rather than many unrelated colors.

Conceptual order:

```text
current > lived > trip > day_trip > stopover > transit
```

Suggested representation:

```text
◎ current
● lived / trip
◌ stopover
· transit
```

Current location may have a subtle pulse.

Do not blink or use aggressive animation.

Do not permanently show all labels.

Visited-country polygons are a separate background layer, not part of the marker hierarchy. They must remain visually weaker than all primary visited/current location pins.

---

# 17. Marker Interaction

Hover:

```text
Bordeaux
France
Nov 2025 · Trip
```

First click:

- focus marker
- optionally pan map slightly
- reveal nearby preview card
- do not immediately open full detail

Preview card example:

```text
Bordeaux
France · Nov 2025

[photo]

With friends

View memory →
```

Only one preview may be active at once.

---

# 18. Scroll-Driven Map Collapse

The map transition is a defining interaction.

Do not suddenly replace the map.

Use scroll progress:

```text
100vh
 ↓
70vh
 ↓
40vh
 ↓
80–140px strip
```

Conceptual states:

```ts
type MapMode =
  | "hero"
  | "transition"
  | "strip";
```

`transition` may be computed rather than stored.

Scrolling upward restores the large map.

The transition should feel like:

> the map is making room for time.

---

# 19. Journey Timeline

The Timeline is horizontal.

Concept:

```text
PAST ←──────── NOW ─────────→ FUTURE
```

Default position should place `NOW` near the viewport center.

Users can navigate via:

- mouse drag
- trackpad
- horizontal wheel translation
- touch swipe

Do not force the Timeline to start at the earliest date.

---

# 20. Seasonal Timeline

Season is encoded through the **Timeline line itself**.

Do NOT use large colored season bars.

Semantic colors:

```text
Spring → soft green
Summer → warm yellow / gold
Autumn → warm orange / amber
Winter → cool blue
```

Season may influence:

- timeline segment
- node outline
- tiny glow
- date accent
- small icon
- season label

The line is the primary seasonal representation.

---

# 21. Timeline Node Semantics

Conceptually:

```text
● visited
◎ current
○ future / wishlist
```

Visit depth may affect:

- size
- opacity
- label prominence

Current position remains the strongest anchor.

Past timeline items may show:

- personal photo
- date
- place
- visit type

Future timeline items may show:

- inspiration image
- season/year
- place
- wishlist state

---

# 22. Where Next

Where Next is a season-driven inspiration shelf.

It is not a search engine.

Season selector:

```text
Spring   Summer   Autumn   Winter
           ───
```

Do not use large rectangular colored tabs.

Card hierarchy:

```text
one dominant destination
+
smaller secondary destinations
```

Primary card may include:

- image
- place
- country
- target time
- short `why`
- inspiration source

Secondary cards stay compact.

---

# 23. Place Interaction Grammar

Use one shared interaction language:

```text
Focus
  ↓
Expand
  ↓
Explore
  ↓
Collapse
```

Apply consistently to:

- map marker
- timeline node
- Where Next card

Avoid random combinations of unrelated modals, popovers, accordions, etc.

---

# 24. Detail Sheet

Do not use a conventional centered modal.

Use:

```text
PlaceDetailSheet
```

Desktop:

- right-side or large bottom sheet
- underlying page remains visible
- subtle background dim
- page may scale to ~96–98%

Mobile:

- near-full-height bottom sheet

Visited details:

- place
- country
- date range
- visit type
- with friends
- 1–2 photos
- highlights
- reflection

Wishlist details:

- place
- country
- season / target time
- inspiration image(s)
- why
- inspirations
- links
- note

Do not add ratings, hotel reviews, budgets, or gamification.

---

# 25. Profile Drawer

Open from the right.

Desktop width:

```text
min(420px, 90vw)
```

Contains:

- avatar
- name
- current base
- short bio
- interests
- links
- Manage Atlas entry when local editing is available

Profile and Place Detail are mutually exclusive.

Prefer a single global overlay state:

```ts
type ActiveOverlay =
  | { type: "place"; id: string }
  | { type: "profile" }
  | null;
```

---

# 26. Manage Atlas

Yu's Atlas needs a built-in local content-management interface.

It must not visually pollute the public-facing Atlas.

Entry point:

```text
Profile
  ↓
Manage Atlas
```

Only expose editing functionality when running in writable local mode.

Suggested Manage Atlas sections:

```text
Overview

Places
Visits
Wishlist
Media
Import / Export
Settings
```

Example overview:

```text
Places       37
Visits       28
Wishlist     19
Photos      126

[ + Add ]
```

This is a local utility interface, not the main visual experience.

It may use more conventional form UI than the public Atlas.

---

# 27. Add Data Flow

Main action:

```text
+ Add
```

Step 1:

```text
What are you adding?

[ I've been here ]

[ I want to go here ]
```

---

## 26.1 Add Visit

Fields:

```text
Search location
Place
Country (auto-filled)
Country code (internal/auto-filled)
Location
Visit type
Start date
End date
With friends
Photos
Highlights
Reflection
```

The user should not manually type latitude and longitude.

Primary V1 flow:

```text
Search location online
        ↓
select result
        ↓
confirm on map
```

`Pick on map` remains available as a manual fallback.

Online place search is mandatory in V1.

---

## 26.2 Add Wishlist

Fields:

```text
Search location
Place
Country (auto-filled)
Country code (internal/auto-filled)
Location
Best seasons
Optional target year
Optional target season
Why
Inspiration
Images
Notes
```

Inspiration types should support:

```text
Book
Movie
Video
Social media
Article
Friend
Photo
Music
Other
```

Do not force precise itinerary fields.

---

# 28. Editing Existing Entries

Manage Atlas should allow editing:

- Place
- Visit
- Wishlist
- Media metadata
- Profile

Deleting should require a lightweight confirmation.

Do not build complex undo/history in V1.

Before destructive import/replace operations, create automatic backup.

---

# 29. Media Upload

User flow:

```text
Add photos
   ↓
drag/drop or file picker
   ↓
browser uploads to local runtime
   ↓
runtime stores file
   ↓
media.json updated
```

Example:

```text
atlas-data/media/bordeaux/IMG_001.jpg
```

UI should not expose raw file paths.

Support common image formats.

Do not implement heavy image DAM features in V1.

Optional later optimization:

- thumbnails
- compression
- EXIF extraction

Not required initially unless needed for performance.

---

# 30. Import / Export Format

Define a custom portable format:

```text
*.yuatlas
```

The file is internally a ZIP archive.

Example:

```text
yu-travel-2026.yuatlas
├── manifest.json
├── data/
│   ├── profile.json
│   ├── places.json
│   ├── visits.json
│   ├── wishlist.json
│   ├── media.json
│   └── settings.json
└── media/
    ├── bordeaux/
    ├── lofoten/
    └── ...
```

Manifest:

```json
{
  "format": "yuatlas",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-08-16T22:00:00+02:00"
}
```

`schemaVersion` is mandatory.

Future versions must be able to migrate older schema versions.

---

# 31. Export Behavior

V1 export:

```text
Export Atlas
    ↓
single .yuatlas file
```

The export contains:

- all structured data
- settings
- images
- custom theme files if relevant

The exported file should be sufficient to reconstruct the Atlas.

---

# 32. Import Behavior

V1 import should remain simple.

Support:

```text
Import Atlas
→ Replace current Atlas
```

Before replacing:

```text
automatic backup
```

Example:

```text
atlas-data/backups/
  backup-2026-08-16-2255.yuatlas
```

Do **not** implement merge/conflict resolution in V1.

Future:

```text
Merge Atlas
```

may be added later.

---

# 33. New Atlas

Support a blank-user flow.

Concept:

```text
New Atlas
```

creates minimal:

```text
profile
empty places
empty visits
empty wishlist
empty media
settings
```

This allows friends to use Yu's Atlas for themselves.

---

# 34. Settings

Minimal V1 settings:

- Light / Night theme
- current preferred theme
- optional default map position
- geocoding provider
- optional configured provider/API key
- optional LAN sharing toggle if implemented
- local data directory information

Do not create an oversized settings system.

---

# 35. Theme Architecture

V1 built-in themes:

```text
Light
Night
```

Themes must not duplicate component implementations.

Use semantic tokens.

Future custom theme structure may look like:

```text
atlas-data/themes/
└── journal/
    ├── theme.json
    ├── theme.css
    └── preview.jpg
```

or equivalent.

Future themes may override:

- colors
- typography
- radius
- shadows
- textures
- map style
- marker appearance
- season palette
- image treatment

Do not allow themes to alter domain logic.

---

# 36. URL State

Even in local mode, support shareable-style URL state.

Examples:

```text
/
```

```text
/?place=bordeaux
```

```text
/?season=summer
```

```text
/?season=summer&place=lofoten
```

```text
/?profile=true
```

The visual experience remains single-page.

No traditional full-page reload navigation.

---

# 37. Responsive Behavior

Desktop is primary.

Desktop:

- fullscreen Europe map
- hover previews
- horizontal Timeline
- right Profile drawer
- spatial detail sheet

Mobile:

- fullscreen map
- no hover dependency
- tap = preview
- explicit second action = detail
- horizontal timeline swipe
- detail = bottom sheet
- profile = drawer/full-height sheet

Maintain the same information architecture.

---

# 38. Accessibility

Support:

```text
prefers-reduced-motion
```

Interactive elements must support keyboard use where practical.

Do not encode:

- visit state
- current state
- season

through color alone.

Maintain readable contrast in both themes.

---

# 39. Suggested Repository Structure

```text
yu-atlas/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   └── ...
│   │
│   └── runtime/
│       ├── cmd/
│       ├── internal/
│       └── ...
│
├── docs/
│   ├── PRODUCT_SPEC.md
│   └── design/
│       ├── VISUAL_SPEC.md
│       ├── wireframe.png
│       ├── light-reference.png
│       └── night-reference.png
│
├── examples/
│   └── atlas-data/
│
├── scripts/
│   └── build-release.*
│
└── README.md
```

A simpler layout is acceptable if it stays clean.

Do not over-engineer monorepo tooling if unnecessary.

---

# 40. Local Runtime Responsibilities

The Go runtime should be small and focused.

Responsibilities:

1. locate/create data directory
2. serve embedded frontend
3. expose local JSON API
4. read/write Atlas data
5. upload/read media
6. export `.yuatlas`
7. import `.yuatlas`
8. create automatic backups
9. open browser on startup
10. choose an available port
11. expose runtime mode information
12. proxy/normalize online geocoding requests
13. cache/throttle geocoding requests according to provider requirements

Do not place domain/UI logic into Go unnecessarily.

Frontend/domain code should remain responsible for presentation and derived UI structures.

---

# 41. Local API

Exact API design may evolve, but conceptually provide:

```text
GET  /api/profile
PUT  /api/profile

GET  /api/places
POST /api/places
PUT  /api/places/:id
DELETE /api/places/:id

GET  /api/visits
POST /api/visits
PUT  /api/visits/:id
DELETE /api/visits/:id

GET  /api/wishlist
POST /api/wishlist
PUT  /api/wishlist/:id
DELETE /api/wishlist/:id

GET  /api/media
POST /api/media

POST /api/export
POST /api/import

GET  /api/runtime
```

Avoid premature REST complexity.

Use the simplest coherent implementation.

---

# 42. Data Integrity

Do only necessary integrity checks.

Examples:

- referenced `placeId` must exist
- referenced `mediaId` should exist
- IDs must be unique
- import archive must contain valid manifest
- unsupported schema versions must fail clearly
- imported paths must be sanitized
- uploaded files must not escape media directory

Do not turn the project into an enterprise validation framework.

---

# 43. Security Boundaries

Because the runtime writes to the filesystem:

- bind to localhost by default
- sanitize archive extraction
- sanitize upload filenames
- prevent path traversal
- do not expose arbitrary filesystem browsing
- keep local editing unavailable to remote LAN clients by default

These checks are necessary.

Avoid unrelated hardening work beyond the actual threat model.

---

# 44. Initial Sample Data

Provide mock/sample content sufficient to validate interactions.

Example visited:

```text
Jülich / Aachen
Amsterdam
Barcelona
Bordeaux
London
Edinburgh
Athens
```

Use multiple visit types.

Current:

```text
Jülich / Aachen, Germany
```

Wishlist:

```text
Lofoten
Portugal
Greece
```

Use Summer as an initial Where Next example.

Do not spend major effort researching exact historical travel data.

---

# 45. Explicitly Out of Scope

Do not implement yet:

- Trips page
- itinerary builder
- route planning
- flight integration
- hotel integration
- budgets
- ratings
- travel statistics dashboard
- country completion percentages
- achievements
- accounts
- multi-user server
- comments
- social features
- public cloud sync
- Supabase
- CMS
- blog
- AI recommendations
- merge import conflicts

Leave extension points, but do not build unused features.

---

# 46. Engineering Priorities

Priority order:

1. clean domain model
2. portable runtime/data separation
3. reliable local file persistence
4. import/export
5. map/timeline relationship
6. scroll transition
7. interaction consistency
8. theme architecture
9. Manage Atlas workflow
10. responsive behavior
11. visual polish

Do not prioritize:

- test coverage metrics
- CI sophistication
- enterprise abstractions
- exhaustive defensive coding
- premature backend complexity

Implement only sanity checks necessary for trustworthy behavior.

---

# 47. Suggested Development Phases

## Phase 1 — Foundation

- repository structure
- domain types
- sample JSON data
- repository abstraction
- Go runtime
- local API
- geocoding-provider abstraction
- Photon V1 online search
- optional MapTiler provider support
- geocoding cache/proxy
- static frontend serving
- browser auto-launch

Goal:

```text
double-click → browser opens → data loads
```

---

## Phase 2 — Core Atlas

- fullscreen map
- visited/current markers
- marker hierarchy
- preview interaction
- scroll-driven collapse
- map strip
- Timeline skeleton
- seasonal timeline rendering

Goal:

validate the fundamental spatial/time experience.

---

## Phase 3 — Memory and Future

- Timeline cards
- Where Next
- seasonal filtering
- Place Detail Sheet
- Wishlist Inspiration
- Profile Drawer

---

## Phase 4 — Local Editing

- Manage Atlas
- add Visit
- add Wishlist
- edit existing data
- online place search/autocomplete
- geocoding result selection
- map confirmation/manual adjustment
- media upload

---

## Phase 5 — Portability

- `.yuatlas` export
- `.yuatlas` import
- automatic backups
- blank New Atlas
- release packaging

---

## Phase 6 — Polish

- Light/Night refinement
- motion
- responsive behavior
- accessibility
- theme extension points
- documentation

---

# 48. Development Method

Start by reading:

```text
docs/PRODUCT_SPEC.md
docs/design/VISUAL_SPEC.md
docs/design/wireframe.png
docs/design/light-reference.png
docs/design/night-reference.png
```

Priority when references conflict:

```text
PRODUCT_SPEC
>
VISUAL_SPEC
>
wireframe
>
generated visual references
```

The generated images are directional references only.

Do not reproduce:

- fake text
- incorrect coordinates
- fake dates
- generated image artifacts
- arbitrary icons
- UI elements not defined in the specifications

Work incrementally.

Produce functioning UI early.

Do not spend long periods writing planning documents before implementation.

---

# 49. Final Product Principle

Whenever uncertain, optimize for:

> personal memory rather than travel management

and:

> visual storytelling rather than dashboard density

The application should feel like opening a personal atlas:

1. geography appears first
2. scrolling reveals chronology
3. memories sit to the left of NOW
4. possibilities extend to the right
5. seasons organize future imagination
6. photographs carry emotion
7. clicking a place reveals its personal story
8. data remains owned locally by the user

Yu's Atlas should be portable enough to send to a friend as an application, yet personal enough that each person's `.yuatlas` file represents their own travel history and imagination.