# MUDBenchmark

A persistent text world where people and LLMs share one simulation — and every
variable that bears on an agent's behaviour is captured, so the same world
serves as a safety-alignment benchmark.

## The two products, one substrate

1. **A game.** A modernised MUD in the AberMUD lineage: rooms, exits, objects,
   roles, real-time play. People connect with a client. Agents connect the same
   way, through a small harness that injects their instructions.
2. **A benchmark.** The same world, instrumented. Every observation an agent
   receives, every context layer it was given, every action it took, and every
   resulting state transition is recorded against ground truth.

The two are not separate modes. There is one world and one engine; the
difference is how much of the instrumentation you switch on.

## The invariant that makes it a safety benchmark

**The engine knows the truth; no actor does.**

Each actor — human or model — sees a partial, role-filtered projection of the
world. The reducer knows the full state. That gap is the measurement
instrument, and it is why the safety claims here are checkable rather than
impressionistic: a model that describes the world wrongly can be compared
against what was actually true, and a model that knows something it was never
shown can be detected by construction.

## Architecture at a glance

| Plane | What it is | How it is built |
|---|---|---|
| Rules | The world's semantics: `(state, tick) → (state', events)`, every autonomous process included | LexLean model, proved in Lean, built by Prism |
| World | Rooms, exits, objects, roles, scenarios | Authored data, validated against the rules |
| Runtime | Holds state, batches real-time input into ticks, persists | Ordinary Rust |
| Gateway | The wire people and agents both use | Telnet-compatible text, plus a structured channel |
| Harness | The agent client: connects as a player, wraps model calls | Separate small process |
| Router | Geometric prompt engine: layered context, routed per turn | Its own service, benchmarked against flat prompting |
| Observability | OpenTelemetry spans for every observation, decision, action, tick | Schema in `docs/SAFETY-MODEL.md` |

The rules plane is the only proved part, and it is proved completely. Transport,
persistence and instrumentation are ordinary software — see
`ARCHITECTURE.md` for why that line is drawn where it is.

## Status

Founding scaffold. Nothing runs yet. The next milestones are the tick contract
and a single playable room.

## Provenance

The design descends from the `MUDBench` corpus in
[`R4-Laboratories/AI-Research`](https://github.com/R4-Laboratories/AI-Research)
at commit `0e8a4f5` (30 specifications under `MUDBench/`). What was adopted,
changed, or dropped is recorded in `docs/RECONCILIATION.md`; that document, not
the upstream corpus, is authoritative here.

## Layout

```
docs/           founding documents — reconciliation, safety model
prism/          the LexLean model and its Prism app (generated)
runtime/        the server (not yet started)
```
