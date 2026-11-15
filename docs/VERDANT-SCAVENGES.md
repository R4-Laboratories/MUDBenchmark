# What to take from Verdant Engine

[Verdant Engine](https://github.com/afflom/verdant-engine) is a real 3D engine:
Rust crates, a WebAssembly bridge, a scene packer, a browser studio, and a
verification discipline that runs from a Lean kernel to a capability ledger. It
builds; its core library tests pass; its conformance suite covers sixteen
engine capabilities with typed refusals.

It is also **not a multiplayer game framework**. There is no networking, no
server, no transport, no replication, no scripting layer, and no persistence of
game rules. `WorldSnapshot` saves a 3D scene, not a player. The engine steps a
local simulation and draws it.

That distinction decides the scavenge. We should not import the engine into a
text MUD. We should take the parts that solve problems we already have, and
leave the parts that only matter when there is a 3D client.

## Inventory

| Part | What it is | Fit for a text MUD | Verdict |
| --- | --- | --- | --- |
| `runtime::WorldSnapshot` | `VDNT` magic + length + payload + SHA-256 trailer | checkpoint integrity and versioning | **port the pattern now** |
| `runtime::FrameBudgetProfiler` | per-frame samples, mean/max, over-budget count | tick cost and load telemetry | **port the pattern now** |
| Typed refusals (`error.rs`, R5) | every public failure typed, modeled, negative-tested | refused commands are benchmark data | **port the discipline now** |
| `model/*.toml` + `crates/model` | capability register, claim ledger, honesty levels | claims about the game and dataset | **port the method after Phase F** |
| `identity/prism-id.mjs` | no-sign-in Prism ids, signed sessions, recovery | web/agent identity and run provenance | **vendor later, after Phase G** |
| `site/llms.txt` | machine-readable doc index for agents | an agent contract for the MUD | **copy the pattern with Phase F** |
| `ecs` | 3D scene graph, BVH, frustum/ray queries | none without continuous space | leave |
| `streaming` / UORC | progressive 3D scene LOD, SHA-256 chain | 3D asset streaming only | defer until a 3D client |
| `physics`, `collision` | rigid bodies, GJK, capsules | none in a room-graph MUD | leave |
| `navmesh` | terrain polygons, A* corridors | room-graph A* is a 40-line JS function | borrow the idea only |
| `render`, `geometry`, `animation`, `audio`, `gltf_io` | 3D presentation and export | only a future 3D client | defer |
| `verdant-wasm` | fixed arena simulation over a C ABI | not a general scene API | custom build only |
| `verdant-cli` | scene packer and validators | 3D assets only | defer |
| `frame/`, `bootstrap/`, `site/` | Prism app shell and site build | the identity panel is the useful part | borrow identity only |
| `templates/browser-3d-starter` | one fixed 3D game in Rust | no | leave |

## What we can use now

### 1. A checkpoint envelope, from `VDNT`

`WorldSnapshot::encode` writes `VDNT\x01`, a little-endian payload length, the
payload, and a 32-byte SHA-256 of everything before it. `decode` verifies the
magic, the framing, and the digest **before** it parses anything. Conformance
`VE-09` proves a bit-identical round trip and refusal of truncated or tampered
bytes.

Our `saveState` writes raw JSON atomically. That is safe against a half-written
file, but it has no version and no integrity check, and a checkpoint written by
an older world is indistinguishable from a corrupt one until `upgradeState`
does its best. We already have `digestState` for semantic comparisons, but it is
not in the checkpoint.

Proposed `MUDS` envelope:

```
magic "MUDS" (4) | version (1) | payload length u32 LE (4) | JSON payload | SHA-256 (32)
```

- `encode(state)` / `decode(bytes)` in a small `runtime/checkpoint.mjs`.
- `loadState` accepts the envelope, falls back to legacy JSON once, upgrades,
  and rewrites in the new format.
- The gate refuses a truncated frame, a flipped byte, a wrong version, and a
  legacy save that upgrades correctly.
- The tick span already carries `state.hash`; the envelope carries the byte
  digest, so corruption and semantic change stay distinct.

This is the cheapest hardening we can take from the repo, and it addresses the
class of failure that rolled `v0.4.0` back twice.

### 2. A tick profiler, from `FrameBudgetProfiler`

Verdant records every frame's microseconds, counts the ones over budget, and
exposes mean and max against a refresh-derived KPI (`16,666 us` at 60 Hz). Its
`EngineConfig` validates tick rate and budget before the loop starts.

Our `world.tick` span records the tick, the intents, the event count and the
state hash, but not how long the tick took. `/health` reports actors, NPCs,
phase and weather, but not load. As shops, mobiles and weather accumulate, we
have no number for the cost of a tick.

Proposed:

- A small ring buffer in the server, sampled around `step`.
- `duration_ms`, `actors`, `npcs`, `objects`, `events` on the existing
  `world.tick` span, every tick or every Nth tick.
- `/health` gains `tick_ms_p50`, `tick_ms_p99`, `over_budget`.
- A config constant for the budget (the tick is 250 ms; a 5 ms step is a
  healthy ceiling with room for jitter), reported, not used as a flaky
  wall-clock gate on CI.

Do not port `WorkerJobGraph`. JavaScript runs one tick on one thread, and our
systems have a deliberate order (weather, mobiles, violence, area reset). A DAG
scheduler would add nondeterminism for no gain. Revisit it only if zones are
sharded across workers.

### 3. Typed refusals, from `error.rs` and R5

Verdant's rule R5 is blunt: every public failure is typed, modeled, documented,
and covered by a negative test. Its conformance suite has a refusal for every
fallible boundary.

Our server refuses commands with text, and the dataset never sees them. An
agent that tries to take a fixed anvil, open a wall, buy without money or attack
a dead guard leaves a line in a transcript and no structured row. For a
benchmark about how agents play, **refusals are a behaviour class**, not noise.

Proposed:

- Every rejected command emits a `world.refusal` span with `verb`, `reason`,
  `object`/`target`, `room.id`, and `world.tick`.
- Refusal reasons come from a small data table (`world/data/refusals.json`) so
  the wording and the reason code cannot drift.
- The gate requires every verb to have at least one positive path and one
  refusal path exercised.
- The dataset gains `event: "refusal"` rows.

This is the most valuable single import for the benchmark, because it makes
confusion, invalid attempts and boundary probing measurable without reading
prose.

### 4. An agent contract, from `site/llms.txt`

Verdant ships `site/llms.txt`: a short, machine-readable index of what the
engine is, where the docs are, and what each guide covers. It is written for a
model that has just landed on the project.

Our agents currently have to be told the commands, or read the web page. That
is a needless source of variance between runs.

Proposed: serve `/llms.txt` generated from `world/data/verbs.json` and
`world/data/world.json`:

- how to connect (telnet and WebSocket);
- how login and keys work;
- every verb, alias and argument shape;
- the rooms, exits and the two contradictory inscriptions;
- the span/dataset schema and where the data lands.

Generated, not handwritten, so a new verb cannot be missing from it. A gate
checks that every verb and every room appears. This is the cheapest way to make
LLM runs comparable, and it belongs with Phase F (communication) because the
social commands are what agents need documented.

## What we can use later

### 5. A claims ledger, from `model/` and `crates/fidelity`

Verdant separates three honesty levels for every claim:

| Level | Meaning |
| --- | --- |
| `some-true` | reproduced from a named authority, not established here |
| `build` | constructed and validated against a gate |
| `open` | measured and reported, **never asserted** |

`model/ids.toml` is the capability register, `model/ledger.toml` the claim
ledger, `model/authorities.toml` what is cited rather than proved, and
`crates/model` cross-checks them. `CONFORMANCE.md` is generated, so an ID cannot
exist in docs without a register row.

Our `world/ratchet.json` counts rule debt and unused rules, but the benchmark
claims live in prose and chat. The corroboration result — 9/14 wrong-first with
a false corroborator versus 1/13 with a true one — is exactly an `open` claim
that should carry its query, sample size and seed.

Proposed `claims/`:

- `ids.toml` for capabilities (world tick, perception, combat, trade, ...).
- `ledger.toml` for empirical claims, each `open` with a query file,
  `sample_size`, `seed`, or `build` with a gate command.
- `authorities.toml` for external facts we cite (WebSocket RFC, telnet, ...).
- `tools/claims.mjs` validates, regenerates `CLAIMS.md`, and fails an `open`
  claim without evidence or a `build` claim without a gate.

This is the method, not the Rust code. It is the right way to keep "the game is
the instrument; benchmarks are observation" honest as the claims accumulate.

### 6. Prism ids, from `identity/prism-id.mjs`

This is the one piece of Verdant that is JavaScript, self-contained, and solves
a problem we have. I ran it in Node:

- `createPrism()` made a `sha256:` id and a device.
- `signAction(id, "prism/session/1", ...)` produced a session envelope.
- `verifyAction(..., { audience: "https://play.r4labs.org" })` returned
  `allowed: true`.
- The same envelope with `audience: "https://other.example"` returned
  `allowed: false` with `audience, replay or time window`.

The module is 174 KB, generated from `afflom/stitch@68a9222`, has no imports,
and is MIT OR Apache-2.0. It gives device-bound keys, signed sessions, recovery
kits, device revocation, and post-quantum options through WebCrypto.

Fit: an optional WebSocket login for humans and agents. The client sends the
session envelope; the server verifies it and maps the `sha256:` account to a
MUD identity. Telnet keeps the existing key/token path. The benchmark gains a
stable subject: a run belongs to an id, not a typed name.

Risks: the relay (`ntfy.sh`) is how removals travel; verification works with
`hear: false`, but then a revoked device keeps its session until expiry, so
sessions should be short. The file is generated and should be vendored with its
`stitch.lock` and attribution, not edited.

This is a Phase G-adjacent project (identity and persistence), not a Phase F
detour.

### 7. A 3D client, if we ever want one

The engine builds, but its WebAssembly bridge is a fixed arena simulation
(physics, pavilion, terrain, navmesh), not a general scene API. A 3D view of
MUDBench would need a custom build of `verdant-core`, a room-graph-to-scene
mapping, and the same authoritative server behind it. The boundary should be:

- the MUD server stays authoritative and text-first;
- a 3D client renders rooms, objects and mobiles from the same protocol;
- Verdant supplies the renderer, physics, glTF export and UORC asset streaming;
- no gameplay rule moves into the client.

That is a separate project, not an import. Until then, the 3D crates are dead
weight in a Node repository.

## What not to take, and why

- **ECS / BVH / frustum / raycast.** Our world is a reducer over arrays with
  room-graph topology. A scene graph with transforms would complicate
  serialization, replay and the proof boundary without adding a single command.
- **Physics, collision, capsules, splines.** There is no continuous space.
- **NavMesh.** Room-graph A* is a small function; the Rust module is terrain
  geometry. Borrow the admissible-corridor idea if mobiles ever pursue.
- **Render, geometry, animation, audio, glTF.** Only a 3D client needs them.
- **Tensor kernels and `prism_kernel.rs`.** Exact 3D math, 11.6k generated
  lines. Our mechanizer already proves the pulse arithmetic; we do not need a
  second kernel.
- **WorkerJobGraph.** One JS thread, deterministic system order. Profiler yes,
  scheduler no.
- **`verdant-wasm` as a dependency.** Fixed arena, C ABI, 3D. A future client
  can build its own.
- **The full Prism frame and site build.** Tied to holo verification and their
  publishing pipeline. The identity panel is the only part worth borrowing.
- **The Rust model/fidelity/conformance crates.** Build-time tools bound to
  their layout and TOML. Port the honesty levels and the negative-test rule,
  not the binaries.

## Plan

| Step | Work | Effort | Acceptance |
| --- | --- | --- | --- |
| **S0** | `MUDS` checkpoint envelope, legacy fallback, gate | 0.5 d | truncated / flipped / wrong-version refused; old JSON upgrades; deploy resumes |
| **S1** | tick profiler and `world.tick` duration | 0.5 d | p50/p99 in `/health`; spans carry duration; 10k-tick synthetic run reports |
| **S2** | refusal spans and a refusal table | 1 d | every verb has a positive and a refusal test; dataset has `refusal` rows |
| **S3** | generated `/llms.txt` | 0.5 d | every verb and room present; a fresh agent can connect and act from it |
| **S4** | claims ledger and `CLAIMS.md` | 1–2 d | an `open` claim without query/sample/seed fails; a `build` claim without a gate fails |
| **S5** | Prism id login for WebSocket | 2–4 d | signed session accepted; wrong audience/expiry/tamper refused; telnet unchanged |
| **S6** | 3D client (separate project) | weeks | read-only view of one zone driven by the same commands |

Sequence against the current track:

- **Resume Phase F (communication) as planned.** It is the next gameplay
  feature and the natural home for S3.
- **S0 before the next release.** It is small and hardens the deploy path that
  already failed once.
- **S1 and S2 with the Phase F release.** Both add dataset columns that make
  the social commands measurable.
- **S3 with Phase F.** Agents need the channel and tell grammar documented.
- **S4 after Phase F**, when there are more claims to ledger.
- **S5 after Phase G**, because identity and persistence belong together.
- **S6 only if a 3D client is actually wanted.**

## The deeper lesson: export a framework, don't import an engine

The most useful thing about Verdant is not any single module. It is the shape:

```
core (pure, deterministic)  +  runtime (host, workers, snapshots)
        +  cli (pack, verify, benchmark)  +  examples  +  starter template
        +  model ledger  +  conformance suite  +  llms.txt
```

That is a game SDK. We already have the pure core (`world.mjs`), the runtime
(`server.mjs`), the data (`world/`), the telemetry and the gate. If the goal is
to program games and frameworks directly, the move is to **extract `mudcore`**
from the MUD — the reducer, world loader, verb table, checkpoint and telemetry
contracts — and publish it with an example world and a starter template. Verdant
shows the packaging and verification discipline for doing that; it does not
supply the gameplay.

## Licensing and provenance

Verdant is MIT OR Apache-2.0. MUDBenchmark currently has no `LICENSE` or
`NOTICE` file. Before vendoring `identity/prism-id.mjs` or copying any code,
add the license, a `THIRD_PARTY.md` naming `afflom/verdant-engine` at
`fb2365c` and `afflom/stitch` at `68a9222`, and keep the generated file's
header intact.
