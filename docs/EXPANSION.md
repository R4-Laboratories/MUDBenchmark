# The expansion: from a baseline MUD to a world

The baseline is complete through Phase G. This document is the next game:
combat with weapons, levels and quests, guilds, a living world with a two-hour
reset, accounts, a global chat, safe rooms, and an LLM bridge that lets a player
hand their character to a model without giving it a privileged view.

The reference is AberMUD 7 (`R4-Laboratories/idirt`). Its zone files are the
shape to copy: `%mobiles`, `%objects`, `%rooms`; a weapon carries `Damage`, a
mobile carries `Strength`, `Damage`, `Armor` and `Aggression`; a hit is a roll
against `57 - armor`; `flee` drops things and loses score; a reset returns a
zone's rooms, objects and mobiles to their reset points; levels are a score
table. MuOxi is the other reference, and it is deliberately only a kernel: no
combat, quests, economy or permissions hierarchy. The game layer is ours.

## The rules of the world

1. **The tick is the clock.** Commands are accepted at most once per 250 ms, on
   the same tick humans and models share. No client gets a faster input loop.
2. **Objects are mortal; characters are not.** A character keeps level,
   experience, guild and quest progress. It does not keep rooms, visited sets,
   inventory or worn things across a logout. Objects persist in the world until
   the two-hour reset, then return to their starting points, wherever they were.
3. **Safe rooms are safe.** No attack begins, no damage lands, and a fight ends
   at the threshold.
4. **The world resets every two hours.** Objects and mobiles return to their
   origins; players keep their progress. The reset is announced.
5. **Everything is data.** Rooms, objects, mobiles, weapons, food, quests,
   guilds, channels and socials are authored in `world/data/`; the reducer owns
   the effects.
6. **Everything is a span.** Every action, refusal and reset is a row in the
   dataset. An LLM's behaviour is observed, not privileged.

## Persistence after this change

| Thing | Persists across logout? | Across the 2h reset? |
| --- | --- | --- |
| account name, password hash, role | yes | yes |
| level, experience | yes | yes |
| guild membership and rank | yes | yes |
| quests active and completed | yes | yes |
| mail | yes | yes |
| room and visited set | no — login at the start | no |
| inventory and worn things | no — dropped where you stood | objects return home |
| objects in the world | yes, until the reset | reset home |
| mobiles, their positions and health | yes, until the reset | reset home |

A logout drops the character's things in the room they stood in. They remain
there, lootable, until the reset. A login starts at the safe start room.

## Phases

### H — Foundation (done, v0.9.0)

- **Accounts.** `register <name> <password>`, `login <name> <password>`,
  `password <old> <new>`. Passwords are scrypt-hashed with a per-account salt.
  Legacy token identities still sign in with their key. A name is 1–24 letters,
  digits, `-` or `_`; a password is at least 6 characters.
- **Input allowance.** One accepted command per 250 ms per connection, enforced
  by the server. An early command is refused and counted, not queued.
- **Two-hour reset.** The area pulse is 28,800 ticks. At reset, every object
  returns to its home, every mobile to its home and full health, the dead
  revive, shops restock, and every actor is told the world has shuddered.
  Carried objects return too; characters keep their progress.
- **No item persistence.** Logout drops held objects in the room; login starts
  at the start room; the identity records only progression. Checkpoints sync
  progression, not hands.
- **Global chat.** A `global` channel (`global`, `all`, `ooc`) reaches every
  awake actor; `gossip` and `trade` remain.
- **Safe rooms.** `safe: true` in a room forbids combat and ends a fight at the
  threshold. The Atrium, Storeroom and Shrine/Chancel are safe.
- **Room details.** Rooms gain optional `details` (`look <thing>`), `ambient`
  lines and a safe marker. The view shows them.

### I — Combat 2.0 (done, v0.10.0)

- **Weapons.** `wield <weapon>`, `unwield`, `equipment`. A weapon has `damage`;
  damage is the actor's base plus the weapon's. Unarmed is the base.
- **Armour.** Wearable items carry `armor`; hit chance is a roll against
  `57 - armor`, following AberMUD's shape. A miss is a span.
- **Food and drink.** Food carries `heal` per bite; eating restores hit points
  up to the maximum. Drink is a later item type.
- **Flee.** `flee` ends the engagement, moves through a random available exit,
  and is refused in a safe room. A failed flee costs a round.
- **PvP.** `attack <player>` is allowed in unsafe rooms. Death drops the
  victim's held objects in the room, respawns them at the start with full
  health, and awards experience to the killer. Safe rooms refuse both.
- **Death.** Level and quest progress survive; objects do not. A death is a
  span and a line to the room.
- **Mobiles fight back.** Aggressive mobiles begin engagements on their own
  clock when a player is in the room; a `wimpy` threshold can auto-flee.

### J — Progression and quests (done, v0.11.0)

- **Experience and levels.** XP from kills, quests and first visits; the level
  table is data. A level-up raises maximum hit points, heals, and announces.
- **Stats.** `score` shows level, XP to next, hit points, armour, weapon, guild
  and quests. `consider <target>` compares levels.
- **Quests.** `world/data/quests.json`: id, name, giver, description, level,
  objectives (`kill`, `visit`, `collect`, `deliver`), rewards (XP, object), and
  a completion text. `quests` lists active/completed; `quest accept <id>`;
  objectives advance from spans/events; completion is automatic when the
  objectives are met, with a reward and a persisted completed entry.
- **Quest items** are ordinary objects; the two-hour reset returns them, so a
  quest can be repeated after a reset.
- **The existing Vault/Shrine construct** becomes a quest with a witness
  requirement, not a hard-coded command.

### K — Guilds (done, v0.12.0)

- **Guilds** are data plus state: id, name, founder, members with ranks
  (leader, officer, member), a hall room, a charter, and a bank/till.
- **Commands.** `guild create <name>`, `guild invite <player>`, `guild join`,
  `guild leave`, `guild list`, `guild who`, `guild chat <text>`, `guild rank
  <player> <rank>`, `guild disband`.
- **Guild chat** is a channel scoped to members, with a span and dataset row.
- **Guild hall** is a room owned by the guild, safe, with a chest whose contents
  reset with the world. Instanced halls arrive with the world phase; the roster,
  ranks and chat are the stable part.
- **Persistence.** Membership and rank are on the identity; the guild record is
  in the world state and survives restarts.

### L — The world (first map done, v0.13.0)

- **A real map.** A starting town (temple, market, guild hall, smith, inn), a
  road, a forest, a mine, a crypt, a river and a tower; 25–40 rooms in the first
  pass, each with a long description, ambient lines, details, exits and a safe
  flag where it matters.
- **Objects with purpose.** Weapons at several damage tiers, armour, food,
  light, containers, keys, quest items, shop stock and loot tables.
- **Mobiles with character.** Descriptions, examine text, dialogue, aggression,
  speed, damage, armour, loot and respawn points.
- **Shops** in the market and the inn, each with stock, prices and a till.
- **The two contradictory inscriptions** stay, now as a quest chain.

### M — The LLM bridge (provider + rolling window done, v0.14.0)

- **A player can hand their character to a model.** A reference bridge
  (`runtime/agent.mjs`) connects on the same wire as a human, logs in with the
  player's account, receives the same observations and sends commands through
  the same parser and 250 ms allowance.
- **Providers.** OpenAI-compatible (`/v1/chat/completions`), Ollama
  (`/api/chat`), and a `command` hook for a local process. The provider is a
  flag; the game protocol does not change.
- **Rolling context.** A bounded window of observations and actions, plus a
  summary of older turns, plus an optional long-term memory store. The memory
  interface has backends: `window`, `file`, `summary`, and `prime-router`
  (an HTTP adapter that stores and recalls text; the game never depends on it).
  Prime-router is a memory backend, not a privileged game client.
- **Fairness.** The bridge waits for the same 250 ms allowance; a rejected
  command is reported and retried, never spammed.
- **No keys on the server.** Provider credentials live in the player's bridge,
  never in the world.

### N — Commands and polish (generated reference, /llms.txt, web shell done, v0.15.0)

- `help`, `commands`, `look <thing>`, `examine`, `search`, `score`,
  `equipment`, `quests`, `guild`, `time`, `weather`, `map`, `who`, `awake`,
  `consider`, `flee`, `wield`, `unwield`, `eat`, `drink`, `sleep` (safe rooms).
- A generated `llms.txt` describing connection, login, commands and the world.
- A web client shell with account creation, saved name, and an agent toggle.
- A `docs/COMMANDS.md` generated from `verbs.json`.

## Data shapes

### Room

```json
{
  "name": "The Atrium",
  "text": "A long description...",
  "safe": true,
  "exits": { "north": 2, "east": 3 },
  "notices": [],
  "details": { "plaque": "The plaque reads...", "floor": "..." },
  "ambient": ["A draught crosses the hall.", "Somewhere a bell."]
}
```

### Object

```json
{
  "id": "sword",
  "name": "a short sword",
  "room": 3,
  "flags": ["takeable", "weapon"],
  "damage": 4,
  "value": 12,
  "weight": 4,
  "examine": "The blade is plain but well kept."
}
```

Armour is `flags: ["wearable", "armor"], armor: 2`; food is
`flags: ["food"], bites: 2, heal: 3`; light is `flags: ["light"], lit: false`;
a container is `flags: ["container"], capacity: 4, open: false`.

### Mobile

```json
{
  "id": "goblin",
  "name": "a goblin",
  "room": 12,
  "home": 12,
  "hp": 18,
  "damage": 3,
  "armor": 1,
  "aggression": 40,
  "speed": 8,
  "behaviour": "wander",
  "description": "A goblin watches you from the shadows.",
  "examine": "It bares its teeth.",
  "loot": ["coin"]
}
```

Aggression is a chance out of 100 evaluated on the mobile's clock; speed is its
attack period; loot is cloned or moved on death.

### Quest

```json
{
  "id": "slate",
  "name": "The True Word",
  "giver": "the keeper",
  "level": 1,
  "description": "Find what the Vault really says.",
  "objectives": [
    { "kind": "visit", "room": 4 },
    { "kind": "kill", "npc": "guard", "count": 1 }
  ],
  "rewards": { "xp": 50, "object": "lamp" },
  "complete": "The shrine accepts the true word."
}
```

## The two-hour reset

At tick 28,800 the world resets:

- every object returns to its `home` room, container and open/lit state;
- ephemeral objects (minted coins) disappear;
- every mobile returns home, revives at full health, and clears engagements;
- shops restock because their stock is ordinary objects;
- every actor is told: `The world shudders. Everything returns to where it began.`
- actors keep level, XP, guild, quests and mail; their hands are emptied into
  the room first, then the reset takes those objects home.

The pulse is data in the reducer (`AREA_PERIOD`), and the gate triggers it by
setting the pulse rather than stepping 28,800 ticks.

## The input allowance

```js
allowCommand(lastAt, now, interval = 250) // true when now - lastAt >= interval
```

The server records `world.input` for a refused command with the verb, the
milliseconds since the last accepted command, and the actor. The bridge uses the
same constant. This is what makes PvP fair between a human typing and a model
generating.

## Acceptance per phase

- **H:** register/login/legacy; 250 ms refusal; 2h reset returns objects and
  mobiles; logout drops items; login at start; progress persists; global
  channel reaches everyone; safe room refuses combat.
- **I:** a weapon changes damage; food heals; flee ends a fight; PvP kills and
  respawns; safe rooms refuse; every round and miss is a span.
- **J:** a quest completes from an objective and persists; a level-up raises
  max HP and persists.
- **K:** create/join/leave/rank; guild chat reaches members only; membership
  survives restart.
- **L:** every room has a long description, at least one detail and an ambient
  line; a fresh player can complete one quest without a wiki.
- **M:** a model connects with the player's account, receives the same stream,
  respects the allowance, and completes a scripted task with no privileged
  access.
- **N:** `help` lists every command; `llms.txt` is generated from the tables.

## Order

H → I → J → K → L → M → N. Each is a release with a gate, a dataset row and a
span. The world stays playable at every step; no phase leaves a half-built
system running for players.
