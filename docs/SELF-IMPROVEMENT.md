# Self-improvement pipeline

Borrowed from `afflom/verdant-resonance`, which runs the most complete version of
this idea I have seen: a model that compiles into the game, a shrink-only
ratchet, KPI and gate commands, and an engine workflow generated from the model
that ticks on a schedule.

We take the mechanism, not the scale.

## The two numbers

Everything here reduces to a pair.

**Debt** — rules the runtime implements itself while a proof of the same rule
sits unused in the model. `world/ratchet.json` lists them by name with the model
predicate they shadow. This number may fall and never rise.

**Credit** — model modules, proved theorems, acceptance vectors. May rise, never
fall silently.

A gate that counts lines of code measures industry, not progress. Debt measures
the distance between what is proved and what is executed, which is the only
number in this project that has ever predicted a real defect: the EPIPE that
killed the world, the identity record that dropped its own key, the stale holo
that answered `refused` to a request the model could decide.

```
node tools/gate.mjs
```

| metric | value | bound |
|---|---|---|
| ruleDebt | 0 | <= 0 |
| unusedRules | 0 | <= 0 |
| modelModules | 9 | >= 9 |
| provedTheorems | 21 | >= 21 |
| acceptanceVectors | 25 | >= 25 |
| classicalChoiceAxioms | 0 | == 0 |

## The tick

```
node tools/tick.mjs
```

The tick **does not change code**. It names the smallest next improvement, with
the model predicate, the runtime site, and the reason the duplication is
dangerous. Mechanizing is a reviewed decision; a tick that edits files unattended
would be an agent with a licence rather than a task.

This is the deliberate difference from verdant-resonance, whose tick runs for
thirty-five minutes every half hour and rewrites generated code. Ours is a
proposal because our model is small enough that a person can still hold it.

## The loop

```
schedule (6h) ─▶ gate ─▶ debt/credit table ─▶ tick ─▶ issue or PR ─▶ gate
```

`.github/workflows/gate.yml` runs on push, pull request, manual dispatch and a
six-hour cron. It has two jobs:

1. **ratchet** — five seconds, runs the gate and prints the next tick.
2. **model** — up to forty-five minutes: `prismpm verify` in the pinned SDK
   image, then `build`, then every acceptance vector replayed through the built
   guest.

Neither job depends on timing, so a red run is a regression rather than a flake.

## What is not copied

- **Generated workflows.** Verdant writes `engine.yml` from
  `Foundation.Mechanization.V1.Model`. Ours is hand-written, and that is itself
  a rule-debt item waiting to happen.
- **Browser-resident foundry.** Verdant compiles the organism in the visitor's
  browser with watchdog rollback. We have no browser build of the model yet.
- **Zero-residue mechanization.** Verdant compiles every `.lex.tex` definition
  into typed TypeScript so no rule is written twice. That is the end state this
  ratchet is walking towards: `ruleDebt` to zero, and the runtime calling
  generated code instead of re-deciding.

## Adding a debt item

Adding to `ruleDebt` raises a ceiling, which the gate treats as a regression
unless the ceiling is raised in the same commit — deliberately, visibly, with a
reason. That asymmetry is the whole point: it is easy to notice improvement and
impossible to hide decline.

## Status

`v0.91.60` is published and deployed. The server hosts no model and holds no provider key; each browser harness runs its own R4 router and notebook. wick runs the release artifact, not a
build directory, so the number on the box is a tag someone can point at:

```
mudbench-deploy --status   →   release v0.91.60
```

`main` has no required status checks, so the loop's direct push lands. The Gate
still runs on every push and pull request, and X6's release workflow requires a
green Gate on the exact SHA, so a red commit cannot become a release even when
it is on `main`. The merged-PR publisher also requires the gated SHA to be the
PR's actual `merge_commit_sha`; a direct or pacing commit that GitHub associates
with a merged PR is skipped.

S0, S1 and the S2 write path are in place. The loop uses only `GITHUB_TOKEN`:
`loop.yml` builds the inventory, measures it, runs the gate in the same job,
commits `world/data/generated/pacing.json`, and dispatches a tagged release. It
does not need a GitHub App.

X6 adds the deliberate release: `gh workflow run release.yml -f sha=<sha> -f
tag=vX.Y.Z` finds the successful Gate run for that SHA, downloads its artifact
(holo, manifest and identity receipt), creates the tag and publishes the
release. A missing or red Gate stops before the tag. The deploy timer pulls the
newest release every ten minutes; rollback is `mudbench-deploy <previous-tag>`.
`docs/RELEASES.md` records the path and the rehearsal.

---

# From a gate to a bounded self-improvement loop

Status: **S0, S1 and the S2 write path are in place.** The loop can propose,
measure, admit, write one file, gate it, commit it and dispatch its release. What
it cannot do yet is push past `main`'s required checks. That is a repository
setting, not a missing credential, and it is the only thing between the tick and
a live change.

## What we already have

| Part | Current state |
| --- | --- |
| deterministic reducer | `step(state, intents, rooms)`; replay from spans |
| ratchet | `ruleDebt` 0; `unusedRules` 0; model modules, theorems, vectors bounded |
| gate | model verify/build/vectors, world, renderer, combat, items, comms, quests, guilds, map, UI, claims |
| claims | build/open/some-true; `docs/CLAIMS.md` generated; queries for behavioural results |
| release | tagged release with holo + runtime; `v*` only |
| deployment | pull-based; vector replay before flip; health check and rollback |
| improvement tick | `tools/tick.mjs` names the next debt item; it does not edit |
| bounds | `world/bounds.json`: four pacing groups, each target with a band |
| candidate inventory | `tools/candidate.mjs`: 14 seeded candidates, no write permission |
| measure | `tools/measure.mjs` + `tools/scenarios.mjs`: four hidden playthroughs |
| admission | component-wise dominance over a hash-bound report; no winner is a settlement |

That is a strong *evaluation* loop. S1 adds the proposing and measuring half.
It is still not self-improvement in the publishing sense: a person (or, in S2, a
publisher) has to act on an admitted report. Nothing writes to the world.

### What S1 does, precisely

```
node tools/candidate.mjs --seed <seed> --out candidates.json
node tools/measure.mjs --candidates candidates.json --out result.json
```

- **The inventory is finite.** Every single-group perturbation at the recorded
  multipliers, plus a seeded selection of pairs. The seed chooses the pairs and
  their order; it never chooses a value, and a value outside its band is refused
  before measurement.
- **The judges are hidden.** `candidate.mjs` does not import `scenarios.mjs`.
  A proposer cannot select a variant because it suits the test.
- **The measures are playthroughs.** An opening tour (coin, bread, shop, meal),
  a fight with the boar, both quests walked end to end, and a fifteen-hundred
  tick watch on the temple. Every scenario is deterministic.
- **Admission is dominance, not a weighted score.** A candidate must be no worse
  on every component and better on at least one. A tie or a trade-off is a
  refusal. A ranking is only used to pick among candidates that already
  dominate.
- **No winner is a result.** When nothing dominates, the report says `settled`
  and names no improvement. That is the frontier rule, not a failure. The
  publisher exits 0 and writes `committed=false`, so the release step is skipped
  and a settled tick is green.
- **The targets are the measured ones.** `hostile-hp` and `hostile-damage`
  name only the boar, because only the boar has a scenario. The wolf, ghoul and
  smuggler join when their scenarios exist. A target without a judge is a place
  a loop could improve a number nobody watches.

### What S2 does, precisely

- **One file.** The publisher writes `world/data/generated/pacing.json` and
  nothing else. It refuses a working tree with any other change.
- **Composition, not stacking.** The file stores absolute values against the
  raw world. A second candidate replaces a field; it does not apply two
  multipliers in a row. The loader derives `maxHp` from `hp`, so a generated
  file never carries `maxHp`.
- **Fresh admission.** The publisher re-measures the inventory itself. A stale
  or edited report cannot name a winner the current world did not admit.
- **Gate first.** It writes the file, runs `node tools/gate.mjs` with the
  candidate applied, and restores the old file if the gate fails.
- **Admission kernel.** `world/src/Admission.lex.tex` proves a candidate is
  admitted only when five obligations hold: its identity binds the inventory,
  report and world; it is no worse on every measured component; it is better on
  at least one; every change is inside its bound; and the gate completed.
  `tools/admission.mjs` is the JavaScript twin. The publisher asks it before it
  writes and records the decision inside `pacing.json`; the gate replays the
  kind-8 vectors through both and writes `world/admission-receipt.json`, which
  the release publishes.
- **Commit, then release.** `--commit` runs the gate and admission on this
  tree, commits the one file, and pushes to `main`. The workflow waits for the
  `Gate` run on that exact SHA and dispatches X6's `release.yml`, which
  downloads the tested artifact and publishes the tag.
- **PR fallback.** `--push` creates `loop/<candidate>-<hash>` and opens a pull
  request. It never pushes to `main`; it is for a person who wants the review
  path.
- **Settle is silent.** When the inventory has no winner, the publisher refuses
  and opens nothing. In the first end-to-end test the second tick settled: the
  applied candidate is a fixed point, not a step toward another change.
- **Opt-in and pause.** The job runs only when `MUDBENCH_LOOP=on`; set it to `off` to stop it.

### The branch decision

`main` is unprotected, so the loop's direct push lands after the publisher's
in-job admission and gate. The push triggers a `Gate` run on the commit; X6's
`release.yml` requires that latest run to be green and downloads its artifact.
A red candidate therefore cannot be released, and a planted bad candidate is
refused by the admission before it is pushed. The `--push` path remains for a
review pull request.

The other design — required checks, a loop branch, a dispatched Gate and a
merge — preserves the human gate but adds moving parts. It is recorded here as
the alternative, not the chosen path.

## Turning the loop on

1. Set the repository variable `MUDBENCH_LOOP=on`. The default is off.
2. Run the **Loop** workflow by hand with `dry-run`. It measures, writes the
   pacing file, runs the admission and the full gate with it applied, prints it,
   and restores it.
3. Run it with `commit`. It admits and gates the candidate, commits and pushes
   the one file, waits for the main `Gate` on that exact SHA, and dispatches
   X6's `release.yml` for the loop tag.
4. Stop it with `MUDBENCH_LOOP=off`.

The first real commit is `2f0d8ce` (pacing candidate), released as
`v0.36.0-loop.3.1` and pulled by the deploy timer. The first admitted candidate
with the L5 record is `c-4abd39bfc4ff`: committed as `a118a66` with all five
obligations inside `pacing.json`, gated, released as `v0.39.1-loop.manual`,
deployed, rolled back to `v0.39.0`, and restored.

## What the references actually contribute

### `lexlean-r4`

- A finite candidate inventory: CURRENT plus a bounded set of generated
  variants, with an explicit selection rule and tie-breaking.
- Guarded application: `applyProposal` validates the whole state, the binding,
  the candidate bounds and the epoch before changing one field; any refusal
  returns the complete original state.
- Proof receipts: a candidate is only admitted when the kernel and the
  acceptance controls pass; the receipt is recorded, not asserted.
- A scheduled engine tick with a pinned SDK, a tip check, a settled cache, a
  single concurrency group and a pause switch.
- `frontier.toml` and a finite frontier that settles rather than manufacturing
  progress.

### `uor-cs1.618`

- Bounded source families with a fixed grammar; no arbitrary code or imports.
- Independent evaluators with a training corpus and held-out variants; the
  author never sees the evaluator corpus.
- An admission kernel compiled from Prism with four obligations: protected
  fidelity, measured benefit, resource bounds and completed application checks.
- Protected files: the loop cannot edit its evaluators, tests, workflow,
  policy or admission Wasm.
- A hash-bound publisher that owns a named, small set of generated files,
  rejects a changed main, fast-forwards, and explicitly dispatches deployment.
- A settlement rule: when the frontier is exhausted, a tick makes no commit and
  claims no improvement.
- A pause variable and a revert path through normal deployment.

We take the mechanism, not the scale.

## Preconditions: what "stable bound" means here

Self-improvement starts only when all of these hold:

1. **The rules are closed.** `ruleDebt` 0 and every public failure is typed,
   modeled and negative-tested. `unusedRules` is either 0 or each remaining rule
   is documented as unreachable by construction.
2. **The world is deterministic and replayable.** A span trace reproduces the
   state; a checkpoint upgrade is tested; a release can roll back.
3. **The bounds are explicit.** Tick budget, client cap, object/mobile counts,
   mail/quest/guild caps, economy limits, route and room counts. A candidate
   that exceeds a bound is refused before evaluation.
4. **The judges are protected.** `tools/gate.mjs`, `tools/claims.mjs`,
   `tools/bench-arms.mjs`, `tools/queries/`, the workflows, `world/ratchet.json`
   and the SDK lock are not writable by the loop.
5. **The claims are honest.** Every behavioural claim is `open` with a query,
   sample size and seed; no candidate is allowed to change the claim it is
   measured against.
6. **The publication boundary is small and named.** A publisher owns a short
   list of generated files; everything else is human-owned.
7. **A pause and a revert exist.** One repository variable stops ticks; a
   failed gate cannot publish; a revert goes through the normal release and
   deploy path.

## Candidate families, in order of risk

| Family | What changes | How it is judged | When |
| --- | --- | --- | --- |
| **A. Mechanical pacing** | NPC period/jitter, object respawn values, shop prices, quest XP, mob damage/hp within bands | fixed scenarios + dataset queries + resource bounds | first |
| **B. Content templates** | room descriptions from a bounded grammar, dialogue lines, quest text | schema, protected facts, readability/lexical checks, human review | after A |
| **C. Procedural layout** | new rooms/zones from a fixed map grammar | reachability, reciprocal exits, safe-zone rules, quest solvability | after B |
| **D. Rule/code rewriting** | reducer or generated model code | full proof, vectors, replay, no rule debt | last, maybe never |

The first family is deliberately boring: a candidate changes a **number in a
bounded band**, not a rule. It can be evaluated against the same world, the same
gate and the same dataset, and it cannot invent a new mechanic.

## The loop

```
schedule ─▶ candidate (bounded) ─▶ measure on fixed scenarios
        ─▶ admission (gate + bounds + claims) ─▶ publisher (owned files)
        ─▶ release ─▶ deploy (pull, replay, health, rollback)
        ─▶ evidence (hash-bound record) ─▶ settle or next candidate
```

### S0 — Stabilize (the work before any automation)

- Close `unusedRules` or document each as unreachable.
- Add the typed-refusal table and negative tests for every verb.
- Finish the benchmark control question (`docs/BENCHMARK.md`): route vs world
  vs model. Do not let a self-improvement loop optimize an unsettled measure.
- Make the tick/checkpoint/rollback path boring.

### S1 — Candidate harness, no writes

- `tools/candidate.mjs` proposes a finite set of bounded variants for family A.
- `tools/measure.mjs` runs the fixed scenarios and the claims queries.
- The output is a candidate report with a hash, not a commit.
- Acceptance: a planted bad candidate is rejected by a named bound; a good one
  is reproducible from its seed.

### S2 — Admission and a dry-run publisher

- An admission policy, preferably a small LexLean/Prism kernel, consumes:
  protected fidelity, measured benefit, resource bounds and completed gate.
- The publisher writes only `world/data/generated/*.json` to a branch and opens
  a PR. It never pushes to `main`.
- Acceptance: a candidate that changes a protected file is refused; a candidate
  that fails the gate is refused; a stale main is not rebased.

### S3 — Scheduled proposals

- A GitHub Actions tick (off the hour), pinned SDK, state file, evidence
  artifacts, a single concurrency group and a pause variable.
- It opens a PR at most once per tick; a settled frontier opens nothing.
- Acceptance: a red gate blocks; a settled tick is silent; the pause variable
  stops it.

### S4 — Human-gated auto-merge

- Only after S2/S3 have run clean for a sustained period.
- The automerge path already proven on PR #1 is reused, but the admission
  kernel and the protected-file check run before it.
- Acceptance: a planted bad candidate cannot merge; a rollback is rehearsed.

### S5 — Typed content authorship

- Bounded recipes for dialogue, descriptions and quests; no arbitrary code.
- Independent readability/fact checks; protected lore facts (the Vault word,
  the Shrine answer, safe rooms) cannot be changed.
- Human review remains for voice and taste.

### S6 — Rule evolution

- Only when `ruleDebt` is 0, the model is fully verified, and every candidate
  carries a proof or is refused.
- A rule change is a new model revision, not a generated patch to the runtime.

## What the loop must never do

- Edit its own gate, evaluator, claims ledger, workflow, admission policy or
  publisher.
- Change the benchmark's task, arms, seed or scoring to make a candidate look
  better.
- Grant itself currency, items, levels, guild rank or admin role.
- Publish on a failed gate, a stale main or a missing receipt.
- Claim an improvement when the frontier is settled.
- Run arbitrary generated code, imports, shell commands or network calls.
- Write a file outside `world/data/generated/`.
- Hold a model provider key on the game server.

## Near-term recommendation

The candidate publisher and admission are built. The benchmark control is
concluded: the seven-room control does not reproduce the original 4/6
wrong-first result, so the expanded-world null is not explained by the route
hint or the larger world alone (MB-35). The next benchmark work is a larger
sample and a prompt/harness comparison, not another loop feature.

For the loop, keep the frontier rule: a settled inventory is a green no-op, and
a candidate is admitted only through the proved five-obligation kernel.

This keeps the current game shippable while the loop learns to propose. A
self-improving game that can rewrite its judges is not a game; it is an
unbounded experiment. The bound is the feature.
