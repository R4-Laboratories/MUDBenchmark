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
the run cannot spin. The coach also refuses two commands on one line (sending
the first), an item already carried (repairing to `wield`/`wear`), and an NPC
remembered from an earlier room, so it cannot keep telling a bard it left
behind. A `NEXT:` line puts the highest-value immediate step in front of the
model: equip gear, take room gear, the next unfinished quest objective, an
offer, or an unexplored exit.

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

## The focus planner

`runtime/web/planner.mjs` is the model-independent layer above verbs. The
server exposes each active quest objective with its kind, text, room, NPC,
object and done flag, plus the available quest givers and their rooms. The
planner picks one focus:

1. fight, if engaged;
2. equip carried gear;
3. take useful gear in the room;
4. the next unfinished quest objective, with a route if the room is known;
5. an available quest offer, with a route to the giver;
6. an unexplored exit.

The browser seeds its route graph from `/llms.txt` on first start, so a quest
room the character has never visited still has a route. The prompt gets
`FOCUS`, `WHY`, `ROUTE` and a short `CANDIDATES` list, and the action menu
starts with those candidates.

Room actions are data, not global verbs. The validator accepts `turn winch`,
`pump shaft`, `board cart`, `strike seam` and the other action verbs when the
live room exposes them; before this, the model was told its correct action was
an unknown command and repaired away from the winch.

The planner also sees `group_actions`. If a winch or door needs two people, it
focuses party formation and offers `party invite <player>`; once the party is
in the room it offers the action itself. This is how the Deepdelve run turned
the winch.

Gear is compared by damage and armour. The menu and planner only offer an
upgrade, so a short sword is not replaced by a wooden club. `battle` is an
inspection command, not a fight action, and is no longer offered in combat. This does not take the choice away
from the model; it removes the “what is worth doing at all” problem that made
weak models examine the same sword ten times.

## Objective lock and quest switching

The planner scores the next unfinished objective of every active quest: target
in this room (5), known route (4), otherwise (1). An `answer` objective scores 6
once the Mind knows the door word; until then it scores 1 and a reachable quest
offer can take focus instead. This is how the 100-turn run left the
Shrine/Chancel loop and completed Bread, A Curled Scroll and The Lighthouse
Lens after First Steps, while the later focused run delivered the answer.

The model still gets one detour. A second unrelated command triggers the
objective lock: it takes the focus route or the focus action. Seven forced
steps carried the 100-turn run through the loop without removing the model’s
choice on the first turn of a new thought.

## Answer and fact focus

A quest `answer` objective is not a route to a random shrine. The server
exposes the answer room and the clue room. When the AI observes the Vault door
word, the Mind stores it (`KNOWN WORD: AMBER`) and the planner routes to the
Shrine and offers `answer amber`. At the Shrine, `say amber` is a room speech
mistake and the coach repairs it to `answer amber`; `answer slate` is repaired
to the known word too. If the word is unknown, the planner sends the AI to the
clue door and offers `examine door`.

`answer` now advances a witnessed answer's quest. Before this fix the server
printed "The shrine accepts your answer" and changed nothing, so the focused
smoke always ended with an active word quest. A normal-start focused DeepSeek
run began at the Atrium, walked north and east to the Vault, examined the door,
returned through the Corridor, Atrium, Storeroom and Cell to the Shrine, had
`answer slate` and `say AMBER` blocked, sent `answer amber`, and completed The
True Word in 10 turns (300 → 350 XP). A second Vault-start run repeated the
same answer path in 18 turns.

## Frontier and notes

The old explore fallback took the first exit whose target had not been seen.
On a tree-shaped map that keeps an agent near home even when `/llms.txt` knows
the whole world. The planner now calls `frontier(memory, from)`: a BFS over the
seeded map to the nearest room that is known but not in `memory.rooms`. The
explore focus names that room, routes through known rooms and is included in
the focus lock, so two unrelated commands yield to the frontier route. If no
frontier remains, the fallback avoids directions marked stale in the current
room and rooms in the recent trail.

The memory block also prints `Rooms seen: N of M known` and a `FRONTIER` line,
so the model sees how little it has explored and where the nearest new room is.
The Mind now stores the model's `NOTE` line (up to 12 notes) and prints `NOTES`
back each turn; the browser notebook still records the same note for the human.
This is the model's own durable context, not just a two-turn transcript.

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
  multi-command lines, carried gear and known NPCs elsewhere, remove attack
  from the combat menu, keep an engaged mobile in place, and hold the opening
  room prose floor, exercise the focus planner, route seed, room-action
  validation, upgrade filtering, party focus, objective scoring, quest
  switching and the focus lock.
- Local model: `qwen2.5:3b` played 18 turns and eventually equipped the sword,
  cloak and jerkin. It still repeated actions; the loop guard and coach caught
  them.
- DeepSeek: `deepseek-flash` played 15 turns on an isolated server. It took and
  wielded the short sword, wore the cloak and jerkin, talked to the bard, sent a
  private `tell` to the player, accepted the `word` quest, went north and
  attacked the rat, then explored the Vault.
- DeepSeek long run: 80 turns completed First Steps and explored 19 rooms with
  plans/lessons; 25 turns formed a party with ann, turned the Deepdelve winch,
  descended and reached the surveyor and her notes. The party action only
  worked after the room-action validator fix.
- DeepSeek 100-turn run: completed First Steps, Bread for the Shop, A Curled
  Scroll and The Lighthouse Lens; 28 rooms, 54 plans/lessons, 7 focus-lock
  corrections, 0 deaths.
- DeepSeek normal-start answer run: completed The True Word in 10 turns from
  the Atrium; 8 rooms, 15 plans/lessons, 22/24 commands sent, two repairs
  (`answer slate` → `answer amber`, `say AMBER` → `answer amber`), 0 deaths,
  XP 300 → 350.
- DeepSeek Vault-start answer run: completed The True Word; 18 turns, 7 rooms,
  9 plans/lessons, one wrong-answer repair, one focus correction, 0 deaths,
  XP 300 → 350.
- DeepSeek focused boss run: the model's own `attack a training guardian` killed
  it in the first round (XP 300 → 320); no death.
- DeepSeek focused death run: the model attacked a strong guardian and died;
  the first death took level 3 / 300 XP to level 2 / 150 XP, deaths 1, with max
  HP recalculated. Re-engaging caused further deaths, as the goal requested.
- DeepSeek 120-turn run: completed First Steps, Bread for the Shop and The
  Lighthouse Lens; 28 rooms, 65 plans / 64 lessons, 120 commands sent, 10 focus
  corrections, 0 deaths, level 3 / 394 XP, sword and armour equipped, 10 talks
  and 1 tell.
- DeepSeek 120-turn open-world run: completed First Steps, Bread for the Shop,
  A Curled Scroll and The Apprentice's Charm; **34 rooms**, 65 plans / 63
  lessons, 120/120 commands sent, 13 focus corrections, 0 deaths, level 3 / 410
  XP. It reached the Cliff Walk, Cellar Stair, Harbor Quay, Docks, Deep Forest,
  Grey Road, Moonlit Gate, Memory Garden, Root Archive and Root Road, not only
  the starting quarter. A second 120-turn run visited 33 rooms, completed 3
  quests and reached the Salt Caves, with 0 deaths and level 3 / 414 XP.
- Coach regression: `take a loaf of bread` with a purse of coins is no longer
  blocked as "already carrying"; item matching ignores `of`, `with`, `from` and
  `to` as well as articles.
- Live death smoke: a level-3/300-XP character killed by a strong guardian woke
  at the Atrium at level 2/150 XP, deaths 1, with max HP recalculated.
- The browser Mind module is a static route (`/mind.mjs`) and the page imports
  it; the server smoke checks the route and the module text.
- No real provider key is used in the Gate. A real DeepSeek/Groq session is the
  next evidence step; the missing machinery is what this release supplies.
