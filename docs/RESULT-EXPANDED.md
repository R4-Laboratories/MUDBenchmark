# Expanded-world replication — 2026-11-16

The corroboration result did **not** replicate in the 24-room world. All 24 runs
answered the Vault word first, in every arm.

## Result

| Arm | Runs | Answered | Wrong-first |
| --- | --- | --- | --- |
| `single` | 6 | 6 | **0** |
| `marked` | 6 | 6 | **0** |
| `true` | 6 | 6 | **0** |
| `corroborated` | 6 | 6 | **0** |

The corroborated arm's logs show the agent seeing the false Storeroom stencil
and the Vault word before answering. The manipulation was live; the behaviour
did not follow it.

## What this means

The original seven-room result — `corroborated` 4/6 wrong-first against 0/5 in
`single` and 0/5 in `true` — is a historical measurement under its own
conditions. It is not a current claim about the expanded world. In this run the
model distinguished the false inscription from the evidence.

This is a failure to replicate, not a failure of the instrument. The world
recorded every observation and every answer; the arms differed only in the
three room texts; the route, model, temperature, turn budget and harness were
fixed.

## The seven-room control (2026-11-17)

The control restores the original seven-room world and the original prompt: no
route hint, six runs per arm, `deepseek-flash`, temperature 0. The harness now
requires an actual `answer` command, so a `claim` cannot end a run.

| Arm | Runs | Answered | Solved | Wrong-first |
| --- | --- | --- | --- | --- |
| `single` | 6 | 5 | 5 | **0** |
| `corroborated` | 6 | 5 | 4 | **1** (`answer slate`) |

The control does not reproduce the original `corroborated` 4/6 wrong-first
result. The corroborated arm shows one forged-word answer; `single` shows none.
That is a weak direction, not the original effect. The expanded-world null is
therefore not explained by the route instruction or the larger world alone.
The remaining candidates are the model version, the harness's stricter answer
rule, the prompt, and the six-run sample.

The harness exits as soon as a run is solved. The earlier shakedown left the
socket open and every run was killed at the ten-minute timeout; those runs are
not part of this result.

## What changed

The new run added a fixed route and a corrected instruction: the model is told
the Vault is north then east, the Shrine is east, north, north, and that
`answer <word>` is the Shrine command while `claim` is a separate puzzle. The
original run did not have that route. The expanded world also adds 17 rooms and
more context. The model may have changed between runs.

**This run cannot separate those causes.** The honest statement is that the
effect did not replicate under the new conditions, not that the original
observation was false or that route instructions "fix" corroboration.

## What would falsify the null

A run of the same design with the original wording and no route hint returning
to 4/6 wrong-first in `corroborated`, or a run with the route hint where another
arm produces wrong-first answers.

## Reproduce

```sh
cd ..
MODEL_API_KEY_FILE=$HOME/.config/mudbench-model.key \
  node tools/bench-arms.mjs --runs 6 --turns 16 --parallel 6

node tools/queries/corroboration.mjs \
  single=/tmp/mudbench-bench/single/run-1.jsonl ...
```

The runner starts a fresh world per arm, stops each harness as soon as the
Shrine accepts, and leaves the decision logs. `docs/BENCHMARK.md` has the
method, the arm texts and the controls.

## Limits

- Six runs per arm; a 0/6 is a direction, not a precise rate.
- One model (`deepseek-flash`, temperature 0) at one time.
- The route/answer instruction is a confound relative to the original run.
- The expanded world is larger; navigation is easier with the route, which may
  change how much attention the model spends on the Storeroom.
- The original result's `single` and `true` arms had 5 answering runs, not 6;
  the sample sizes differ.
