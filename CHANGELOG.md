# Changelog

## Phase 9 — a website for students abroad

The Atlas becomes something classmates can use: a website as well as a
local program, comfortable on a phone, and shaped around studying abroad.
Direction and next steps: `docs/ROADMAP.md`.

### Website
- Cloud mode (`-mode cloud`): email accounts, one private Atlas per user,
  argon2id passwords, signed session cookies, per-user storage quota, rate
  limits, Host/Origin checks; sign-in screen and account settings (sign out
  everywhere, change password, delete account). Local mode is unchanged.
  Deployment guide: `docs/DEPLOY.md`, `deploy/`.
- Installable web app (PWA): manifest, icons, iOS web-app tags.
- Manage Atlas on phones: section tabs on top, full-width rows.

### Study abroad
- Activities on visits (16, with their own line icons); the primary one is
  the place's pin on the map; a bare stopover shows a moon.
- Study-abroad periods on the Profile: arrival, trips home, final return;
  "Day N", days abroad, countries and places per stay; Timeline milestones
  and a band for the time abroad.

### Fixes
- Saving the profile no longer drops fields the form does not edit.
- `ATLAS_RUNTIME` moves the dev proxy without making the browser call the
  runtime cross-origin (cloud sign-in looped with `NEXT_PUBLIC_API_BASE`).

## Phase 8 — design & experience

The Claude Design redesign (`docs/Yu's Atlas page redesign.zip`) carried
through every surface, plus the features that make the atlas feel finished.

### Design
- New header: compass-rose wordmark named after the profile, search / theme /
  profile pills; actions settle over the collapsed strip with *Expand map*.
- Hero Map restyled per theme from one palette-driven adapter: shaded relief,
  sea names at hero zoom, night city lights, country wash trimmed by the real
  coastline, collision-aware labels on every visited place, memory cards with
  photos, custom zoom / reset / layers controls.
- Scroll collapse keeps the map full-bleed, then insets it into a rounded
  strip centred on the current base.
- Journey Timeline rebuilt: season marks above the line, photo fragments
  below, NOW pill and rule, *Where next?* node, arrows, scroll indicator.
- Where Next rebuilt: season tabs with counts, cinematic primary card with
  season badge, flag and inspiration row, photo-topped companions, *Also
  dreaming of*, empty-season suggestions.
- Place Detail: large photographic hero, facts chips, pull-quote reflection,
  every visit, inspiration cards, gallery + full-screen lightbox, *Show on
  map*, previous / next through the journey (← →).
- Profile: quiet facts line, flags of visited countries, recent memories,
  theme and language pickers, avatar upload.
- SVG country flags (flag emoji do not render on Windows).
- Liquid glass for chrome over the map and photographs: tinted, frosted panes
  with a specular rim that refract the map at their edges in Chromium; frosted
  elsewhere, solid with *reduce transparency*. Tuned per theme.

### Themes
- Light, Night, **Journal**, **Minimal**, **Film** and **Auto** (follows the OS).
  Themes cover colour, self-hosted typography, radii, shadows, paper / grain
  textures, photo treatment, map palette, relief, city lights, markers, route
  style and season palettes. No flash of the wrong theme on load.

### Features
- English / 简体中文 interface (Atlas and Manage Atlas), localized dates and
  Chinese basemap names.
- ⌘K / `/` command palette: places, memories, wishes (accent-insensitive,
  searches highlights and reflections), commands; keyboard shortcuts (`?`).
- *All ideas* board; map layers (routes, wishlist pins, country wash);
  *Save map as image* poster.
- Map: a small country flag planted on every visited place; a clearer wash
  over visited countries; wishlist-only countries hatched in the wish colour;
  wishlist pins with their names, shown by default.
- Routes by transport (`visit.transport`: plane by default, train, bus, car):
  dashed flight arcs with a turning plane, rail with sleepers, roads with a
  centre line, each vehicle at its route's midpoint; chosen in the visit form
  and shown in the place detail and memory card.
- Share as a ticket: one trip as a boarding pass (or a train / bus / drive
  ticket, by its transport) with its photo, route, dates and reflection; a
  country as a multi-city pass with its outline and itinerary; the whole
  journey as an atlas pass with flags and itinerary. Drawn on a canvas in the
  active theme (paper, grain, type, photo treatment), with perforation,
  notches and a decorative barcode; download, copy, or system share. From
  the place detail, the profile and ⌘K.
- Manage Atlas: *Polish your Atlas* checklist, backups list with restore /
  delete, local-network sharing with QR codes, language and theme settings,
  thumbnails in media grids; empty-atlas call-to-actions.

### Runtime
- Read-only LAN sharing (`-lan` or Settings), applied live; DNS-rebinding and
  cross-site-write protection for the local API.
- `/media/*?w=N` thumbnails (EXIF-aware, cached outside the data dir).
- Backups API: list / restore / delete; unique backup names.
- Settings: `showWishlist`, `hideCountries`, `language`.

### Quality
- Vitest suite for the domain layer, map adapter, Chinese formatting and a
  WCAG contrast guard for every theme; Go tests for storage, API, LAN policy,
  thumbnails and backups. Axe audit clean on the main page.
- Fixed: consecutive settings saves (theme, routes) overwriting each other;
  settings saved before they had loaded (or after a failed load) replacing
  the whole file; the country wash and routes vanishing after a theme or
  language switch; the Light theme flashing before a stored theme on load;
  Escape on the discard prompt throwing edits away; ⌘K opening over Manage
  Atlas, the lightbox and editors; a deleted `?place=` locking the page; a
  closing sheet dismissing the one opened right after it; the profile avatar
  upload undoing text typed meanwhile; route-segment emphasis never showing.

### Sample data
- CC-licensed photos for every visit, highlights and reflections, a video
  inspiration — so the demo atlas looks like the design.
