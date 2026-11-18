# Tutor region

Tutor is a separate region and the single authority for learner completions.
This world never checks a completion itself: it asks Tutor, records the answer,
and does nothing else with it yet (no reward). Experimental; see #12.

## Configuration

Unset means the world is not connected and `tutor` says so.

| Variable | Meaning |
| --- | --- |
| `TUTOR_REGION_URL` | Tutor's origin. HTTPS, or HTTP on loopback only. |
| `TUTOR_REGION_SECRET` | Shared secret, at least 32 characters. Sent as a bearer token. |
| `TUTOR_REGION_TIMEOUT_MS` | Request timeout, default 5000. |
| `TUTOR_CLAIMS_FILE` | Where answers are kept, default `~/.mudbench/state/tutor-claims.json`. |

A bad URL or secret stops the server at start.

## Commands

- `tutor link <code>`: redeem the one-time code the learner got from
  `tutor region link` at Tutor. The line is logged as a secret.
- `tutor claim <problem>`: ask Tutor whether the linked learner completed it.
  A yes is recorded once with Tutor's ledger sequence and hash; asking again
  never rewrites it.
- `tutor`: list what is recorded for your character.

If Tutor is down, unreachable, or answers about a different claim, nothing is
recorded and the player is told Tutor is unavailable.

Tutor's side (`tutor region serve`) is documented in the Tutor repository.
`node --test runtime/tutor-region.test.mjs` runs the checks against a stand-in
Tutor.

## Code puzzles and the Tutor panel

A room action in `world/data/actions.json` can carry `"tutor": "<problem>"`.
When a player triggers it, the game sends the browser a `#tutor <problem>`
line (text clients get a plain hint) and the page opens a panel with the
learner's own Tutor terminal, which runs on their machine (`tutor region
terminal`, see the Tutor repository). The player solves the problem there,
runs `tutor region submit <problem>`, then types `tutor claim <problem>` in
the game. There is no always-on Tutor button.

The terminal's URL contains a secret path. It arrives once, in the URL
fragment from `tutor region terminal --open <this page>`, is kept in this
browser's `localStorage` and is removed from the address bar. If the terminal
is not running the panel shows the one-line install command. This page never
sends the URL anywhere.
