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

The daemon-level projects screen sits above review context. Project navigation never
enters review tools. The comparison strip displays merge-base/range and source head.

Parent owns dependency changes, automated tests/build, and final real-browser QA.
No additional React or Lighthouse tooling is installed in this implementation track.
Existing timers and polling semantics outside layout are preserved, not broadened.

## 9. Daemon review desk

The reviewer starts with what needs attention, then chooses a repository. A compact
summary band links to Updates since your review and Assigned to me lists. Projects
are neutral divided rows, not oversized cards. PR rows have a strong title action,
quiet repository/author/branch metadata, textual review status, and separate local
tracking controls. All open PRs is the default project view; Assigned to me is an
explicit pressed filter. Local marking is never called provider approval.

Reuse .btn, .seg, .chip, .sheet and Overlay focus containment/Escape/restoration.
New reusable patterns: desk section (label/count + divided list), PR row
(identity, status, actions), project row (repository, local path, counts), inline
error (message + retry), and daemon breadcrumb strip above the existing Header.
New layout tokens: --desk-width 1120px, --space-12 48px. Existing font sizes,
semantic light/dark colors, control sizes and radii remain the only visual scale.

The desk is a scroll-body shell: navigation remains fixed; .desk-scroll owns scroll.
Session reviews use an outer auto/minmax(0,1fr) shell; the existing .app fills its
remaining height and retains its panel scroll ownership. At 375px rows become
stacked details with wrapping actions; at 768px the list remains compact; at 1440px
the centered desk has generous gutters. Paths and titles wrap anywhere; metadata
never imposes a minimum viewport width. DOM order is the keyboard order, native
links provide breadcrumbs, and every filter exposes aria-pressed.

Workspace polling updates indicators without resetting form text or filters and
without sorting rows by live status. Loading and failed bootstrap have retry
surfaces; only a 404 enables standalone review. Add-project retains entered paths
on failure. Opening a PR first asks to prepare a local checkout; only affirmative
confirmation sends the checkout POST. Copy must not promise an untouched original
working copy until the backend confirms that contract. Session navigation is a
full-page load to reset review state and query caches; saved drafts remain backend
owned. Leaving with unsaved composer text asks for confirmation.

Accessibility: visible focus, named path input, alert errors, live operation feedback,
textual status, no hover-only controls. Accepted verification debt for this worker:
parent owns backend fixtures and real-browser checks at 375/768/1440, dialog keyboard
interaction and session isolation. No browser or Lighthouse result is inferred.

Project selection uses one editable path combobox. UI Pro Max's Autocomplete
and Keyboard Navigation guidance applies: offer matching folders as the user
types, without requiring Go or a separate browse mode. Arrow keys highlight,
Enter/Tab complete a highlighted suggestion, Escape dismisses suggestions before
closing the dialog, and pointer selection preserves input focus. Completing a
folder adds its separator so typing can continue into subfolders. An unmodified
Enter submits an exact typed path. Home shorthand remains supported.

Suggestions come from the daemon filesystem; requests are cancellable and keyed
by the current input so obsolete responses cannot replace current results.
The inline suggestion list owns at most 40dvh of scroll. Rows use a folder glyph,
name and wrapping full path; highlighted rows use --accent-soft rather than an
accent border. Loading, no matches and access errors are separate visible states.
Existing typography, spacing, focus, surface and radius tokens are reused.

Checkout confirmation uses a labeled native radio group with two choices:
Temporary checkout (default, system temporary directory) and Actual repository.
The latter explicitly explains detached HEAD, clean-worktree requirements and
that the checkout stays in place after leaving. The chosen destination is sent
only on affirmative confirmation. Review navigation displays its destination
and path. Radio rows wrap on mobile without hiding the explanation.

# Criever design system

## 1. Atmosphere & Identity

A quiet, dense code-review workspace. The signature is a three-region reading surface: file tree, diff, and a contextual rail, with restrained blue action accents and amber guidance. AI assistance is visually distinct from PR comments and never implies publication. The AI rail is a private workbench attached to the diff, not a second generic form: review action, conversation, and compose area have separate visual jobs.

## 2. Color

The existing `packages/web/src/tokens.css` defines light and dark palettes. Use `--bg`, `--panel`, `--panel-2` for surfaces; `--line` and `--line-strong` for boundaries; `--ink`, `--ink-2`, `--ink-3` for hierarchy; `--accent` and `--accent-soft` for interactive and pending states; `--amber` and `--amber-bg` for look-out guidance; `--del` and `--del-bg` for errors. No new raw colors in components.

## 3. Typography

IBM Plex Sans is the UI face and IBM Plex Mono identifies paths, code, and numbers. Existing scale: 11px labels, 12px secondary controls, 13px body, 14px header, and 12.5px diff monospace. Keep generated responses readable at body size and wrap long text.

## 4. Spacing & Layout

The shell has a fixed header and footer, with independently scrolling file tree, diff body, and rail. Existing widths are 260px tree and 300px rail on wide viewports. Use the established 4px spacing rhythm (4, 8, 12, 16, 24px). The AI rail keeps its compact heading, harness and review controls, two navigation tabs, and composer in view; only the selected conversation or findings panel scrolls. At <=1000px it overlays the diff, at <=520px it fills the viewport and the header exposes a touch-accessible file palette because the file tree is hidden. Closing the rail returns to readable code without cancelling or forgetting an in-flight AI task. The diff remains the primary reading surface.

## 5. Components

### Action button and chip
- **Structure**: native button plus text; chips are noninteractive unless they contain an explicitly labelled button.
- **Variants**: primary, neutral, ghost, amber, blue.
- **States**: hover, keyboard focus, busy, disabled, error; action labels never silently change publication intent.
- **Layout**: wrapping cluster in cards, fixed grouping in the header.

### Review card and composer
- **Structure**: labelled header, readable body, contextual actions, inline textarea with visible label. A private question is a quiet annotation within the code reading surface, not a raised comment card: a slim neutral rule and typographic header establish its anchor, the writing area is the only inset field, and the submit action is a neutral control with an explicit privacy note.
- **Variants**: existing comment/draft; new private question, AI finding, amber look-out.
- **States**: loading, editable, error, approved or removed. A private question never becomes a normal comment draft. Approving a finding creates a normal draft; editing/rewording does not. The line composer opens on PR comment and has a compact, labelled, mutually exclusive comment/private-AI toggle directly attached to the card above its input. Switching modes never sends or publishes content. Once answered, a contextual thread retains an inline follow-up composer for back-and-forth on the same anchor.
- **Layout**: inline under the anchored diff row; diff body owns scrolling. Use the same annotation structure for line and file questions, current-revision follow-ups, and earlier-revision read-only history. No colored side stripe, oversized filled CTA, or badge is used to identify private AI content. In dark mode the surface stays within the existing dark tonal ramp rather than adding a brighter card.

### AI rail
- **Structure**: a clear "AI workbench" heading with close action; compact harness/review toolbar; two equally sized Chat and Findings tabs with the same spacing, height, and focus treatment; one scrollable active panel; and a bottom-anchored chat composer when Chat is selected. The Findings tab and an AI findings group in the ordinary comments rail show every retained finding and look-out, grouped by review run. Each row names its path, line, type, and a readable excerpt; selecting it opens its actual anchored result. Empty states teach the relevant next action.
- **States**: no harness (configure guidance), ready, independently running chat and one or more reviews, completed reviews (including zero findings), inline error, general chat empty/populated, contextual summaries empty/populated. Starting another review preserves previous runs and their findings; completing them out of order does not lose either. Review progress remains visible while chat is usable, even after closing and reopening the AI rail. Completion persists per run across reload. A pending chat has a visible placeholder; only that conversation's submit is disabled while it is awaiting a reply. Results and answers do not interrupt an unsent question or jump the active tab.
- **Layout**: right-side bounded panel. Hierarchy comes from existing `--panel` / `--panel-2` tonal surfaces, `--line` dividers, IBM Plex Sans for content, mono for paths/status and `--accent` for the one active control. No free-floating giant textarea or repeated labels.
- **Diff line action**: one native, keyboard-focusable button in each actionable gutter row of unified and split tables opens the inline line composer. A flush text-tab choice with a bottom rule chooses PR comment (default) or private AI question; no pill group or separate AI button competes with the `+`.
- **File AI action**: a visible "Ask about file" button in the code header opens a private composer immediately below the header for the current head revision, including files with no changed lines. The associated private answer remains at the file header. History and read-only ranges do not offer this action.
- **Inline AI result**: finding and look-out annotations remain anchored under their diff lines after the rail closes. Private Q&A history is an open transcript with quiet role labels and restrained dividers, not a stack of cards; its follow-up field remains inline and is not a comment draft. Approval alone converts a finding to a normal draft. AI responses in the rail and on code render Markdown paragraphs, links, lists, and code using the existing escaped renderer; generated text never becomes executable HTML.

## 6. Motion & Interaction

Existing cards use a 120ms opacity/transform entry only when reduced motion is not requested. Async AI actions enter a visible pending state immediately, with three small accent dots using staggered opacity/transform pulses (beui.dev loader's stateful mechanism, implemented in CSS with no motion dependency). The label names the actual activity, never fakes a percentage. On `prefers-reduced-motion: reduce`, dots stay still and the text remains present. Error/success replaces pending content without a layout animation. Keyboard focus remains visible and status changes use `role="status"`/`aria-live="polite"`.

The Chat/Findings switch uses a low-height segmented control with an ink/accent active state, no animated layout movement, and no gap change between selections. Results navigation changes only the active rail and diff scroll position; it does not publish anything. Keyboard users can tab through every result and re-open a thread from its anchor.

## 7. Depth & Surface

Mixed existing strategy: panel/background tonal separation, one-pixel borders on cards and rails, `--shadow` only for elevated overlays. Inline AI content uses neutral rules, spacing, and type hierarchy; accent belongs to focused controls and links, amber to look-out text, never to a decorative edge or filled AI badge.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA for newly added controls: explicit labels, keyboard operation, visible focus, readable light/dark contrast, reduced-motion support, and text wrapping for unbroken code/path content. The primary persona is a reviewer scanning code at desktop width; the constrained persona is a narrow-viewport or keyboard-only reviewer who cannot discover hover-only actions. Both must reach the line and file composer without guessing. No new accepted debt. Existing small metadata typography and narrow-screen hidden comment rail are inherited and not changed by this issue.
