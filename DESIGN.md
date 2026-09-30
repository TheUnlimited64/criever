# Criever review workspace

## 1. Atmosphere and identity

A readable, precise review desk, not a documentation landing page. IBM Plex gives the
interface an engineering voice; generous line height, quiet layered surfaces, and one
blue action color keep the code in charge. The signature is the explicit comparison
strip: workspace identity, review identity, and review tools are separate levels.

This extracts the existing CSS-variable system and component composition rather than
introducing a UI library. ui-ux-pro-max searches for developer typography, minimalism,
focus, contrast, and responsive navigation support this direction. Keep the existing
locally hosted IBM Plex Sans / Mono pairing rather than adding another font. The
documentation landing pattern from the parent search does not fit a review application.
The frontend redesign and layout references inform the bounded list-detail shell.

## 2. Color

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Desk | --bg | #F3F5F8 | #0F1217 |
| Panel | --panel | #FFFFFF | #161A21 |
| Nested surface | --panel-2 | #EAF0F6 | #222936 |
| Divider | --line | #D8E0EA | #303A49 |
| Control edge | --line-strong | #AEBACB | #556176 |
| Main text | --ink | #172334 | #EEF2F8 |
| Secondary text | --ink-2 | #43546B | #C0CAD8 |
| Metadata | --ink-3 | #53647A | #A8B6C9 |
| Action / focus | --accent / --focus | #2458C6 | #9EB9FF |
| Action text | --on-accent | #FFFFFF | #101A2D |
| Selected wash | --accent-soft | #E8EFFD | #253550 |
| Added text | --add | #176638 | #8CE4AD |
| Added fill / gutter | --add-bg / --add-line | #EDF8F0 / #E0F1E6 | #13291F / #193328 |
| Removed text | --del | #A62C39 | #FFAAAE |
| Removed fill / gutter | --del-bg / --del-line | #FFF0F1 / #F9E2E6 | #301D25 / #3B2530 |
| Warning text / wash | --amber / --amber-bg | #7B520F / #FFF3D9 | #F0CA83 / #392D1B |
| Resolved marker | --resolved | #53647A | #A8B6C9 |
| Scrim | --scrim | rgba(15,18,23,.4) | rgba(15,18,23,.7) |

Syntax roles stay semantic: keyword, string, number, type, method, parameter, variable,
key, metadata, comment, documentation, punctuation. The CSS declarations are the exact
palette source. All syntax roles must clear 4.5:1 on plain, added, and removed fills,
not just the desk background. Status always includes text or a glyph, never color alone.

## 3. Typography

- UI: IBM Plex Sans, system-ui; code and paths: IBM Plex Mono, ui-monospace.
- Scale: --text-xs 12px (metadata), --text-sm 14px (controls/body/code),
  --text-md 16px (panel titles), --text-lg 18px (review heading),
  --text-xl 24px (markdown h1). Markdown h2/h3/h4 use 18/16/14px.
- Weight: 400 body, 500 control labels, 600 headings.
- Line height: --leading-body 1.5, --leading-code 24px, --leading-heading 1.3.
- Tabular numbers for counts, hashes and progress; prose measure 65ch.
- Long review names and paths wrap or ellipsize deliberately; full values remain in titles.

## 4. Spacing and layout

4px spacing scale: --space-1 through --space-6 = 4, 8, 12, 16, 20, 24px;
--space-8 = 32px. A --space-half 2px optical spacing is reserved for small glyphs.
Controls use --control-sm 32px and --control-md 40px; banner controls use
--control-inline 24px. Compact code gutters retain
24px row height because code is tabular content.

The app is a scroll-body shell bounded by 100dvh. Header and footer are fixed grid
regions; the file tree, code body, and comment rail own their respective scroll.
No whole-page horizontal overflow; long code has an intentionally local horizontal
scroll. Wide layouts use files (280px), flexible code, comments (320px).

Below 1200px, an explicit Files / Code / Comments selector makes every panel reachable.
The middle layout keeps files beside code, or files beside comments when selected.
Below 760px, exactly the selected panel is visible. Opening a file or an inline
comment selects Code; opening a general comment leaves Comments visible.
Panels remain mounted so composing and panel toggles do not discard draft text.
Comparison metadata and review tools wrap independently on narrow screens.

## 5. Components

- **Workspace header**: brand and provider/repository context, then review title,
  Overview & commits action, draft count and Save/Publish. It is not project navigation.
  A separate comparison strip names base, head, scope, and read-only state.
- **Review tools**: real Files, Search, Find and Keyboard shortcuts actions; labeled
  buttons, not icon-only mystery controls. Panel selector uses aria-pressed.
- **Button / segment**: existing .btn / .seg primitives. Neutral default, tonal hover,
  pressed opacity, focus ring, visibly disabled state; primary uses --on-accent.
  Peer options have equal height and expose aria-pressed.
- **File row**: independent accessible viewed checkbox and file-open button, path
  tooltip, textual change status, draft/open/change indicators with accessible names.
  A review progress meter and exact viewed count share the filter area.
- **Comment group / card**: sentence-case group labels, readable preview lines,
  author/location context, state chips, wrapping actions. Neutral card edges; draft
  state and changed state are textual rather than colored borders.
- **Composer**: named textarea, named formatting actions, local/provider-aware help,
  preview, save/cancel/error states. Persistent mounting remains unchanged.
- **Sheet**: bounded modal with keyboard focus containment, named dialog, Escape,
  backdrop close, close control, and focus restoration.
- **Empty / loading / error**: explanatory text at the relevant panel, not fake content.

## 6. Motion and interaction

--duration-fast 120ms, ease-out. Only opacity and transform animate. Button press and
modal entry are meaningful feedback; no ambient motion. Reduced motion disables
positional entry and preserves immediate state feedback. Existing shortcuts remain
unchanged. Shortcut labels use Ctrl on Windows/Linux and Cmd on Apple platforms,
with readable Shift and Enter names across the header, footer, keymap, and composer.
Focus-visible uses a 2px --focus ring with 2px offset.

## 7. Depth and surface

Mixed system: tonal panel layering and neutral dividers; --shadow is reserved for
overlays/toasts. Radius: --radius-sm 4px, --radius-md 8px, --radius-lg 12px,
--radius-full 999px. Rounded-square avatars match the technical character.
Neither selected rows nor status cards use accent-colored edges.

## 8. Accessibility constraints and accepted debt

Target WCAG AA text contrast, visible keyboard focus, named inputs, button semantics,
independent checkboxes, readable status text, and no emoji icons. Responsive panel
selection must work at 375, 768, and 1280px. Inline comments remain anchored using the
existing review-head contract; older commit comparisons are visibly read-only.

Future extension: a daemon-level projects screen should sit above workspace context;
entering a project should establish repository identity and branch context there.
Branch switching and returning to Projects belong at that level, not among review
tools. No project CRUD, daemon controls, fake navigation, or custom review-base API
is implemented. The comparison strip can accept a future explicit base selector when
the backend contract exists; today it displays merge-base/range and source head.

Parent owns dependency changes, automated tests/build, and final real-browser QA.
No additional React or Lighthouse tooling is installed in this implementation track.
Existing timers and polling semantics outside layout are preserved, not broadened.
