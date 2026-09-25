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
