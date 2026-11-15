# The game and the data

## The principle

The game is the instrument. The data is what it produces. A benchmark is a
**query over the data**, written afterwards, by someone who wants to know
something — not a rubric the game was built to satisfy.

That inverts the order this repository was drifting towards. Earlier sessions
built probes and then asked whether the world could produce the behaviour the
probe wanted. The order is the other way round: build a world worth inhabiting,
record everything, and let the questions emerge from what is in the record.

**There is no pass or fail.** A claim is recorded as `correct`, `confabulated`,
`refused` or `over-cautious` because those are different observable behaviours,
not grades. A dataset of 10,000 such rows is the point; a score out of ten is not.

## Loops are hierarchical

The world tick is the **input limit**: nothing a player or agent does can be
committed faster than one world tick. It is not the rate everything else lives
at.

| Loop | Period | What it does |
|---|---|---|
| world tick | 250 ms | commits inputs, applies transitions |
| NPC clock | per NPC: 8–24 ticks | each creature moves on its own schedule |
| area reset | 240 ticks | restores the world and advances the cycle |
| checkpoint | 240 ticks | writes the state snapshot |

A rat on an 8-tick clock and a moth on a 14-tick clock do not move together, and
neither moves every tick. Jitter is drawn from the tick number and the entity id,
so a replay wanders identically while still looking unhurried to a player.

The NPC periods live in `world/data/world.json`, so changing how lively a world
feels is a data change:

```json
{ "id": "rat", "name": "a rat", "room": 2, "home": 2, "period": 8, "jitter": 6 }
```

## The world resets

Old MUDs rebooted and reset their areas; a persistent world otherwise drifts into
a state nobody designed. Every area cycle the NPCs return home, the world's
arrangement is restored, and `cycle` increments. A long session is a series of
games, and the cycle number is in every state digest, so a dataset can be sliced
by it.

## What is captured

Every observation is a span; `tools/dataset.mjs` normalises them into rows.

| Event | What it records |
|---|---|
| `decision` | what the agent saw, what it said, whether it parsed, tokens, latency, router mode |
| `transition` | the admission verdict, the rooms, how many observers were told |
| `answer` | the word given, whether the actor had seen the Vault, the verdict |
| `claim` | the claim, its topic, whether it was sourced, the verdict |

```
node tools/dataset.mjs dataset/observations.jsonl /tmp/mudbench-spans.jsonl
```

```
64 observations → dataset/observations.jsonl
by event:   {"decision":36,"transition":22,"answer":4,"claim":2}
decisions:  36, 29 parsed
tokens in:  53789
latency ms: median 1503, max 2477
```

That is the shape of the artefact the project exists to produce: every action an
agent took, what it could have known when it took it, and what it cost.

`world.tick` and `world.baseline` spans are deliberately excluded — they carry
state digests for replay, not observations.

## What still has to exist before the data is rich

- **Objects.** Nothing can be taken, dropped, given or traded, so the transfer
  bound is a rule with no gameplay.
- **More interactions.** Look, move, speak, answer and claim are the whole
  vocabulary. Every verb added is a new column in the dataset.
- **NPC behaviour.** Creatures move; they do not react, speak or fight.
- **Human play.** The client exists and the world is public; no human has played
  it yet, and human behaviour is half the premise.
