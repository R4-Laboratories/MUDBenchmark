# Accessibility

The browser client is the main way people meet the game, so the shell keeps a
small, explicit accessibility contract:

- a **Skip to game** link is the first focusable element and jumps to `#main`;
- every interactive control has a visible `:focus-visible` outline;
- `prefers-reduced-motion` reduces animation and transition duration to a
  near-instant change;
- the game log is a labelled `role="log"` with a live announcer for status;
- the Character sheet is keyboard-reachable through the same Studio tabs;
- mobile layouts keep Stats, Watch, Telemetry and the font controls in a
  labelled header menu, show the connection state as text rather than a
  colour-only dot, and keep primary touch targets at least 44px high.

## What the Gate checks

The Gate inspects the page source for skip links, focus-visible rules,
reduced-motion handling, labelled logs, ARIA tab semantics and named tables.
The CI Gate also runs `node tools/a11y.mjs`, a browser audit that checks `/`,
`/watch`, `/stats` and the signed-in game:

- main and level-1 heading landmarks;
- accessible names on buttons, links, textboxes, comboboxes and tabs;
- the skip link is the first Tab stop and points at `#main`;
- the game log and watch transcript expose `role="log"`;
- watch tabs expose `aria-controls`, `aria-selected` and arrow-key navigation;
- tables, charts and the HP sparkline have accessible names;
- the core palette meets WCAG AA (the audit reports the exact ratios);
- `prefers-reduced-motion: reduce` turns off smooth feed scrolling;
- at a 390x844 phone viewport, no page scrolls horizontally, visible controls
  and header/hero/menu links are at least 24px, the mobile menu opens with
  `aria-expanded` and contains Stats, the `#state` text is visible, and a guest
  does not see the Latest overlay;
- in the signed-in game, the character panel is hidden, the First steps and
  Characters controls are visible and named, First steps opens the tutorial,
  Back to game closes the panel, the command input has focus, the HUD and
  command entry meet 24px targets on desktop and 390x844, and the signed-in
  phone layout has no horizontal overflow.

## Audit results (v0.91.32)

- `/`, `/watch`, `/stats`: main landmark, h1, no unnamed interactive controls.
- First Tab: `Skip to game` / `Skip to transcript` / `Skip to telemetry`.
- Watch tabs: ArrowRight selects Run stats and reveals its panel.
- Contrast: text/bg 16.71, muted/surface 7.75, faint/surface 5.41,
  accent/bg 13.33, accent-ink/accent 10.33, link/bg 11.83, warn/bg 11.81,
  danger/bg 7.33.
- Reduced motion: watch feed scroll behavior is `auto`; live dot animation is
  disabled.

## Audit results (v0.91.35)

- The desktop audit remains green on `/`, `/watch` and `/stats`.
- Mobile 390x844: no horizontal overflow on any of the three pages; visible
  controls and navigation links meet the 24px minimum; the game header menu
  opens, exposes Stats/Watch, moves focus into the panel, and Escape returns
  focus to the toggle.
- The mobile connection state shows `connecting…`, `connected` or the error as
  text; the colour-only dot is gone.
- A guest no longer sees the Latest jump button over the landing hero.
- The mobile Telemetry item mirrors the desktop gate: it is marked unavailable
  until an AI run is active and explains that in the status line.
- A focused browser run exercises the menu, font controls, Telemetry gate,
  Escape handling and desktop restoration (`mobile interaction: ok`).

## Audit results (v0.91.39)

- The signed-in game audit creates a Prism character from the landing page and
  checks the live shell rather than only the guest pages.
- The HUD quick actions and exit buttons were 22px high; they are now 24px on
  desktop (32px on mobile), so every visible signed-in control meets the 24px
  target.
- Signed-in desktop: character panel hidden, First steps/Characters/Help/Who/
  Quit named and visible, `#cmd` focused, no unnamed interactive roles.
- Signed-in 390x844: no horizontal overflow; First steps, Characters, command
  input and HUD actions meet the target; the recovery note is visible for the
  free Prism account.
- First steps opens the tutorial; Back to game closes the Characters panel.

## Still open

The audit uses Chrome's accessibility tree, not a spoken screen reader. A human
VoiceOver/NVDA pass and a final hands-on phone review remain manual work, as
does a contrast check of any future theme. The browser audit is a regression
check, not a certification.
