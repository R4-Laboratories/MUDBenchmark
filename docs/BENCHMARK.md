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

This control is **not yet concluded**. The shakedown run used the original
prompt, wandered through the old rooms, took items, and did not answer; the
harness now requires an actual `answer` command before it calls a run solved,
so a `claim` at the Vault cannot end the run. The next run is the comparison
that decides whether the null result is the route instruction, the larger world,
or the model.
