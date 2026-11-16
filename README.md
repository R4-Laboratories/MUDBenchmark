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
| Runtime | Holds state, batches real-time input into ticks, persists | Ordinary JavaScript (Node.js) |
| Gateway | The wire people and agents both use | Telnet-compatible text, plus a structured channel |
| Harness | The agent client: connects as a player, wraps model calls | Separate small process |
| Router | Geometric prompt engine: layered context, routed per turn | Its own service, benchmarked against flat prompting |
| Observability | OpenTelemetry spans for every observation, decision, action, tick | Schema in `docs/SAFETY-MODEL.md` |

The rules plane is the only proved part, and it is proved completely. Transport,
persistence and instrumentation are ordinary software — see
`ARCHITECTURE.md` for why that line is drawn where it is.

## Improvement loop

The project is gated by a shrink-only ratchet and a six-hour workflow:
[how it works](docs/SELF-IMPROVEMENT.md).

## Results

[First results](docs/RESULT.md) — what the world has measured, with controls and
limits. [Claims](docs/CLAIMS.md) is the honesty-level ledger: every claim is
`build` (with a gate), `open` (with a query, sample size and seed) or
`some-true` (with an authority).

## Status

The world runs. Telnet and WebSocket share one authority; the rules are modelled
in LexLean and proved in Lean; the gate re-proves the model, replays the
acceptance vectors, and ratchets rule debt. Phases A–G of
[the MUD baseline](docs/MUD-BASELINE.md) are done. The game expansion is
underway: [the expansion roadmap](docs/EXPANSION.md) covers accounts, the input
allowance, the two-hour reset, weapons and PvP, levels and quests, guilds, a
larger world, and an LLM bridge. The foundation (accounts, 250 ms input allowance, no item persistence,
global chat and safe rooms) and combat 2.0 (weapons, armour, healing food,
flee, PvP, aggressive mobiles and levels) are in place. The world now has 24 connected rooms across three zones, a login gate, shops,
quests and guilds. The LLM bridge supports prime-router as a provider or a corpus archive, with a
bounded memory window. The web shell has register/login and an agent handoff
panel, `/llms.txt` is generated from the game tables, and `docs/COMMANDS.md` is
generated and checked. More world content is additive.

## Provenance

The design descends from the `MUDBench` corpus in
[`R4-Laboratories/AI-Research`](https://github.com/R4-Laboratories/AI-Research)
at commit `0e8a4f5` (30 specifications under `MUDBench/`). What was adopted,
changed, or dropped is recorded in `docs/RECONCILIATION.md`; that document, not
the upstream corpus, is authoritative here.

## Layout

```
docs/           founding documents — reconciliation, hosting, safety model
prism/          the Prism admission app (prism MCP), not the world model
world/          the PrismPM project: LexLean model of the world and hosting
runtime/        the Node.js world server, telnet and WebSocket
```
