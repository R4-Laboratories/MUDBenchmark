# From a thin world to a MUD baseline

The gap between what we have and what AberMUD 7 shipped is a list of subsystems.
This is the order to close them, chosen so that each phase creates behaviour the
next one can build on — and so that every phase adds columns to the dataset
rather than only code.

## Where we are

| AberMUD subsystem | Ours | Gap |
|---|---|---|
| `rooms`, `zones` | rooms and zones as data | close enough |
| `objsys`, `clone` | take/drop/give, flags, fixed objects | no containers, wear, food, light |
| `mobile` | NPCs that move on their own clocks | they do nothing else |
| `fight` | — | no combat, no hit points |
| `spell`, `magic` | — | nothing |
| `climate`, `timing` | per-entity clocks, area cycle | no weather, no day |
| `comm`, `sendsys`, `mailer` | room speech | no channels, tells, mail, socials |
| `acct`, `wizard`, `god` | keys, roles | no account state, no admin verbs |

## Phases

**A. Verbs as data, with audiences.** *Done.* Every command becomes a row in
`world/data/verbs.json`: its aliases, what it needs, and one message per audience
(`actor`, `others`, `target`) with `%a`, `%o`, `%t`, `%s` codes — the shape
idirt's `data/actions` used. The server stops formatting strings; it renders
templates. Every verb added after this is data, and the wording of the game
becomes reviewable without reading code.

**B. Mobiles that do something.** *Done.* A creature gets a behaviour: `wander`,
`sentinel`, or `speaker` with a phrase list. Each runs on its own clock, so the
world has inhabitants rather than furniture. Every action is an event and a span.

**C. Combat.** *Done.* The `fight` subsystem: hit points, an attack that begins an
engagement, and the violence pulse resolving rounds — which is what
`ARCHITECTURE.md` has claimed since the first session and the runtime has never
done.

**D. Item properties.** *Done.* Containers that hold objects, things that can be worn,
eaten, or lit. `objsys` was the largest subsystem in AberMUD for a reason: it is
where most player verbs live.

**E. World systems.** *Done.* Weather and time, and a shop that buys and sells.
Area resets restore objects as well as creatures. The climate is data: a day
length, phases covering all 24 hours, and weather on its own pulse. Night
silences the speaker, so time changes behaviour rather than only description.
The shop is data too: a keeper, stock marked for sale, prices in coin objects.
The shop keeps the change; it pays half value; the reset puts the stock back.

**F. Communication.** Channels, tells, mail, and the social verbs that made MUDs
social places rather than adventure parsers.

**G. Accounts and persistence.** Characters that survive a restart, with
inventory, position and progress — the MuOxi/Diesel concern, which we currently
approximate with one JSON snapshot.

## What every phase must carry

- **A span per action**, with the actor, the tick, and what it cost, so the
  dataset grows with the game rather than being bolted on later.
- **A dataset event**, so `tools/dataset.mjs` sees it without a rewrite.
- **A gate check**, so the phase can fail. A subsystem nothing can break is a
  subsystem nobody will notice breaking.
- **Data, not code**, wherever a builder would want to change it.
- **A state upgrade**, so a checkpoint written before the phase still loads.
  The model grows; the save on disk is older than the code reading it. v0.4.0
  rolled back in production for exactly this reason — the violence pulse did not
  exist when the running save was written.

## What we are not doing

- Not porting AberMUD's C. The value is its *shape* — zones, objects, mobiles,
  pulses, audiences — not its implementation.
- Not writing the benchmark first. The game produces the record; the queries come
  later, from whoever wants to ask something of it.
- Not chasing feature count. A creature that reacts is worth more than six verbs
  that print text.
