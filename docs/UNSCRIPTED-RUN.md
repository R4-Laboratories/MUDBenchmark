# Unscripted run: Memory Garden

This is the first unscripted model run against the new fact-gated action. The
server is real; the model decides every command. It is not a production session.

## Setup

- Local model: **qwen2.5:7b** through Ollama, temperature 0.
- Isolated server: private ports 8099 / 4012, private state and spans.
- Seed: level-10 character in the Memory Garden with the `garden-word` fact, a
  memory rose and the Remembered Bed quest active.
- Holo: verifier double; R4 points at a closed port, so the local fact store is
  the fallback.
- No production account, state or telemetry was touched.

Run it again with:

```
node tools/unscripted-session.mjs
```

## Attempt 1

The goal was the garden loop: take the rose, plant it, go down, take the bloom,
talk to the rememberer.

| Result | Value |
| --- | --- |
| Turns | 14 |
| Wall time | 300 s (bounded) |
| Took rose | yes |
| Planted rose | yes |
| Entered hidden room | no |
| Took bloom | no |
| Finished quest | no |

The model planted the rose, then repeated `look` and tried to take the bloom
before going down. It never entered the stair.

## Attempt 2

The goal was made explicit and ordered; the run was given 12 turns and 600 s.

| Result | Value |
| --- | --- |
| Turns | 12 |
| Wall time | 600 s (bounded) |
| Took rose | yes |
| Planted rose | yes |
| Entered hidden room | yes |
| Took bloom | yes |
| Talked to rememberer | no |
| Finished quest | no |

The model followed `take memory rose`, `plant rose`, `down`, `take remembered
bloom`, then drifted into `claim` commands instead of returning to the
rememberer. The quest stayed active.

## Attempt 3: after route memory

The shared route ledger and loop guard were then wired into the CLI agent.

| Result | Value |
| --- | --- |
| Turns | 7 |
| Wall time | under 120 s |
| Took rose | yes |
| Planted rose | yes |
| Entered hidden room | yes |
| Took bloom | yes |
| Talked to rememberer | yes |
| Finished quest | yes |
| Exit code | 0 |

Commands:

```
take memory rose
plant rose
down
take remembered bloom
up
north
talk rememberer
```

The agent stopped cleanly on `Quest complete: The Remembered Bed` instead of
waiting for the model timeout.

## Root Archive run (v0.85)

The same harness was pointed at the new Root Archive with three waypoints:
`The Root Archive:talk`, `The First Bed:take`, `The Root Archive:talk`.

| Result | Value |
| --- | --- |
| Turns | 9 |
| Waypoints | 3 / 3 |
| Took first seed | yes |
| Talked to root keeper | yes |
| Finished First Bed quest | yes |
| Exit code | 0 |

This run used the BFS route hint and waypoint sequencing, not a scripted
command list. It is the broader multi-room evidence for v0.85.

## Long Remembering run (v0.86)

The final broad scenario started at the Root Gate with the Long Remembering
quest active and the public room table seeded into the route graph.

| Result | Value |
| --- | --- |
| Turns | 13 |
| Map seeded | 105 rooms |
| Waypoints | 2 / 2 |
| Talked to guild clerk | yes |
| Recalled root at shrine | yes |
| Long Remembering quest | complete |
| Exit code | 0 |

The route was Root Gate → Market Square → Gilded Rat → Guild Hall → back through
Market Square → Atrium → Cell → Shrine. The model chose the actions; the route
guard kept movement on the BFS path and the waypoint sequencer changed the
destination after the Guild Hall conversation.

## What this proves

- The fact-gated `plant rose` action works under unscripted play: a model can
  learn the prerequisite fact, hold the rose, plant it, and open the hidden
  stair.
- The hidden room and the bloom are reachable through the action.
- The remaining gap after attempts 1-2 was model navigation and NPC interaction
  after the reveal. The route ledger and loop guard closed that gap for the
  first garden chain: attempt 3 completed the quest in seven turns.
- The BFS route and waypoint sequencer then completed the broader Root Archive
  run in nine turns.
- Seeding the route graph from `/llms.txt` and adding the movement guard carried
  the town-spanning Long Remembering run to completion in 13 turns.
- The 7B model is slow enough that a 12-turn run can use the full 600 s bound.

## Remote DeepSeek runs (v0.88)

Both runs below used `MODEL_PROVIDER=opencode MODEL_NAME=deepseek/deepseek-flash`
through the OpenCode CLI. No Ollama or local model process was used.

### Root Archive

| Result | Value |
| --- | --- |
| Turns | **5** |
| Took first seed | yes |
| Talked to root keeper | yes |
| First Bed quest | complete |
| Exit code | 0 |

### Three Rememberings

| Result | Value |
| --- | --- |
| Turns | **24** |
| Objectives | **4 / 4** |
| Took orchard seed | yes |
| Talked to orchard keeper | yes |
| Long Remembering prerequisite | already complete |
| Three Rememberings quest | complete |
| Exit code | 0 |

The multi run used the nearest-objective planner, the map-seeded BFS route and
the objective guards. It wandered at times but the guards kept the route and
the target actions on track. The no-room spam loop was fixed during this run.

## Two-quest remote run (v0.89)

The final broad run used remote DeepSeek and two simultaneous quests:

- **Press Beneath** — talk to the orchard keeper, reach the Seed Vault, take the
  press seed.
- **The Clerk's Errand** — take the clerk seal from the Rat Warren and deliver
  it to the guild clerk.

The delivery objective carried a `>The Rat Warren` dependency so it could not
be attempted before the seal was taken.

| Result | Value |
| --- | --- |
| Turns | **31** |
| Press Beneath | complete |
| Clerk's Errand | complete |
| Press seed | yes |
| Orchard keeper talk | yes |
| Exit code | 0 |

## Three-quest remote run (v0.90)

The final broad run used remote DeepSeek and three simultaneous quests:

- **Press Beneath** — orchard keeper, Seed Vault, press seed.
- **Cider Spring** — spring keeper, White Bed, cider bloom.
- **First Bed** — root keeper, First Bed, first seed.

All objectives were action-only (talk, take, visit), avoiding the answer and
delivery edge cases.

| Result | Value |
| --- | --- |
| Turns | **23** |
| Press Beneath | complete |
| Cider Spring | complete |
| First Bed | complete |
| Press seed | yes |
| Cider bloom | yes |
| First seed | yes |
| Exit code | 0 |

The route lock kept every mid-route turn on the BFS next step, and the
objective guards handled the talk/take actions at each target. This is the
shortest broad run so far.

## Multi-objective planner (v0.87)

`AGENT_OBJECTIVES` now carries `Room:action` entries and chooses the nearest
unfinished target, rather than following a fixed waypoint order. The gate
covers the current-room case, nearest-target choice and wrong-room action
redirection. A new unscripted run was **not** completed for this slice: the
local 7B model was stopped to avoid overloading the development laptop. The
planner and content are gated; the next run should use a remote API model.

## Limits

- Remote DeepSeek through OpenCode, not a local model and not a production player.
- The character, fact and quest were seeded.
- The holo is a verifier double for these runs; the real model is covered by the
  gate and release artifact.
- The remote provider is paid/free according to the OpenCode model; it is not a
  local or offline model.
- These results are a prompt/navigation data point, not a claim that an
  unscripted agent can finish the whole world.
