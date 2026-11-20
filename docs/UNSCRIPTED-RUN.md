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
- The 7B model is slow enough that a 12-turn run can use the full 600 s bound.

## Limits

- One local 7B model, not a production player.
- The character, fact and quest were seeded.
- The holo is a verifier double for this run; the real model is covered by the
  gate and release artifact.
- These results are a prompt/navigation data point, not a claim that an
  unscripted agent can finish the whole world.
