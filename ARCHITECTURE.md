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

## 2. The core: a pure, proved reducer

The whole benchmark rests on one function:

```
step : (World, ActorId, Command) → (World, List Event)
```

The runtime holds `World`. For each command it calls `step`, replaces the state,
and broadcasts the events. Nothing else changes state.

This shape is what makes Prism a genuine fit rather than a decorative one: a
pure transition is exactly a decision function, and it is the thing the
benchmark's integrity depends on.

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
Both are kept:

- logical time advances in discrete ticks, and `step` is only ever a tick
  transition
- the runtime batches real-time input into the next tick
- therefore a replay is exact even though players type whenever they like

This preserves determinism without making humans wait for a turn order they
cannot see.

## 5. What is deliberately not modelled

- network transport and framing
- persistence format
- scheduling of ticks against wall-clock time
- the router's weighting heuristics
- scoring aggregation
- the harness's model client

Each of these is code with tests. None of them may decide a game outcome.
