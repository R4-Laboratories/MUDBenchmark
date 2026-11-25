# The agent mind

The browser AI is not a chat window bolted onto a game. It is a persistent
player with a small working mind, a plan, a record of what it tried, and rules
it has learned. The point is to make the model an active participant, not a
one-shot command generator.

## Why the old loop failed

A long transcript is not memory. The model could see the last few turns, but it
could not reliably answer:

- What am I trying to do?
- What did I already try here, and what happened?
- Is this a player or an NPC, and which social verb reaches them?
- Am I already in a fight? What can I do besides attack again?
- Am I carrying a better weapon or armour I never equipped?
- Have I been circling the same rooms for ten minutes?

Adding more raw context did not fix it. The harness now maintains the answers
as structured facts.

## The Mind

`runtime/web/mind.mjs` stores one compact object per persona in localStorage:

| Part | What it holds |
| --- | --- |
| identity | name, level, title, guild, deaths, coins |
| goal | the live level / quest / hidden-way win condition |
| plan | the model's `PLAN:` line, carried until changed |
| attempts | the last twelve commands and their outcomes |
| lessons | model `LESSON:` lines plus rules derived from failures |
| social | players in the room, NPCs in the room, party, recent public speech |
| combat | engaged enemies, HP, target |
| gear | wielded, worn, weapons and armour still in the pack |
| stuck | recent route, same-room count, loop flag |

The model receives a bounded `MIND:` block each turn. It is not an infinite
transcript; it is the state a player would keep in their head.

## The command coach

`coachCommand` runs before a command is sent. It catches the mistakes that
looked like model confusion but were really social grammar:

- `say a large bard hello` → `talk a large bard` (**say** is room speech).
- `tell bard hello` → `talk bard` (NPCs do not receive tells).
- `talk ann` where Ann is a player → `tell ann <text>`.
- `attack rat` while already fighting the rat → a technique, `battle`, or a
  heal, not another attack.

A blocked command is **not sent**. The model sees the coach line, records the
attempt and lesson, and tries again. Two repeats force the repaired command so
the run cannot spin.

## Combat and gear

`attack` only starts a fight. Once `COMBAT` is present:

- The action menu drops `attack`.
- It shows `battle`, techniques, food/drink, `cast mend` and `flee`.
- The prompt says the rounds are automatic and that repeating attack does
  nothing.
- The server answers a redundant attack with the same explanation.

The menu also offers `wield` for a carried weapon and `wear` for carried
armour until they are equipped. The Mind adds a lesson whenever gear is still
in the pack unequipped. The agent is told to read `score` and `equipment`.

## Stuck and loop recovery

The existing route memory detects repeated commands and small room cycles. The
Mind adds a second signal: if the last six rooms contain at most two distinct
rooms, it prints `STUCK` and a lesson. The harness prefers an exit whose target
has not been seen before, then an exit not used recently.

## NPCs hold the fight

An engaged mobile no longer wanders out of the room on its own clock. Before
this fix an aggressive NPC could attack and then leave in the same pulse,
ending the fight without either side fleeing. The Gate includes a wandering
rat that must stay in the room while engaged.

## Opening-room prose

The first 18 rooms now have at least 280 characters of prose, three ambient
lines and two details; the Gate enforces it. This is the first pass of the
adaptive-description plan in `docs/ROOM-PROSE.md`.

## Test evidence

- Gate: parse `PLAN`/`LESSON`, build the Mind from a turn, derive social and
  gear lessons, print the `MIND` block, coach `say`/`tell`/repeat attack,
  remove attack from the combat menu, keep an engaged mobile in place, and hold
  the opening-room prose floor.
- The browser Mind module is a static route (`/mind.mjs`) and the page imports
  it; the server smoke checks the route and the module text.
- No real provider key is used in the Gate. A real DeepSeek/Groq session is the
  next evidence step; the missing machinery is what this release supplies.
