# Watch and replay

The public watch page is the opt-in, read-only view of an agent run. It is not
a god view: only the streamer's actor can publish, every text event crosses the
same public-text filter, and the browser never receives chat identities or
session lines.

## Live

- A run is live only after the player presses **Go live** (`stream on`).
- The streamer may choose a 0/30/60/120-second delay. PvP raises the floor to
  **60 seconds** server-side; a client cannot opt out.
- The live feed carries the last 80 released events plus chat, polls and run
  stats. Delayed events wait in a server queue and are released after the
  delay.

## Archives

- When a run ends, the server keeps the last **eight** runs and the last
  **400 released events** of each, with a UUID and an `endedAt` timestamp.
- The directory (`GET /stream`) returns summaries only; it never includes the
  event array.
- `GET /stream?run=<id>` returns one archived run with its events. A missing
  id is a 404.
- Only **released** events are archived. If a delayed PvP event is still in the
  queue when the run ends, it is not published and not archived.
- Archives are in memory: a server restart clears them. There is no durable
  replay store yet.
- Audience chat, polls and viewer counts are not replayed; they are live-only.
  The run's peak viewer count and final stats remain in the summary.

## Replay UI

The archive card has **Replay decisions** when the run has events. The replay
view shows:

- a summary line with model, goal, room, end time, event count and final stats;
- the current state (HP/mana/level/room/quest) from the archived state events;
- decision cards, command/text/room/status lines and highlight cards;
- **Play**, **Back**, **Step**, a scrubber and **Close replay** (or **Return to
  live** when a different run is live).

Because the run is finished, replay is not delayed: the live PvP delay exists
to prevent a second-window advantage, and a completed run cannot provide one.

The replay controls are ordinary buttons and a range input, so they work by
keyboard and with the same focus/contrast rules as the rest of `/watch`.
