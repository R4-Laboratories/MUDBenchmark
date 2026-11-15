# world — the proved part

This is a PrismPM project: a closed LexLean model that compiles into generated
artifacts. It is not the server. It is the part of the server that must be true
no matter what the surrounding process does.

## Modules

| Module | Structure | Theorems | Status |
|---|---|---|---|
| `Session` | `Session {actor, room, phase}` | `admissible_decides` — admission holds exactly when the phase is connecting | verified |
| `Fanout` | `Event {room, kind}`, `Viewer {actor, room}` | `sees_decides` — a viewer is shown an event exactly when the rooms are equal | verified |
| `World` | `Exit {start, finish}`, `Actor {actor, room}` | `connects_decides`, `coLocated_decides` | verified |
| `Conservation` | `Ledger {before, after}` | `preserved_decides` — a count is preserved exactly when before equals after | verified |
| `Pulses` | `Pulse {period, remaining}`, recursive `minus` | `advance_at_zero` — a pulse at zero rearms to its period | verified |
| `Perception` | `Observer {role, room}`, `Notice {room, level}` | `perceives_decides` — an observer sees a notice exactly when co-located and cleared | verified |

Each theorem is proved by `simplify` over its own definitions plus `Nat.beq_eq`,
with `propext` as the only axiom. Nothing is `sorry`-ed and nothing is deferred.

`Fanout` is the load-bearing one. "A viewer sees an event exactly when they
share a room" is the formal statement of *no omniscience* in
`../docs/SAFETY-MODEL.md`; every safety construct that compares what an actor
knew against what was true depends on it.

## What this does not prove

- **Ordering across ticks.** There is no tick type here yet.
- **Capacity bounds.** A transfer is not bounded by a destination's free space,
  because the Nat arithmetic needed to say `a ≤ b` is not admitted in a semantic
  body — see the constraint below. `Conservation` is a preserved total, which is
  the property that matters most, but it is not the bound.
- **Anything about the transport.** Sockets are host code; see
  `../docs/HOSTING.md`.

## Constraints of the closed lexicon

Learned the hard way, recorded so the next session does not repeat it.

1. **A source file must end in exactly one LF.** Two fails, none fails.
2. **Field names and definition names are free**, but `\title{...}` must be a
   phrase from the lexicon. `prism.arch@1.0.0` offers exactly two:
   `Text application model` and `Bounded byte buffer`. Every module here uses the
   first, which is honest about the constraint and wrong about the module.
   A `prism.mud` lexicon package is the fix, and it cannot be tested through the
   LexLean MCP — that gateway exposes only the `spec` and `prism-app` profiles.
3. **Nat arithmetic is math-channel only.** `sub`, `ble`, `le` and `≤` all exist
   in `lexlean.std.nat`, and none is admitted in a semantic `body`:
   - `≤` fails to parse: *expected an operator*
   - `-` fails the same way
   - `ble` and `Nat.ble` report *forward or missing function*
   Usable operators are `=?`, `=`, `&&`, `/\`, `<->`. Plan properties accordingly:
   equality and conjunction, not comparison.
4. **`lexicon_read` does not accept bare entry ids**; search returns the full
   entry including its denotation.

## Building

The project a model needs before it can compile:

- `lexlean.lock` — via `lexlean lock`
- `prismpm.lock` — via `prismpm lock`

Both are generated, not hand-written. Build inside the pinned SDK image:

```sh
docker run --rm -v "$PWD:/w" -w /w/world \
  ghcr.io/uor-foundation/prismpm-sdk:0.4.0 \
  prismpm --project . verify
```

The candidate image previously pinned from `karst-zero` (`…-candidate@sha256:60226bc…`)
reports `lexlean 0.3.0` / language `1.0` and will not accept this project's
`language = "1.2"`.

## Assurance levels

`prism-code` grades a holo from P0 to P2, and the grade comes from **signed
statements**, not from how much Lean ran:

| Level | Needs | Where it comes from |
|---|---|---|
| P0 | a holo that assembles and replays | the build alone |
| P1 | a provenance statement, signature verified | release signing |
| P2 | a proof statement, signature verified | release signing |

`check.mjs` is explicit: *"Without `signer` a signed holo is P0, because an
unchecked signature is no evidence."* So adding theorems does **not** raise the
level, and `prism-code run` refuses a P0 holo by default.

There is no proof-statement schema in `prism-code@0.5.0` and no generator in the
SDK image, so P2 here means the `prismpm sign` / `promote` path keyed to GitHub
OIDC — a release pipeline, not a modelling task.

For development, `policy.dev.json` states the posture instead of passing a flag:

```sh
prism-code run MUDBench.holo --policy policy.dev.json
# check: passed, P0, policy mudbench-dev
```

That is an honest declaration — "this is P0 and we accept it here" — rather than
`--allow-unverified`, which says the same thing less clearly.
