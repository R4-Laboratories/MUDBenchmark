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

The Gate inspects the page source for the skip link, the reduced-motion rule,
the focus-visible rules and the labelled log/announcer. It is a source contract,
not a screen-reader certification.

## Still open

A full screen-reader pass on VoiceOver/NVDA, a colour-contrast audit of every
theme, and a keyboard-only playtest would be the next evidence. Those are
manual checks and should be recorded before claiming full accessibility.
