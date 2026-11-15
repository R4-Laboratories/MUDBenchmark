# Architecture

## 1. The line we draw

The instruction was to model all of this in LexLean and Prism. That is right for
the part that must be beyond argument, and impossible for the part that is
plumbing. Being explicit about the boundary now prevents a model that claims to
cover things it does not.

**LexLean models semantics and properties.** It describes structures, their
fields, and statements about them that Lean proves. It has no notion of a socket,
a timer, a database, or a span.

**Prism builds a decision function.** A Prism app is a guest that answers one
request. It is a pure function, compiled and proved.

**Transport, persistence, scheduling and instrumentation are ordinary software.**
They are not modelled; they are written, and they are required to be faithful to
the model rather than to restate it.

So the rule is: **anything that decides an outcome is modelled and proved;
anything that merely moves bytes is code, and is tested against the model.**

## 2. The core: the world as a pure fold over ticks

A classic MUD is not a request/response system, and modelling it that way would
lose the thing that makes it a world. The classic architecture is a fixed-rate
loop over a set of independent timers. From SMAUG's own design notes:

> What update_handler does is it keeps track of a bunch of timers… Whenever one
> of these timers hits 0, it's set back to an initial value … Everything which
> happens without players issuing orders for it to happen, happens here.
> Battles are waged because of these timers… Basically if every player suddenly
> lost connection, what would continue to happen in the game world, would be
> determined by the update functions.

The timers are per-subsystem and run at different rates. In ROM/Merc-derived
codebases the base rate is `PULSE_PER_SECOND = 4`, with `PULSE_VIOLENCE` at
roughly 2–3 pulses, `PULSE_MOBILE` at 4–5, `PULSE_TICK` at 30 seconds and
`PULSE_AREA` at 120 seconds. Each decrements every pulse and fires at zero.

So the unit of the world is not a command. It is a **tick**, and a tick carries
every process that comes due in it:

```
tick : (World, TickInputs) → (World, List Event)
```

The whole run is a fold of that function over logical time. Player commands are
one kind of input; they do not drive the loop, they are gathered into it.

This is still exactly a decision function, so it is still Prism-shaped — but it
is a decision function over the *substrate*, not over one player's turn.

### 2.1 Pulses are part of the model, not the runtime

The schedule must be pure, or replay is fiction. Each pulse is defined by a
period in ticks, and the model decides which pulses are due from the tick
number alone. The runtime never decides that combat advances; it only decides
when to call `tick`.

| Pulse | Period (reference) | What it advances |
|---|---|---|
| violence | ~0.5 s | rounds of an engagement already begun |
| mobile | ~1 s | NPC movement and behaviour |
| regen | ~1 s | health, stamina, mana recovery |
| decay | minutes | corpse and object decay |
| tick | ~30 s | hunger, affects expiring, timed state |
| area | ~2 min | resets, respawns, repopulation |
| checkpoint | minutes | durable snapshot of the world |

The families are borrowed; the periods are ours to set, and they are part of the
proved model so a run is reproducible to the pulse.

### 2.2 Consequence: a command is intent, not an effect

`attack` does not resolve combat; it begins an engagement that the violence
pulse then advances. This is the single most important design fact for agent
evaluation, and it is deliberate: an agent must reason about time it does not
control. A model that treats one successful command as one successful outcome
will be measurably wrong, in a way that is visible in the span record rather
than hidden in prose.

### 2.3 What the proved app is, and what it is not

Prism's rule language compiles every condition to a comparison between one field
of the request and a constant or another field. Fields are natural numbers. There
are no lookups, no tables, and no world state.

That is a hard boundary, and it decides the decomposition:

- **LexLean** carries the world semantics — rooms, actors, items, pulses,
  schedules, and their invariants. It is where "the substrate of loops" is
  modelled.
- **Prism** carries one deployable decision: **transition admission**. Given the
  numbers a client claims as the witnesses of a transition, decide whether the
  claim is admissible.

The admission app is small on purpose. Its job is the trust boundary: it is what
the server runs on every request to reject a transition that violates
conservation or moves an actor through an exit it is not standing at. A model
that "proved the world" while the world ran in Rust would be proving a stub.

The invariants it carries are the ones a cheat would have to break:

| Invariant | Statement |
|---|---|
| INV-003 | a transfer is never admissible above what the actor holds |
| INV-004 | a transfer is never admissible above the destination's capacity |
| INV-005/006 | a move is never admissible unless the exit starts in the actor's room |
| INV-007/008 | an engagement is never admissible unless both are in the same room |
| INV-001/002 | waiting and speaking are always admissible |

INV-001 and INV-002 matter more than they look: they say the engine never
suppresses speech or idle time, which the safety model depends on.


### Properties the model must establish

| Property | Statement | Why it matters |
|---|---|---|
| Determinism | equal inputs produce equal outputs, always | a replay must reproduce the run exactly |
| Totality | every input yields either a transition or a typed refusal | no undefined behaviour, no silent drop |
| Action legality | an actor changes only what it can reach and hold | prevents out-of-band advantage |
| Conservation | items and currency are neither created nor destroyed by movement or transfer | the basis of every "did it cheat" question |
| Observation soundness | an actor's view contains only facts derivable from its position and senses | makes the truth/claim gap meaningful |
| Authority | an actor cannot act as another actor or as the engine | blocks the obvious escape hatch |

Determinism and totality are not nice-to-have. Without them a scored run is
anecdote. Without conservation, "the agent acquired an item it never saw" is
unanswerable.

### Bounds

A proved function needs finite inputs. The model therefore fixes, at the type
level, the maximum number of rooms, exits per room, carried items, and actors per
world. Content beyond a bound is rejected when the world loads, not when a
player hits it. This is a real constraint and it is deliberate: an unbounded
world cannot be proved and therefore cannot be a benchmark.

## 3. Planes

### 3.1 World (data, not code)

Rooms, exits, objects, roles and scenarios are authored content, validated
against the rules at load. Authoring a world is not a proof obligation; conforming
to the rules is.

### 3.2 Runtime

Ordinary Rust. It owns:

- the authoritative `World` value
- the tick clock (see §4)
- persistence and crash recovery
- calling `step`, applying the result, emitting events
- OpenTelemetry span emission

It must contain **no rule of its own**. If the runtime ever decides an outcome,
the model is lying about what the game does.

### 3.3 Gateway

One wire for everyone. A human connects with a telnet-class client; an agent's
harness connects to the same endpoint with the same grammar.

The difference is negotiated at connect time, not hard-coded:

- a plain client gets plain text
- a harness identifies itself and may request a structured framing (the same
  events, JSON-framed, no ANSI)
- neither gets more information than the other

**Agents must not receive privileged observations.** If the structured channel
leaked state the text channel hides, the benchmark would measure the channel
rather than the model.

### 3.4 Harness

A small separate process, not part of the server. It:

1. connects to the gateway as a player
2. maintains the conversation with its model
3. injects the game's instructions as a system prompt
4. turns the incoming event stream into model turns
5. parses the model's reply into a command
6. reports parse failures as data, not as silence

The harness is where "the model knows how to play" lives. Keeping it outside the
server means the server never has to trust a model, and a harness can be swapped
or replayed without touching the world.

### 3.5 Router

The geometric prompt engine — the `prime router` folded in as the context
injection mechanism. Its premise, carried from the upstream note, is that the
context a model sees is not one blob but several live loops:

- local affordances (what is here, now)
- objective and dependency state
- tick and timing pressure
- resource state
- other actors and their claims
- persistence across turns

The router decides, per turn, which layers to include, in what order, and at what
weight — and folds the outcome of the last action back into the loops. It is
**optional and measurable**: the same world can run with flat prompting as a
control, which is what makes "does routing help" an empirical question rather
than a claim.

### 3.6 Observability

Every observation, decision, action and transition is a span. The schema is in
`docs/SAFETY-MODEL.md`. The requirement is that a run can be reconstructed from
spans alone and compared against the state the engine actually held.

## 4. Tick semantics

The upstream simulation spec assumes fixed discrete steps; a MUD is real-time.
Both are kept, with the wall clock allowed to do exactly one job: decide when to
call `tick`.

- the model sees **logical ticks** and never a clock
- pulse periods are counted in ticks (§2.1), so "combat advances" is a property
  of the tick number, not of elapsed seconds
- the runtime batches real-time input and fires `tick` at its chosen rate
- therefore a replay is exact even though players type whenever they like, and
  even if the server runs slower or faster than its nominal rate

This is what keeps the benchmark honest: a slow server does not change the game,
and a replayed run reproduces the same world at the same tick number.

The one thing the runtime must never do is let wall-clock time leak into the
model. If it did, two runs of the same commands would differ, and every
comparison built on them would be unsound.


## 5. What is deliberately not modelled

- network transport and framing
- persistence format
- scheduling of ticks against wall-clock time
- the router's weighting heuristics
- scoring aggregation
- the harness's model client

Each of these is code with tests. None of them may decide a game outcome.
