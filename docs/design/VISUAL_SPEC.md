# Yu's Atlas — VISUAL_SPEC

## 1. Purpose

This document defines the visual and interaction system for **Yu's Atlas**.

The public-facing Atlas should feel:

- calm
- spatial
- editorial
- cartographic
- personal
- photographic

It must not resemble:

- a SaaS dashboard
- a booking platform
- an admin panel
- a gamified travel tracker
- a generic travel template

The local **Manage Atlas** interface is allowed to be more utilitarian, but it must remain visually consistent with the core theme.

Reference priority:

1. `PRODUCT_SPEC.md`
2. `VISUAL_SPEC.md`
3. `wireframe.png`
4. Light/Night reference images

Generated reference images are directional only.

---

# 2. Narrative Structure

The page is one continuous visual story:

```text
SPACE
Hero Map
   ↓
map collapses
   ↓
TIME
Journey Timeline
   ↓
FUTURE
Where Next
```

Place details and Profile exist as spatial overlays rather than conventional page navigation.

The visual hierarchy is:

1. Hero Map
2. Timeline
3. Where Next
4. Place Detail
5. Profile
6. Local Manage Atlas utility

---

# 3. Hero Map

## 3.1 First Viewport

Initial state:

```text
width: 100vw
height: 100vh
```

Requirements:

- no visible outer border
- no card frame
- no large header
- minimal controls
- Europe framing
- visited/current location pins
- subtle visited-country polygons/outlines derived from visited Places

The map is the page.

Avoid placing Wishlist locations on the default hero.

Countries never receive pins.

---

# 4. Map Marker System

Semantic hierarchy:

```text
current
>
lived
>
trip
>
day_trip
>
stopover
>
transit
```

Suggested visual language:

```text
◎ Current
● Lived / Trip
◌ Stopover
· Transit
```

Current location:

- strongest marker
- subtle concentric ring
- optional low-amplitude pulse
- label visible by default

Other labels:

- selective
- reveal with hover / zoom
- avoid dense European text clutter

---

# Country Polygon Treatment

Visited countries are shown only as a low-priority map background layer.

Light theme:

- extremely pale fill or slightly stronger border
- low saturation
- must not compete with location markers

Night theme:

- slightly elevated navy/blue-gray fill
- restrained border luminance
- no neon glow

Visual hierarchy:

```text
Current location
>
Visited location pins
>
Visited-country polygon
>
Base map geography
```

Users should notice visited locations first and visited-country coverage second.

Country polygons do not open cards and do not behave like Place markers.

---

# 5. Map Interaction

Hover:

- location
- country
- date
- visit type

Click:

- focus marker
- subtle map shift if needed
- open spatial preview card
- do not immediately launch full detail

Only one preview at a time.

The card should feel connected to its source marker.

---

# 6. Scroll Map Transition

The map collapse must be continuous.

Concept:

```text
100vh
 ↓
70vh
 ↓
40vh
 ↓
80–140px strip
```

Use scroll progress.

Visual behavior may include:

- gradual vertical translation
- height reduction
- subtle camera adjustment
- bottom content entering gradually
- border radius introduced only after the map is no longer full-bleed

Avoid:

- abrupt snap
- aggressive parallax
- map rotation
- dramatic zoom
- excessive spring physics

The effect should communicate:

> space making room for time

Scrolling upward restores the map naturally.

---

# 7. Journey Timeline

The Timeline is horizontal.

Core model:

```text
Past ←──────── NOW ─────────→ Future
```

NOW should be near the viewport center when the Journey section first becomes active.

Support:

- horizontal drag
- trackpad
- touch swipe
- restrained navigation arrows if useful

The Timeline should feel like a continuous temporal landscape, not a carousel of cards.

---

# 8. Seasonal Timeline Color

Season is represented primarily by the **timeline line itself**.

Do not use large seasonal bars.

Semantic palette:

```text
Spring → green
Summer → gold/yellow
Autumn → amber/orange
Winter → blue
```

Season may also influence:

- node outline
- tiny glow
- small date accent
- small icon
- label

Season transitions should be smooth or gently segmented.

Avoid large filled rectangular backgrounds.

---

# 9. Timeline States

Suggested state language:

```text
● visited
◎ current
○ future / wishlist
```

Visit depth can influence size / opacity.

Current marker should be visually dominant without looking like an alarm state.

Past:

- personal photos
- real visit date
- place name
- visit type

Future:

- inspiration image
- target season/year if known
- place
- wishlist

---

# 10. Timeline Photo Treatment

Timeline imagery should act as memory fragments.

Use:

- small/medium restrained images
- consistent proportions
- minimal cropping distortion
- generous surrounding whitespace

Do not turn Timeline into a dense photo gallery.

Past images should preferentially be the user's own.

Future images may be inspiration images.

---

# 11. Where Next

Where Next is a curated inspiration shelf.

It remains visually part of the Journey experience.

Season selector:

```text
Spring   Summer   Autumn   Winter
           ───
```

The selected season uses:

- underline
- text emphasis
- subtle semantic season color

Do not use heavy tab buttons.

---

# 12. Where Next Layout

Use editorial hierarchy.

Preferred:

```text
[ primary destination ] [ secondary ]
                        [ secondary ]
```

not:

```text
[ equal ][ equal ][ equal ][ equal ]
```

Primary card:

- dominant image
- place
- country
- target time
- `why`
- inspiration source
- subtle open affordance

Secondary:

- smaller image
- place
- short descriptor

Where Next should feel aspirational, not searchable.

---

# 13. Card Hierarchy

Country display:

Every location preview/card/detail should normally show country context directly beneath or beside the place name.

Example:

```text
Bordeaux
France
```

The country is metadata, not a separate clickable Place.



Three levels:

## 13.1 Micro Preview

Hover/focus only.

Contains:

- place
- country
- date/season
- state

No long text.

---

## 13.2 Expanded Preview

After click.

Contains:

- place
- metadata
- one image or small set
- short personal context
- open-detail action

Use shared-layout transitions where practical.

---

## 13.3 Detail Sheet

Use a spatial sheet, not a centered modal.

Desktop:

- right-side sheet or large bottom sheet
- page remains visible
- subtle dim
- background may scale to ~96–98%

Mobile:

- near-full-height bottom sheet

Visited details:

- date
- visit type
- friends status
- photos
- highlights
- reflection

Wishlist details:

- why
- target time
- inspirations
- images
- links
- notes

---

# 14. Profile Drawer

Open from the right.

Target desktop width:

```text
min(420px, 90vw)
```

Underlying page may:

- shift slightly
- scale slightly
- dim minimally

Profile contains:

- avatar
- name
- base
- short bio
- interests
- links
- Manage Atlas entry in local writable mode

Profile and Place Detail may not stack.

---

# 15. Manage Atlas Visual Role

Manage Atlas is a utility layer.

It does not need to preserve the cinematic layout of the Atlas itself.

However:

- use the same typography
- use the same semantic theme tokens
- use the same radius system
- use the same Light/Night theme
- keep forms clean and sparse

It may use:

- lists
- forms
- tabs
- tables where necessary

because it is a management interface.

Do not let management UI components leak into the main Atlas experience.

---

# 16. Add/Edit Forms

Forms should prioritize clarity over visual experimentation.

**Online location search is the primary Place input in V1.**

The search field should support:

- search-as-you-type when the selected provider supports it
- keyboard navigation
- loading state
- clear country/region context
- geographic type
- empty/error state

Selecting a search result should naturally transition into map confirmation.

```text
Search location
┌──────────────────────────────┐
│ Lofoten                      │
└──────────────────────────────┘

Lofoten, Nordland, Norway
Region

             ↓ select

┌──────────────────────────────┐
│          map preview         │
│              ●               │
└──────────────────────────────┘

[ Use this location ]
```

The user may drag the marker before saving.

Raw latitude/longitude should not be presented as the normal data-entry path.


Recommended layout:

```text
Field label
Control

Field label
Control
```

Avoid cramped two-column forms unless desktop width clearly benefits.

Media upload:

- drag/drop zone
- preview thumbnails
- clear remove action

Location:

- map picker
- readable place/country fields

Reflection / Notes:

- generous text area
- no forced character limit unless technically necessary

---

# 17. Import / Export UI

Keep it simple.

Example:

```text
Export Atlas
Create a portable .yuatlas backup containing your data and media.
[ Export ]

Import Atlas
Replace the current Atlas with a .yuatlas file.
A backup will be created first.
[ Choose file ]
```

Clearly distinguish:

- export
- replace import
- automatic backup

Do not create frightening enterprise-style warning dialogs.

Use concise confirmation for destructive replace import.

---

# 18. Light Theme

Mood:

- airy
- quiet
- natural
- cartographic
- warm
- editorial

Direction:

- warm white background
- white/near-white surfaces
- charcoal text
- subtle warm-gray borders
- low-saturation pale map
- gentle shadows

Starting tokens:

```css
--bg: #F7F6F2;
--surface: #FFFFFF;
--surface-elevated: #FCFBF8;
--text-primary: #1E1E1C;
--text-secondary: #6F726E;
--border: #E4E2DC;
--accent: #2563EB;
```

Avoid sterile pure-white SaaS appearance.

---

# 19. Night Theme

Mood:

- cinematic
- geographical
- quiet
- deep
- photographic

Direction:

- deep navy rather than black
- slightly lighter navy surfaces
- warm off-white primary text
- blue-gray secondary text
- subtle city-light map
- warm visited markers
- cool current marker

Starting tokens:

```css
--bg: #08121F;
--surface: #111827;
--surface-elevated: #151E2D;
--text-primary: #F2F0E9;
--text-secondary: #94A3B8;
--border: #243244;
--accent: #38BDF8;
```

Avoid:

- cyberpunk neon
- exaggerated glow
- gamer UI
- glassmorphism everywhere

---

# 20. Season Tokens

Semantic meaning remains stable across themes.

Example starting palette:

```css
--season-spring-light: #8FC89B;
--season-summer-light: #F4C95D;
--season-autumn-light: #E98A4A;
--season-winter-light: #80A9D4;

--season-spring-night: #70C58B;
--season-summer-night: #F1B83A;
--season-autumn-night: #F08A3C;
--season-winter-night: #6FA8E7;
```

Themes may alter:

- luminance
- saturation
- glow
- contrast

but not semantic association.

---

# 21. Typography

Primary UI:

- Geist
- Inter
- equivalent modern sans-serif

Optional wordmark:

- restrained serif
- or signature-like accent

Do not use handwritten/decorative typography throughout.

Suggested scale:

```text
Wordmark/display     32–48px
Section title        24–32px
Card title           18–24px
Body                 14–16px
Metadata             12–14px
Micro label          11–12px
```

Avoid huge marketing headings.

---

# 22. Spacing and Geometry

Prefer generous negative space.

Suggested radius:

```text
small controls   8–10px
small cards      12px
large cards      16px
detail sheets    20–24px
```

Avoid excessive pill UI.

Spacing scale:

```text
4
8
12
16
24
32
48
64
```

---

# 23. Elevation and Shadows

Light:

- shallow
- soft
- low contrast

Night:

- use tonal separation more than shadows
- restrained borders
- little glow

Cards should feel integrated with the Atlas rather than floating above an app dashboard.

---

# 24. Motion

Unified motion grammar:

```text
Focus
↓
Expand
↓
Explore
↓
Collapse
```

Suggested duration:

```text
micro interaction   150–220ms
preview expansion   250–400ms
sheet transition    300–450ms
map collapse        scroll-driven
```

Use:

- smooth ease-out
- ease-in-out
- shared layout transitions when useful

Avoid:

- bouncy toy-like motion
- exaggerated springs
- large entrance animations

Respect:

```text
prefers-reduced-motion
```

---

# 25. Image Treatment

Past:

- user's own photos

Future:

- inspiration images

Treatment:

- natural crop
- minimal filtering
- restrained radius
- preserve photographic character
- avoid collage overload

Where Next may use large cinematic images.

Timeline should use smaller memory fragments.

Detail may display larger photography.

---

# 26. Theme Extensibility

Components consume semantic tokens.

Do not hardcode theme colors throughout components.

Required built-in themes:

```text
Light
Night
```

Future examples:

```text
Journal
Japanese Minimal
Film
```

Potential structure:

```text
src/themes/
├── types.ts
├── light.ts
├── night.ts
└── ...
```

Custom local themes may later live under:

```text
atlas-data/themes/
```

Theme-configurable areas:

- colors
- typography
- radius
- shadows
- texture
- map style
- marker style
- season palette
- image treatment

Theme files must not change data/domain logic.

---

# 27. Responsive Behavior

Desktop primary.

Desktop:

- fullscreen map
- hover support
- horizontal Timeline
- right Profile
- spatial detail sheet

Mobile:

- fullscreen map
- tap instead of hover
- swipe Timeline
- bottom-sheet detail
- compact Profile drawer/sheet
- Manage forms stack vertically

Same information architecture across devices.

---

# 28. Accessibility

Interactive UI must remain usable without color-only semantics.

Provide:

- state labels/icons where appropriate
- sufficient contrast
- keyboard navigation for key controls
- visible focus states
- reduced-motion handling

Night theme must not sacrifice readability for atmosphere.

---

# 29. Visual Anti-Patterns

Do not introduce:

- KPI dashboards
- travel scorecards
- completion percentages
- star ratings
- achievements
- dense permanent map labels
- equal-weight destination grids
- giant season bars
- excessive glassmorphism
- multiple stacked modals
- heavy top navigation
- floating-button clutter
- generic tourism icon overload
- random gradients
- large admin UI on the main Atlas

---

# 30. Reference Interpretation

Use reference images for:

- overall composition
- map dominance
- Light/Night atmosphere
- timeline proportions
- thin season-colored line
- NOW emphasis
- Where Next hierarchy
- photography balance
- card scale
- information density

Do not copy:

- generated fake text
- fake dates
- wrong coordinates
- arbitrary marker counts
- image-generation artifacts
- unwanted large season bars
- accidental UI inconsistencies

The written specifications always win.

---

# 31. Final Visual Principle

Yu's Atlas should feel like:

> opening a personal atlas, seeing where a life has moved through space, then sliding through time into memories and possibilities.

The first act is geography.

The second act is chronology.

The future is seasonal.

The photographs carry emotion.

The local management tools remain quiet and functional in the background.

The public-facing Atlas must remain calm enough that the map, time, places, and memories are always the main characters.
