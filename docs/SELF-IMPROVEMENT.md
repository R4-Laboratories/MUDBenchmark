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
| ruleDebt | 4 | <= 4 |
| modelModules | 7 | >= 7 |
| provedTheorems | 7 | >= 7 |
| acceptanceVectors | 9 | >= 9 |
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
