# Reconciliation

The upstream corpus is 30 specifications in
`R4-Laboratories/AI-Research` at commit `0e8a4f5` under `MUDBench/`. They were
written as drafts, in sequence, by different attempts at the same product. They
do not agree with each other everywhere.

**This document, not the upstream corpus, is authoritative for this repository.**
Where the two differ, this wins.

## 1. Method

Each upstream document received one verdict:

- **Adopt** — carried forward essentially intact
- **Amend** — the intent survives, the specifics change here
- **Supersede** — replaced by a document in this repository
- **Defer** — still relevant, not yet reconciled

Documents were read directly before being classified. Anything marked Defer has
been catalogued by filename only and is not yet relied upon.

## 2. Verdicts

| Upstream document | Verdict | Note |
|---|---|---|
| `PROJECT_CHARTER.md` | Adopt | mission statement survives intact |
| `docs/project philosophy/mudbench_v0_3.md` | Adopt | the thesis: reconciliation of partial perspectives |
| `SYSTEM_ARCHITECTURE.md` | Amend | five subsystems map onto the planes in `ARCHITECTURE.md` |
| `SIMULATION_ENGINE_SPEC.md` | Amend | see contradiction 3, tick semantics |
| `AGENT_INTERFACE_SPEC.md` | Amend | see contradiction 2, one wire |
| `WORLD_IMPLEMENTATION.md` | Adopt | AberMUD-6 style first world |
| `BENCHMARK_SCORING_SPEC.md` | Adopt | capability vector retained |
| `MATCHMAKING_AND_RATING_SYSTEM.md` | Defer | arena layer, later phase |
| `ARENA_AND_TOURNAMENT_SYSTEM.md` | Defer | later phase |
| `PRODUCT_SPEC.md` | Amend | see contradiction 1 |
| `IMPLEMENTATION_PHASES.md` | Amend | phase order kept, contents change — see §4 |
| `REPO_STRUCTURE.md` | **Supersede** | describes a Python repo; this one is Rust + Prism |
| `AGENT_RUNTIME_SPEC.md` | **Supersede** | see contradiction 5 — different subject entirely |
| `docs/GEOMETRIC_ROUTED_PROMPT_ENGINE.md` | Amend | adopted as the router plane; promoted from optional experiment to a first-class service |
| `SCENARIO_SPEC.md`, `SCENARIO_LIBRARY.md` | Defer | needed before scored runs |
| `REPLAY_AND_TELEMETRY_SPEC.md` | Amend | subsumed by the safety span schema |
| `DATA_SCHEMA_AND_STORAGE_SPEC.md` | Defer | |
| `VALIDATION_AND_GUARDRAILS.md` | Defer | |
| `LEADERBOARD_AND_EVALUATION_REPORTING.md` | Defer | |
| `EXPERIMENT_TRACKING_AND_REGISTRY.md` | Defer | |
| `WORLD_SPEC.md` | Defer | |
| `AGENT_BASELINE_LIBRARY.md` | Defer | |
| `TASK_TEMPLATE_LIBRARY.md` | Defer | |
| `VISUALIZATION_AND_ANALYTICS_SPEC.md` | Defer | |
| `CODING_AGENT_PLAYBOOK.md` | Defer | process for building, not the product |
| `CI_AND_AUTOMATION_PIPELINE.md` | Defer | |
| `CONTRIBUTION_AND_REVIEW_MODEL.md` | Defer | |
| `DEVELOPER_GUIDE.md` | Supersede | rewritten when there is code |
| `RELEASE_AND_VERSIONING_STRATEGY.md` | Defer | |
| `docs/*` shard and identity notes | Defer | persistent-identity work, later phase |

## 3. Contradictions, and how they resolve

### 1. Is it a benchmark platform or a game?

`PRODUCT_SPEC.md` — "a benchmark platform built on top of a persistent
text-world simulation."
`WORLD_IMPLEMENTATION.md` — the project should "stop being a benchmark framework
in the abstract and become a playable text-world."

**Resolution:** the playable world comes first, because a benchmark over a world
nobody plays is measuring a fixture. But the product's *definition of done*
stays the benchmark's: a run must be reproducible and comparable. `WORLD_
IMPLEMENTATION` sets the order; `PRODUCT_SPEC` sets the bar.

### 2. Do agents get a constrained loop or the same wire as people?

`AGENT_INTERFACE_SPEC.md` — a controlled turn-based `observation → action` loop,
"easy to implement in any programming language," agents "cannot bypass benchmark
constraints."
The product decision here — agents connect the same way a human does, through a
harness.

**Resolution:** both, at different layers. The **wire** is the human one. The
**action vocabulary** stays constrained: an agent may only issue commands a human
client could issue. The turn discipline the interface spec wanted is imposed
*client-side by the harness*, not by a separate server endpoint. This keeps one
world, one grammar and one privilege level — which is the point — while still
making runs comparable.

Consequence to accept: a slow model gets fewer actions per unit of world time.
That is a real property of playing, and it must be recorded rather than
corrected.

### 3. Fixed discrete ticks, or real-time play?

`SIMULATION_ENGINE_SPEC.md` — discrete steps `t = 0, 1, …, T`.

**Resolution:** both. Logical time is discrete and the reducer only advances a
tick; the runtime batches wall-clock input into the next tick. Determinism is
preserved and humans do not wait for an invisible turn order. See
`ARCHITECTURE.md` §4.

### 4. "No global truth" — but a benchmark needs ground truth

`mudbench_v0_3.md` — "No global truth. Truth = reconciled intersection of
perspectives."

**Resolution:** this is the sharpest idea in the corpus and the one easiest to
misread. There is no global truth *available to actors*. The engine holds the
true state by construction; actors hold partial, role-filtered projections. The
distance between an actor's claims and the engine's state is precisely what the
benchmark measures. Without ground truth the thesis would be unfalsifiable;
with it, the thesis becomes an instrument.

### 5. `AGENT_RUNTIME_SPEC.md` is about a different thing

It describes the scaffolding for **coding agents working on the repository** —
iteration, reproducibility, safety of automated development. It is not the
runtime for a player agent.

**Resolution:** superseded here. Repository-development process is a separate
concern and will be written when there is a repository to develop.

### 6. Capability scoring vs safety measurement

`BENCHMARK_SCORING_SPEC.md` measures navigation, memory, planning, tactical
competence, social interaction, efficiency. The product requirement is broader:
capture as many variables as possible and model safety alignment.

**Resolution:** these are two outputs of the same run, not two modes. The
capability vector stays as the game-performance score. Safety constructs are a
separate, wider instrument — see `docs/SAFETY-MODEL.md`. Neither replaces the
other.

## 4. Phase order

Upstream phases: 0 foundation, 1 simulation engine, 2 agent interface, 3
evaluation, 4 replay/telemetry, 5 arena.

Amended here:

| Phase | Content | Change from upstream |
|---|---|---|
| 0 | Repo, reducer contract, one room | reducer contract is new and comes first |
| 1 | World + reducer proved, playable by a human | proves before it plays |
| 2 | Gateway + harness, one agent plays | same wire, so phase 2 is smaller |
| 3 | Observability + span schema | promoted earlier: captures before scoring |
| 4 | Router + flat-prompt control | new, and measurable from the start |
| 5 | Scoring, scenarios, arena, matchmaking | as upstream |

Observability moved ahead of scoring on purpose. A safety benchmark that adds
measurement after the run format is fixed will spend its life backfilling.

## 5. What is explicitly not carried forward

- the Python package layout and its toolchain
- `AGENT_RUNTIME_SPEC.md` as a player-facing document
- any assumption that the benchmark and the game are separate deployments
- the optional status of the routed prompt engine
