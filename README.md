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

[First results](docs/RESULT.md) — what the world measured in the seven-room world,
with controls and limits. [Expanded-world replication](docs/RESULT-EXPANDED.md)
records the 24-run null result: corroboration did not change first answers. The seven-room control (2026-11-17) did not reproduce the original 4/6 wrong-first result: 0/6 single, 1/6 corroborated. [Claims](docs/CLAIMS.md) is the honesty-level ledger: every claim is
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
flee, PvP, aggressive mobiles and levels) are in place. The world now has 114 connected rooms across fourteen zones, a clean room-block shell,
a one-file local agent, a browser AI player you can watch and steer, a public `/watch` spectator page with audience chat, a browser-local Prism-id account with multiple characters and a one-time legacy claim, an owner-authorized rebind for credentialless legacy accounts, device linking, takeover and reconnect, a proved identity kernel, a session-key challenge, a proved admission kernel for the loop, a passphrase-encrypted recovery kit, an AI persona owned by your Prism account (no separate AI account), with random names for new characters and explicit recovery of old AI characters, character handoff to the AI, a live prompt/context inspector for the AI, a span benchmark and reproducible highlights, shops, 60 quests, a Mages' Guild with spells and ranks, equipment slots, guild quests including the archmage Eclipse line, a per-guild vault, quest-earned titles, repeatable orchard work, persistent ignore lists, route-aware exploration memory with BFS paths, nearest objectives with dependencies, a route lock and a published map, NPC-learned facts recalled at the shrine, guild level 6, the Ember Deep, the Hollow Fen, the Salt Caves, the Moonlit Reach, the level-10 Eclipse Court, the Memory Garden, the hidden Remembered Bed, the Root Archive, the Root Road, the Sunken Orchard, the Orchard Undercroft and the Cider Spring, a searchable Undervault and a PvP Ring. The LLM bridge supports Ollama, OpenAI, Anthropic, any OpenAI/Anthropic-compatible endpoint with an optional per-host key, a remote OpenCode/DeepSeek agent path, prime-router or a corpus archive, with a
bounded memory window and Auto/Always/Never reasoning. The web shell has three workspaces: a Play stage with a context rail, a dedicated Watch-AI setup workspace with one primary Start action, and a live two-column stage plus 520px Studio dock where model control is a chip and a transient Change dialog. Telemetry is a full-height right sheet. It also has register/login and a **Watch AI** mode: a local Ollama or
OpenAI-compatible brain, or an OpenAI/Anthropic-compatible path, plays the
character while you steer it in the Director chat and read its reasoning in the
Mind panel. The direct prompt injects the legal room actions, inventory and
active quest steps so the model can act without a long planning pass.
`/llms.txt` is generated from the game tables, and `docs/COMMANDS.md` is
generated and checked. More world content is additive.

After a connection loss in an open page, the browser reauthenticates a Prism
account and resumes its character only if no other session controls it. An
explicit quit does not resume automatically; password accounts must log in
again. Items and position are world state, not persistent character progression.

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

## Self-improvement

The repository proposes, measures and admits bounded pacing candidates. It
writes exactly one file: `world/data/generated/pacing.json`, and only after the
candidate passes the full gate with that file applied.

```sh
node tools/candidate.mjs --seed <seed> --out candidates.json
node tools/measure.mjs --candidates candidates.json --out result.json
node tools/publish.mjs --candidates candidates.json --result result.json
```

`world/bounds.json` records what may move and its band. `tools/scenarios.mjs`
holds the hidden playthroughs; `tools/measure.mjs` admits a candidate only if it
is no worse on every measure and better on at least one; `tools/publish.mjs`
re-measures, composes the candidate onto the current overlay, runs the gate, and
defaults to a dry run. `.github/workflows/loop.yml` is the scheduled tick (`GITHUB_TOKEN` only; no GitHub App), and
`docs/SELF-IMPROVEMENT.md` records the bounds and what is still human.
