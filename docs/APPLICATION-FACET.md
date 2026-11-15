# The application facet

## What PrismPM actually requires

`prismpm --project . check` fails with `PP2001: facet closure is not exact` on a
project made of ordinary `structure{}/definition{}/theorem{}` modules. The reason
is only visible from a working project: `examples/Calculator` in the PrismPM
repository is a **single module written as `\semanticdata{...}`**, a canonical
JSON value of spec `lexlean/semantic-module/1`, and it declares the following.

| Declaration | Purpose |
|---|---|
| `Request` structure | the one input shape |
| protocol error inductive | typed refusals, one constructor per failure |
| `decodeRequest` | text → `Result Request ProtocolError` |
| `dispatchString` | request → response text, total over decoded input |
| `dispatchBytes` | bytes → bytes; the guest entry point |
| encode helpers | result and error → text |
| `…Application` structure | name, cargo fields, `libraryRoots`, `entryRoot`, `coreContract`, request/response maxima, `acceptanceVectors`, `view`, presentation target |
| `…Application` definition | the record value itself |
| theorems | e.g. `calculate_correct`, proved by `reflexivity` |

That set — not Contract/Application/Architecture/…/Main as separate modules — is
what "facet closure" means. Karst's seven modules are a rich project's way of
supplying the same closure across several files; the minimum is one module that
supplies it at all.

## Where our project stands

`world/src/{Session,Fanout,World,Conservation}.lex.tex` are four semantic modules.
They define structures, predicates and four proved theorems. They do **not**
declare a request, a decoder, a dispatcher, an application record, or acceptance
vectors. So:

- they are valid LexLean — `lexlean check` passes, Lean verifies them
- they are not a PrismPM application — hence `PP2001`

Nothing about them is wasted. They are the domain model the application facet
will reference.

## What the MUD's application facet has to say

The mapping is direct, and it resolves a question left open earlier — how text
gets in and out of a verified core.

| Calculator | MUD |
|---|---|
| `Request {operation, left, right}` | `Request {tick, actor, kind, room, origin, destination, held, amount, capacity}` |
| `ProtocolError` | `malformed`, `unknown-command`, `not-admissible` |
| `decodeRequest` | split the tab-separated command line, parse `kind` |
| `dispatchString` | decode, ask the domain predicates, encode the event line |
| `dispatchBytes` | UTF-8 in, UTF-8 out — the guest entry point |
| `acceptanceVectors` | one per outcome: admissible move, refused transfer, speak, wait |

A MUD's request is a command line and its response is one rendered event line.
That is byte-shaped in exactly the way the Calculator is, which is why the
facet fits rather than being forced.

## Consequence for the build

The next unit of work is one `semanticdata` module that supplies this closure and
imports the four domain modules. It should be authored through
`lexlean_draft_assemble` (which emits canonical `semanticdata` from data) rather
than by hand-writing JSON: the Calculator's blob is 46 KB for four operations,
and hand-editing it is a poor use of anyone's attention.

Only after that does `prismpm build` produce the generated Cargo crate and the
holo.

## Naming

The repository is `MUDBenchmark`. The PrismPM project and the app record should
be **`MUDBench`** — shorter, and it is the name that will appear in holos, cargo
metadata and the Pages URL.
