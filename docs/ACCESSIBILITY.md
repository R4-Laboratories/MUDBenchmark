# Accessibility

The browser client is the main way people meet the game, so the shell keeps a
small, explicit accessibility contract:

- a **Skip to game** link is the first focusable element and jumps to `#main`;
- every interactive control has a visible `:focus-visible` outline;
- `prefers-reduced-motion` reduces animation and transition duration to a
  near-instant change;
- the game log is a labelled `role="log"` with a live announcer for status;
- the Character sheet is keyboard-reachable through the same Studio tabs;
- mobile layouts wrap the stream tools, collapse the header status and keep the
  command entry usable.

## What the Gate checks

The Gate inspects the page source for skip links, focus-visible rules,
reduced-motion handling, labelled logs, ARIA tab semantics and named tables.
The CI Gate also runs `node tools/a11y.mjs`, a browser audit that checks `/`,
`/watch` and `/stats`:

- main and level-1 heading landmarks;
- accessible names on buttons, links, textboxes, comboboxes and tabs;
- the skip link is the first Tab stop and points at `#main`;
- the game log and watch transcript expose `role="log"`;
- watch tabs expose `aria-controls`, `aria-selected` and arrow-key navigation;
- tables, charts and the HP sparkline have accessible names;
- the core palette meets WCAG AA (the audit reports the exact ratios);
- `prefers-reduced-motion: reduce` turns off smooth feed scrolling.

## Audit results (v0.91.32)

- `/`, `/watch`, `/stats`: main landmark, h1, no unnamed interactive controls.
- First Tab: `Skip to game` / `Skip to transcript` / `Skip to telemetry`.
- Watch tabs: ArrowRight selects Run stats and reveals its panel.
- Contrast: text/bg 16.71, muted/surface 7.75, faint/surface 5.41,
  accent/bg 13.33, accent-ink/accent 10.33, link/bg 11.83, warn/bg 11.81,
  danger/bg 7.33.
- Reduced motion: watch feed scroll behavior is `auto`; live dot animation is
  disabled.

## Still open

The audit uses Chrome's accessibility tree, not a spoken screen reader. A human
VoiceOver/NVDA pass, a mobile touch-target review and a contrast check of any
future theme remain manual work. The browser audit is a regression check, not a
certification.
