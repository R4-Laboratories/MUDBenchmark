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
