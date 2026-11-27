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
When a direction answers "no such exit", `rememberResult` deletes that edge
from the map and the coach repairs the attempted direction to a legal exit
rather than sending `look`. The planner also filters guild quests the actor
cannot accept, so a non-member is no longer offered a guild quest forever.
The Mind now stores the model's `NOTE` line (up to 12 notes) and prints `NOTES`
back each turn; the browser notebook still records the same note for the human.
This is the model's own durable context, not just a two-turn transcript.

## Quest commitment

An accepted quest now stays the plan until it is completed. The planner keeps
the committed quest across equipment and combat turns, lets a reachable active
objective outrank every new offer, and releases the commitment when the quest
leaves the active list. If no active quest is reachable, an offer may still win.

A quest route, or the route to a quest giver, takes its first concrete step
immediately instead of waiting for two detours. Exploration keeps the ordinary
two-detour lock, so this is not the strict-focus experiment that oscillated on
qwen: the immediate lock applies only to `quest` and `quest offer`, and only to
a concrete candidate (a direction, `take`, `attack`, `talk`, `deliver`,
`answer` or `examine`), never to `look`, `inventory`, `quests`, `score` or
`map`.

The core also remembers the exits of the room where a command was issued. It
previously recorded the exits of the room the player moved into, which
overwrote the seeded route graph with the next room's doors; routes then led
through doors that did not exist and the lock oscillated. Quest offers from a
room giver (the shrine) now resolve their giver room, and `bow` is matched as a
weapon without also matching `bowl`.

Evidence: a 200-turn DeepSeek run completed **9 quests** in 54 rooms with 0
deaths, 6 blocked attempts and 640 XP, completing The True Word at turn 42. An
80-turn run whose goal was the word completed **8 quests** and the word at turn
42. The previous best was 5 quests in 56 rooms. The scorecard transcript now
records each turn's focus, proposed command and active quests.

## Answer clue scoring

An active answer objective used to score 1 until the Mind knew the word, so a
reachable clue room could be discarded for an unrelated offer. It now scores 4
when the clue room has a known route, and the visit to that clue room scores 6
when the same quest has an answer objective. Gate covers both. A focused
DeepSeek run did not exercise the path: it accepted other quests or explored
instead of The True Word. That made quest selection the next target; v0.91.88
addresses it.

## Unified harness evidence

The first 200-turn DeepSeek run on the unified profile/core visited **56 rooms**,
completed **5 quests**, produced 200 plans / 200 lessons, made 1 attack, had 9
blocked attempts and 0 deaths, finishing at level 3 / 463 XP. It reached the
Arcanum's upper halls, the Salt Stairs, the Moonlit Gate, the Memory Garden and
the Root Road, spending only 13 turns in the Atrium. This is the best recorded
DeepSeek reach and shows no regression from the consolidation.

## All agents on one core

The browser, the CLI (`runtime/agent.mjs`) and `tools/agent-score.mjs` now use
`agent-core.mjs`. The CLI keeps only WebSocket login and the optional OpenCode
JSON transport; all prompt, memory, Mind, planner, coach, fallback, focus and
transcript behavior is shared. A headless Chrome smoke sent three commands to a
mock provider, and the CLI smoke sent four. Objective and waypoint environment
variables are goal hints, not a second planner.

## Browser on the shared core

The browser AI now imports `runtime/web/agent-core.mjs` and calls
`beginTurn`/`decideTurn`; its remaining code is the WebSocket, UI, history,
telemetry and streaming shell. The server serves `/agent-core.mjs`, and Gate
checks that the browser uses it. `tools/agent-score.mjs` uses the same core.
The old `runtime/agent.mjs` remains a separate single-file harness and is marked
as legacy; retiring it is the last consolidation step.

## Shared agent core

`runtime/web/agent-core.mjs` is the single turn controller: it folds the last
result into memory and Mind, computes progress/frontier arbitration, builds the
system and user prompts, parses the reply, runs the loop guard, coach, fallback
and focus lock, and records the transcript. `tools/agent-score.mjs` now uses it;
the 10-turn DeepSeek smoke sent 10 commands with 10 plans / 10 lessons and
completed 1 quest. The browser still has its WebSocket/UI shell around the same
shared modules; moving that shell onto `agent-core` is the next migration.

## One default profile

`runtime/web/agent-profile.mjs` holds the single default: 1200 output tokens,
temperature 0.3 and `reasoning_effort: medium`. Bonsai and DeepSeek no longer
have separate request profiles; Groq, DeepSeek, Bonsai, OpenAI and custom
OpenAI-compatible endpoints use the same profile. Ollama's native `think` flag
and Anthropic's message shape remain transport adapters, not different brains.
`tools/agent-score.mjs` now calls the same `requestFor`/`replyFrom` path as the
browser instead of duplicating provider branches. The 4090 stays free for
training; the 20-turn DeepSeek smoke completed 1 quest with 20 plans/lessons.

The turn-loop extraction is still the next structural step; this release
collapses the profiles, not yet the browser/scorecard orchestration.

## Invalid-target guard

A blocked command fell back after two tries, but a target the room did not
contain could be retried indefinitely. The new `coachFallbackDue` rule keeps the
two-try limit for blocked commands and allows three tries for an invalid target,
then sends the specific repair or the next legal focus/exit. On Bonsai the
previous 74 failed `take a loaf of bread` attempts disappeared; the run then
visited 55 rooms and completed 1 quest. Room reach improved, quest completion
did not.

## Bonsai 2.5 27B

The local 4090 now serves Ternary Bonsai 2.5 27B, a 5.9 GB ternary model with
strong agentic tool calling. The browser has a **Bonsai 2.5 27B (local 4090)**
preset, and `tools/agent-score.mjs` accepts `--provider=bonsai`. With MTP and a
training job sharing the GPU, prefill measured ~485 tok/s and decode ~129 tok/s
at 32k context. A 200-turn scorecard visited 44 rooms, completed 4 quests,
produced 175 plans / 168 lessons and took one death. A second run with the GPU
idle visited 30 rooms and completed 1 quest, with 74 failed `take a loaf of
bread` attempts; repeated invalid targets are still a harness gap. Decode with
the training job idle measured 198 tok/s. The game server remains model-free;
see `docs/BONSAI.md`.

## Arbitration validation

The local `tools/agent-score.mjs` scorecard drove qwen2.5:3b through 200 turns
with arbitration. The uncapped run visited 34 rooms and 0 quests (35
`preferExplore` turns); the 8-turn excursion cap visited 33 rooms and 0 quests
(48 `preferExplore` turns). The ordinary six-line qwen runs ranged 19–35 rooms
and 0–5 quests. Arbitration therefore improves room reach in some runs but did
not improve quest completion, so it is an **off-by-default checkbox**, not an
automatic weak-model policy. The scorecard tool is the reusable way to compare
the next policy.

## Weak-model arbitration

For Ollama and small model names, a stalled quest no longer has to trap the
agent. The browser marks visit count, completed quests, XP and level; after 12
turns with no change, or 6 turns with the same PLAN, the focus prefers the
nearest unvisited frontier when the active objective is not in the current
room. A quest offer in the current room still wins, and the ordinary two-detour
lock remains. This is deliberately not strict focus: the model can still choose
the first step, and only a real stall changes the planner's preference. Gate
covers the stalled-quest → frontier switch and the ordinary quest path. The
long qwen run for this change was interrupted by the host restart, so no model
scorecard is claimed.

## Strict focus is not a win

An opt-in Strict focus checkbox forces the planner route immediately instead of
waiting for two detours. On qwen2.5:3b it oscillated between the Gilded Rat and
Market Square for 68 forced moves: 21 rooms, 0 quests, 0 deaths. It remains an
off-by-default experiment for human testing; the standard two-detour lock is
the safer default for exploration. v0.91.88's immediate lock is narrower: it
applies only to a committed quest or a quest offer, not to exploration.

## Six-line contract

The system prompt asked for six labelled lines, but both user prompts asked for
four (THOUGHT, REPLY, NOTE, COMMAND). qwen followed the user prompt, so it
produced no PLAN or LESSON at all. The user prompts now ask for all six lines.
Three qwen 200-turn runs after the change produced 200 plans and 200 lessons
each, with 1–5 blocked attempts. Its route quality still varies widely (19–35
rooms, 0–5 quests), which is a model-capability limit rather than a prompt
contract bug.

## Weak-model coaching

A weak model can repeat a blocked command even while the coach explains why it
was rejected. The browser and harness now count blocked attempts per command;
after one retry they send the next legal focus candidate, or a legal exit, and
skip passive fallbacks (`look`, `inventory`, `battle`, `quests`, `map`). The
counts reset when a session starts. This is deliberately a harness guarantee,
not another prompt rule: qwen2.5:3b went from 91 and 52 blocked attempts in two
200-turn runs to 6, and reached the Hollow Fen and Moonlit Reach.

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
- DeepSeek 200-turn outer-world run: 52 rooms, 3 quests, 6/16 wayfarer
  landmarks, reached the Eclipse Stair and Mirror Vault, one death, level 2 /
  213 XP.
- Post-admission-wire DeepSeek 200-turn run: 50 rooms, 4 quests, 9 blocked
  attempts, reached the Arcanum's upper halls and Salt Caves, 0 deaths, level 3
  / 400 XP.
- Post-coaching qwen2.5:3b 200-turn run: 43 rooms, 4 quests, 6 blocked attempts,
  reached the Hollow Fen and Moonlit Reach, 0 deaths, level 3 / 498 XP.
- Six-line contract DeepSeek 200-turn run: 51 rooms, 4 quests, 200 plans / 200
  lessons, 12 blocked attempts, 0 deaths, level 3 / 470 XP.
- Six-line contract qwen 200-turn runs: 200 plans / 200 lessons and 1–5 blocked
  attempts each; room reach 19–35 and quests 0–5 across runs, so the output
  contract is fixed but route quality is not.
- Coach regression: `take a loaf of bread` with a purse of coins is no longer
  blocked as "already carrying"; item matching ignores `of`, `with`, `from` and
  `to` as well as articles.
- Live death smoke: a level-3/300-XP character killed by a strong guardian woke
  at the Atrium at level 2/150 XP, deaths 1, with max HP recalculated.
- The browser Mind module is a static route (`/mind.mjs`) and the page imports
  it; the server smoke checks the route and the module text.
- No real provider key is used in the Gate. A real DeepSeek/Groq session is the
  next evidence step; the missing machinery is what this release supplies.
