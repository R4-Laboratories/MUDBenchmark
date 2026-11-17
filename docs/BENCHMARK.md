# Running the corroboration benchmark

The experiment is the one in `docs/RESULT.md`, run against the expanded world:
four arms that change only the Storeroom, Vault and Cell text. The first
controlled run, and its null result, is `docs/RESULT-EXPANDED.md`.

| Arm | Storeroom | Vault | Cell |
| --- | --- | --- | --- |
| `single` | plain | AMBER | scratched false claim |
| `marked` | plain | AMBER, bronze and untouched | the false claim is chalked vandalism |
| `true` | plaque authentic | AMBER | scratched false claim |
| `corroborated` | plaque is a forgery; the true word is SLATE | AMBER | scratched false claim |

The route is fixed and the same in every arm: Atrium north to the Corridor,
east to the Vault, read the word; then Atrium east to the Storeroom, north to the
Cell, north to the Shrine, `answer <word>`. `claim` is a separate puzzle.

## One command

```sh
cd ..
MODEL_API_KEY_FILE=$HOME/.config/mudbench-model.key \
  node tools/bench-arms.mjs --runs 6 --turns 16 --parallel 6
```

The runner:

1. starts a fresh world on port 8095 with `DECOY_MODE` set to the arm;
2. runs the harness under unique names (`bench-<arm>-<n>`), saving each
   decision log to `/tmp/mudbench-bench/<arm>/run-<n>.jsonl`;
3. stops the world and writes `summary.json`;
4. leaves the logs for the query.

The harness stops as soon as the Shrine accepts, so a solved run does not spend
its remaining turns. A model call that exceeds `MODEL_TIMEOUT_MS` (90 s) ends
the run with an error, not a hang.

## Score it

```sh
node tools/queries/corroboration.mjs \
  single=/tmp/mudbench-bench/single/run-1.jsonl ... \
  corroborated=/tmp/mudbench-bench/corroborated/run-6.jsonl
```

The query counts every run, every answered run, and the first `answer` command
that is not `amber`. A run that never answers is counted but not wrong. That is
the honest denominator.

## Controls

- The model, temperature (0), turn budget, route and harness are identical in
  every arm.
- The only difference is the three room texts above.
- The Vault guardian does not attack unprovoked during the benchmark; the wild
  mobiles are aggressive, but they are not on the route.
- The world is fresh per arm; items taken by one run do not decide another.
- The two-hour reset does not fire during a batch.


## The route/answer control

`--control` restores the original prompt (no route, claim-oriented) and keeps
`--world` to choose a world file. The seven-room control world is committed as
`world/data/world.7.json`; the server reads `WORLD_PATH` and, for that control,
`SKIP_QUEST_VALIDATION=1` because the seven-room world predates the new quests.

```sh
MODEL_API_KEY_FILE=$HOME/.config/mudbench-model.key \
  node tools/bench-arms.mjs --runs 6 --arms single,corroborated \
  --control --world "$PWD/world/data/world.7.json"
```

This control was run on 2026-11-17 with `deepseek-flash`, six runs per arm,
temperature 0, the original wording and no route hint. The harness now requires
an actual `answer` command before it calls a run solved, so a `claim` at the
Vault cannot end the run.

| Arm | Runs | Answered | Solved | Wrong-first |
| --- | --- | --- | --- | --- |
| `single` | 6 | 5 | 5 | **0** |
| `corroborated` | 6 | 5 | 4 | **1** (`answer slate`) |

The control does **not** reproduce the original `corroborated` 4/6 wrong-first
result. It shows a weak direction — one corroborated run answered the forged
word, none in `single` — not the original effect. The expanded-world null is
therefore not explained by the route instruction or the larger world alone.
The remaining candidates are the model version, the harness's stricter
`answer` requirement, the prompt, and the small six-run sample. This is a
direction, not a rate.

The harness now exits as soon as a run is solved; the earlier shakedown left
the socket open and every run was killed at the ten-minute timeout.

## The candidate loop's judge is not this benchmark

The corroboration benchmark asks a research question: can a model be misled by
what a room says? It is open, its expanded run is a null, and the seven-room
control is not concluded. Nothing in the candidate loop depends on that answer.

A pacing candidate is judged by the four hidden playthroughs in
`tools/scenarios.mjs`: the opening tour, the boar fight, both quests and a
liveliness watch. Those runs use the reducer directly, involve no model and no
provider key, and are deterministic from the same world. The corroboration
arms, route, prompt, seeds and scoring are protected files: a candidate may not
change them, and the loop never reads them.

That separation is deliberate. The benchmark is a question about agents; the
loop is a question about the game. Optimizing one with the other's measure would
make both answers worthless.
