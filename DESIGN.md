# Criever design system

## 1. Atmosphere & Identity

A quiet, dense code-review workspace. The signature is a three-region reading surface: file tree, diff, and a contextual rail, with restrained blue action accents and amber guidance. AI assistance is visually distinct from PR comments and never implies publication.

## 2. Color

The existing `packages/web/src/tokens.css` defines light and dark palettes. Use `--bg`, `--panel`, `--panel-2` for surfaces; `--line` and `--line-strong` for boundaries; `--ink`, `--ink-2`, `--ink-3` for hierarchy; `--accent` and `--accent-soft` for interactive and pending states; `--amber` and `--amber-bg` for look-out guidance; `--del` and `--del-bg` for errors. No new raw colors in components.

## 3. Typography

IBM Plex Sans is the UI face and IBM Plex Mono identifies paths, code, and numbers. Existing scale: 11px labels, 12px secondary controls, 13px body, 14px header, and 12.5px diff monospace. Keep generated responses readable at body size and wrap long text.

## 4. Spacing & Layout

The shell has a fixed header and footer, with independently scrolling file tree, diff body, and rail. Existing widths are 260px tree and 300px rail on wide viewports. Use the established 4px spacing rhythm (4, 8, 12, 16, 24px). On narrow viewports the AI rail takes the optional right region rather than reducing the diff below legible width. The diff remains the primary reading surface.

## 5. Components

### Action button and chip
- **Structure**: native button plus text; chips are noninteractive unless they contain an explicitly labelled button.
- **Variants**: primary, neutral, ghost, amber, blue.
- **States**: hover, keyboard focus, busy, disabled, error; action labels never silently change publication intent.
- **Layout**: wrapping cluster in cards, fixed grouping in the header.

### Review card and composer
- **Structure**: labelled header, readable body, contextual actions, inline textarea with visible label.
- **Variants**: existing comment/draft; new private question, AI finding, amber look-out.
- **States**: loading, editable, error, approved or removed. A private question never becomes a normal comment draft. Approving a finding creates a normal draft; editing/rewording does not.
- **Layout**: inline under the anchored diff row; diff body owns scrolling.

### AI rail
- **Structure**: configured harness selector, explicit Run AI review action, general chat transcript and composer, contextual thread summaries that navigate to their diff line, close control.
- **States**: no harness, ready, running, error, general chat empty/populated, contextual summaries empty/populated.
- **Layout**: right-side bounded scroll panel, closeable without affecting diff or saved private state.
- **Diff line AI action**: separate labelled button in the gutter opens a private-question composer inline; clicking the gutter outside that button keeps the normal comment composer behavior.
- **Inline AI result**: finding and look-out cards remain anchored under their diff lines after the rail closes. Private Q&A history remains inline and is not a comment draft; approval alone converts a finding to a normal draft.

## 6. Motion & Interaction

Existing cards use a 120ms opacity/transform entry only when reduced motion is not requested. New AI interactions use immediate state feedback; do not animate width or grid layout. Keyboard focus remains visible and result state is announced by labelled status text.

## 7. Depth & Surface

Mixed existing strategy: panel/background tonal separation, one-pixel borders on cards and rails, `--shadow` only for elevated overlays. Inline AI guidance uses border and semantic color, not shadow or glow.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA for newly added controls: explicit labels, keyboard operation, visible focus, readable light/dark contrast, reduced-motion support, and text wrapping for unbroken code/path content. No new accepted debt. Existing small metadata typography and narrow-screen hidden comment rail are inherited and not changed by this issue.
