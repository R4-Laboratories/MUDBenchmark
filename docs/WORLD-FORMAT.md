# World format

The world is data. Rooms, exits, text, notices and the task live in
`world/data/world.json`; the server loads and validates it at boot.

This is the same split both source codebases arrived at:

- **idirt** (AberMUD 7) keeps its world in `data/` — actions, mobiles, levels,
  messages — separate from the engine in `src/`.
- **MuOxi** states it directly: it "handles sockets, login, persistence, command
  dispatch, world state, and leaves the parts that are your MUD to you."

Ours had the six rooms hardcoded in `server.mjs`, which meant changing a room's
text was a code change and could not be checked by the gate.

## Shape

```json
{
  "schema": "mudbenchmark/world/1",
  "start": 1,
  "task": { "vault": 4, "shrine": 6, "word": "amber" },
  "rooms": {
    "2": {
      "name": "Corridor",
      "exits": { "south": 1, "east": 4 },
      "text": "A narrow corridor, dust on the floor.",
      "notices": [{ "level": 1, "text": "A faded notice: ..." }]
    }
  }
}
```

`text` is either a string or an object of **variants** keyed by `DECOY_MODE`
(`single`, `marked`, `true`, `corroborated`). That keeps the experiment arms in
the data rather than in a chain of conditionals.

`notices` carry a level; `Perception.lex.tex` decides who is cleared to read one,
and the server asks it for the role/level grid at boot.

## Validation, fail-closed

`runtime/worlddata.mjs` refuses a world that would be broken in play:

| Check | Why |
|---|---|
| exit targets exist | a dangling exit is a room you can never leave |
| every room reachable from `start` | an unreachable room is content nobody sees |
| notice levels in `0..3` | a notice above the highest role is unreadable by anyone |
| `task.vault` and `task.shrine` exist | the task is the benchmark; a wrong id silently unmeasurable |

A bad world prints every problem and the process exits **before** accepting a
connection. The gate runs the same validation for all four arms, so a broken
world cannot be merged.

## What is borrowed, and what is not yet

**Borrowed:** the idea that a world is a directory of data the engine reads, and
idirt's notion that a message has an *audience* — `all`, `me`, `target`,
`sender`, `others`. Our `broadcast(room, text, except)` and per-role notices are
a thin version of that idea.

**Not yet:**

- **An action table.** idirt declares every command with flags and per-audience
  messages (`data/actions`). We still write each command's output by hand in the
  server, which is the next thing that should become data.
- **Objects and inventory.** Rooms and notices only; nothing to pick up.
- **Persistence beyond a snapshot.** MuOxi uses Diesel with SQLite or Postgres;
  we write one JSON file on a checkpoint tick.
- **A registry.** MuOxi registers types, commands and hooks; our commands are a
  `switch` in `handle()`.
