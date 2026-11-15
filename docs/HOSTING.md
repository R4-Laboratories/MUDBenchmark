# Hosting

## 1. How a Prism game is actually built (evidence from `afflom/karst-zero`)

Karst is the closest working example: a playable tactical wargame, live at
<https://afflom.github.io/karst-zero/>, described as "authored and verified on
UOR Template, PrismPM v0.4, and LexLean v0.4". The build chain, in file order:

| Step | Artifact |
|---|---|
| 1 | `src/*.lex.tex` — one LexLean module per subsystem (`CombatEngine`, `SpatialWorld`, `AnimationEngine`, `NemesisChit`, …), each carrying claim IDs `KZ-01`…`KZ-17` |
| 2 | `lexlean.toml` + `lexlean.lock` — the pinned model project |
| 3 | `prismpm.toml` + `prismpm.lock` — the pinned build (`build_root = ".prism"`, `max_holo_bytes = 16 MiB`, `max_entities = 100000`) |
| 4 | `.prism/build/<sha256>/…` — the compiled model, plus OPM (`.opl`) and UML (`.puml`) views |
| 5 | `src/lib/karstHoloModel.ts` — a "Client-Side `.holo` v4 Product Model & Core-Wasm Execution Bridge" built on `prism-code` and `prism-code/canonical` |
| 6 | `crates/karst-kernel` — `#![no_std]`, `#![forbid(unsafe_code)]` Rust implementing the same semantics |
| 7 | `vite build` → static site → GitHub Pages |

Three details matter more than the rest:

- The **model is the system of record**. The TypeScript is a consumer of the
  compiled model, not a parallel implementation of the rules.
- The client executes the **holo** — model, proof and WebAssembly guest in one
  content-addressed archive — in the browser.
- The hosting story is **static**. `vite.config.ts` sets `base: './'` and shims
  `node:http`, `node:fs/promises` and friends to empty modules so that
  `prism-code` can run in a page. There is no server.

## 2. The gap this project has to cross

Karst is a solo/co-op campaign. Everything runs in one browser tab, and there is
no shared mutable state, no tick owned by anyone, and no second participant.

**A hosted world cannot be built from that pattern alone.** A holo is a pure
function; two players each running it hold two private worlds. The moment two
people and an agent occupy one room, something must decide what the room
contains, and that something must be a single authority ordering ticks.

So the hosting model is:

- **The server owns the world.** It holds `World`, sequences ticks, and decides
  every outcome.
- **The holo is the rules artifact.** The server runs the same verified rules
  the clients can inspect. Two acceptable ways to do that: execute the holo's
  WASM guest in the server, or run `crates/*-kernel` and validate it against the
  model. The first is stronger — same bytes on both sides — and it is the
  default unless it proves too slow.
- **Clients are static, as in Karst.** A page loads the holo, verifies it, and
  speaks to the server over a socket. It renders what the server says and may
  predict locally.
- **Prediction divergence is data.** When a client's local run of the same rules
  disagrees with the server, that is an integrity signal worth recording, not a
  bug to hide.

### 2.1 What can be modelled, and what cannot

PrismPM compiles a closed `.lex.tex` graph into a Lean-checked snapshot, proof
evidence, `lean4-prod` named-root coverage, **a generated Cargo crate**, an
import-free Core-Wasm guest, a View, and the `.holo`. The generated crate is the
part that decides this question.

| Part of hosting | Modelled? |
|---|---|
| session lifecycle: join, leave, admission | yes — states and transitions |
| tick scheduling: which pulses are due at tick *n* | yes — a total function of *n* |
| event fan-out and observation scope — who is shown what | yes — this is the "no omniscience" guarantee |
| ordering: exactly one authoritative order per tick | yes — a property of the scheduler |
| sockets, TLS, backpressure, reconnection | no — transport |
| process supervision, persistence to disk | no — runtime |
| metrics and trace export | no — runtime |

So the server is **not a second implementation of the rules**. It is a thin
shell — a socket, a clock, a store — that calls generated, verified roots. That
is the same relationship Karst has between its model and `karst-kernel`, except
the kernel is generated instead of hand-mirrored.

What cannot happen: **the server cannot be a `.holo`.** A holo is an import-free
WASI guest and the sandbox has no listening socket. `wasmtime` ships in the SDK,
so a server *may* execute the guest for its rules, but the listener is always
host code.

### 2.2 Where it runs

Three parts, and one of them cannot be Pages.

| Piece | Host | Why |
|---|---|---|
| Static client | GitHub Pages | it is a page; Pages is sufficient |
| World server | `wick` (192.168.103.59) | needs a process, a socket and durable state |
| Build | `wick`, in the PrismPM image | 32 cores, 178 GB free, Docker; this Mac has 70 GB |

Reachability:

- same LAN — `ws://192.168.103.59:<port>`
- anywhere else — a tunnel (Cloudflare Tunnel or Tailscale) terminating TLS, so
  the Pages client can use `wss://`
- Pages cannot proxy, poll or hold a socket. It serves files, nothing else.

Pinned build image, from `prismpm.lock`:

```
ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:60226bc791d4c0e5613402a6be7e63f4963d3faf7f327befcf56fc0e41d0ce21
```

It is multi-arch (`linux/amd64`, `linux/arm64`) and carries `prismpm`,
`wasmtime`, `otelcol-contrib` and `prismpm-conformance` — the last three matter:
the guest can be executed host-side, and OpenTelemetry export has a collector in
the same image.

Caveat to keep in view: PrismPM publishes v0.4.0 as an SDK *candidate*, and its
README states plainly that it "is not an accepted production-system release". We
depend on a candidate, so the digest is pinned and we expect to move.

### 2.3 PrismPM models deployment, not just the build

The first version of this document said hosting could not be modelled at all.
That was wrong, and the tool was already ahead of the claim. `prismpm` ships a
deployment surface:

```
prismpm plan | deploy | run | status | backup | restore | rollback | destroy
```

with adapters published per target — `adapter-compose`, `adapter-github-pages`
and `adapter-kubernetes` — and the words that go with a real deployment:
"Produce a deterministic target-state-bound deployment plan", "Deploy an
immutable release through its modeled target adapter", "Capture a complete
logical snapshot from a ready modeled deployment", "Restore and prove a pending
backup in a distinct clean target".

So the correct statement is narrower than "not modelled" and stronger than
"modelled":

- the **listener is still a process in a container** — WASI still has no socket
- but the **deployment of that container is modelled**: target, plan, identity,
  backup, restore and rollback are PrismPM concepts, not ad-hoc scripts
- and the static client is the `adapter-github-pages` path, so Pages is a
  modelled target rather than a manual upload

Practical consequence: `wick` should be described as a modeled Compose target,
not a box we scp into. A release is immutable and identified, and rolling back
is a PrismPM command rather than a manual revert.

## 3. Consequences

1. **PrismPM becomes a build dependency.** `prismpm` is not installed on this
   machine. The template's gate runs it inside the digest-pinned SDK image
   (`prismpm.lock`). That image is a prerequisite before any model compiles.
2. **The world state is bounded by the build.** `max_entities = 100000` is a
   project limit, not a suggestion. A world that exceeds it fails to build.
3. **Two Prism surfaces exist and they are not interchangeable.**
   - `prismpm`: many `.lex.tex` modules compiled into a holo — how Karst was made.
   - the `prism` MCP six-question app: one decision function, proved — what
     `prism/` currently holds (transition admission).

   The world belongs in the first. The second is a small trust-boundary oracle
   that can stay as its own module.
4. **Telnet and WebSocket are the same authority.** Both transports deliver
   intents to the same server and receive the same events. Neither gets
   privileged truth.

## 4. Open decision

Transport and authority are settled. What is not settled is how much of the
world runs in the browser:

- **Thin client** — the server sends the room description, the client renders it.
  Simple, and the only option for a text MUD's first milestone.
- **Verified client** — the client also loads the holo and replays ticks,
  flagging divergence. More work, and it is what makes a run auditable by the
  players themselves.
