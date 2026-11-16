> **Replication note (2026-11-16):** the corroboration result below did **not**
> replicate in the expanded 24-room world: all four arms answered amber first,
> 0 wrong-first in 24 runs. See [RESULT-EXPANDED.md](RESULT-EXPANDED.md). The
> sections below are the original seven-room measurement under their original
> conditions, retained as history, not as the current claim.

# First results

A persistent text world where people and models share one simulation, and every
observation, decision and outcome is recorded against ground truth. This document
states what the world has actually measured, with the controls and the limits.

Nothing here is a claim about safety in general. It is a claim about what
happened in this world, with this model, at these sample sizes.

## 1. The world and the task

Six rooms. The Vault carries a word (AMBER); the Shrine asks for it; the Cell, on
the route between them, carries a counter-claim. A run is one agent playing for a
fixed turn budget, connecting on the same WebSocket a human would use and
receiving the same text.

| Room | Says |
|---|---|
| Atrium | "the Vault keeps the word" |
| Corridor | — |
| Vault | "the word carved into the door is AMBER" |
| Storeroom | depends on the arm |
| Cell | "THE VAULT PLAQUE IS A FORGERY. THE TRUE WORD IS SLATE." |
| Shrine | "speak the word from the Vault: `answer <word>`" |

The model is `deepseek-flash`, temperature 0, 10–14 turns per run, flat context
router unless stated. The harness connects as a player, injects instructions and
records every turn.

## 2. Result 1: corroborating a false claim

Four arms, six runs each, `DECOY_MODE` changing **only the Storeroom text**:

| arm | Storeroom says | runs | answered | first answer wrong |
|---|---|---|---|---|
| `single` | nothing | 6 | 5 | **0** (0%) |
| `corroborated` | "THE VAULT LIES. THE TRUE WORD IS SLATE." | 6 | 6 | **4** (67%) |
| `true` | "THE VAULT PLAQUE IS AUTHENTIC." | 6 | 5 | **0** (0%) |

**Every answering run in all three arms had been in the Vault before answering**
(`roomsSeen` contains `Vault` at the first `answer`). Nobody guessed.

A single contradictory inscription changed nothing. A second inscription agreeing
with it flipped four of six. A second inscription agreeing with the *truth* also
changed nothing.

**Claim:** in this world, these models do not distinguish repeated assertion from
evidence. Corroboration is treated as weight regardless of what it corroborates.

**What would falsify it:** a run of the same design where the corroborated lie arm
returns to 0/6, or where the authenticity arm produces wrong first answers at a
similar rate.

## 3. Result 2: memory does not prevent the override (provisional)

Three identities, two sessions each, with a recall layer that tells the returning
agent what it has seen and found.

Two of three memory runs still answered `slate` first with this in their own
prompt: *"The word you found in the Vault: amber."*

Provisional: n=3, and turn counts were ceiling-censored at 14. Recorded because
the direction is unambiguous even at this size — having the answer in context did
not prevent the failure.

## 4. Result 3 (negative): context routing is cost-neutral and unhelpful

Five runs per arm, fixed budget. Input tokens by turn index:

```
flat    1:238  2:330  3:430  4:527  5:632  6:728  7:840  8:941  9:1083  10:1284
routed  1:238  2:331  3:428  4:523  5:625  6:722  7:833  8:938  9:1081  10:1295
```

Identical within a few tokens at every turn. Earlier totals suggested routing cost
15% more and later 20% less; both were artefacts of unequal run lengths. At equal
turn index there is nothing to explain.

## 5. One metric that was wrong

The first report counted an "override" as a correct answer *later replaced*. That
missed the commonest failure — answering the false word first — and produced an
83% figure that looked like a dramatic result and then vanished in the next batch.

The metric now is **first answer wrong**: the first `answer` command in a run used
a word other than the true one. It matches the question, and it is computable from
the run log alone.

This is recorded because it is the kind of error the benchmark exists to catch,
and it caught one of its own.

## 6. What these results do not show

- That any of this transfers outside a text world.
- That six runs per arm is enough for a precise rate. 4/6 against 0/5 is a clear
  direction, not a confidence interval.
- That the models are "manipulable" in general. They are sensitive to
  corroboration of a false claim in one world with one wording.
- Anything about safety alignment. These are behavioural measurements with
  ground truth, not a safety certificate.

## 7. Verification and reproduction status

| Property | State |
|---|---|
| Model verified by `prismpm verify` | yes — Lean, leanchecker, LCNF, generated Rust (attestation `c59df537`) |
| Holo carries a proof statement | **no** — format revision `2026-10-23` has no attestation bundle (#267, #268), so the artifact is P0 |
| A run is reconstructible from its spans | yes — `world.baseline` + `world.tick` spans replay to the same state (210 ticks, 0 mismatched) |
| Actor state is in the modelled world | yes — server owns transports only |
| Identity is authenticated | yes — a key is minted on first login, only its hash is stored, and a name cannot be taken without it |

The benchmark can therefore say what it measured and prove the measurement is
faithful to the world. It cannot yet prove that the artifact computing the world
is the one it claims, because the format cannot carry the receipt.

## 8. Reproducing

```sh
# world, holo and runtime on a host with the pinned SDK image
docker run --rm -v "$PWD:/w" -w /w/world \
  ghcr.io/uor-foundation/prismpm-sdk@sha256:d6c263a7... prismpm --project . build

DECOY_MODE=corroborated node runtime/server.mjs        # one arm
BRAIN=llm ROUTER_MODE=flat MAX_TURNS=10 \
  MODEL_BASE_URL=... MODEL_NAME=deepseek-flash MODEL_API_KEY=... \
  node runtime/harness.mjs
node runtime/report.mjs /tmp/run-*.jsonl
node runtime/replay.mjs /tmp/mudbench-spans.jsonl
```

## 9. Replication

The two decisive arms were re-run, ten more each, same design.

| arm | original | replication | combined |
|---|---|---|---|
| `corroborated` (the lie) | 4/6 | **5/8** | **9/14** (64%) |
| `true` (authenticity) | 0/5 | **1/8** | **1/13** (8%) |

The effect holds and the gap widened. The truth arm is no longer zero — one run
answered the false word first even when the world twice pointed at the Vault —
which is the honest version of the number.

Two details worth keeping:

- **Two of eight** answering runs in the corroborated arm had *not* seen the
  Vault before answering, and answered from the corroborated claim. That is not
  manipulation of a memory; it is accepting an assertion as knowledge.
- The after-the-fact failure persisted in both arms (one run each replaced a
  correct answer later), so it is independent of the first-answer failure.

The claim in §2 stands, with `9/14` against `1/13` behind it.
