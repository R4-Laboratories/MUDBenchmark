# R4 memory spike — result

Date: 2026-11-19. Baseline: v0.65.1.

## What was tested

`casey-allard/prime-router` was cloned and run locally with a Python venv
(`numpy`, `psutil`, `opentelemetry`, `uor-addr`, `sympy`). The server was run
with `USE_OLLAMA=0` so it performed retrieval only, not generation. A
retrieval endpoint was added:

```http
POST /api/context
{ "identity": "prism:test:scout", "text": "...", "limit": 6 }
```

It routed the text, returned `top_resonance`, and indexed the text into the
identity-scoped corpus. The full server indexed **23,466 wiki sentences** and
used about **1.1 GB** of memory.

## Measurements

| Case | Latency | Result |
| --- | ---: | --- |
| initial context call | 388 ms | wiki sentences dominated; no game memory yet |
| second call, after indexing one game note | 9.0 s | game note ranked first, then wiki |
| third call | 14.5 s | cache/vocabulary work dominated |
| restart | ~2 min | 23k-sentence corpus load |

The per-turn indexing path (`index_single_sentence` → vocabulary rebuild →
`save_manifold_cache`) is the latency source. The shared wiki corpus also
competes with game memory: the first call returned generic geography, not the
Atrium.

## Decision

**No production deployment of the full router as-is.** It misses the plan's
acceptance gate by orders of magnitude (p95 <150 ms, bounded context, relevant
game concepts).

The useful part — text to integers, prime factors, shared-factor retrieval —
is implemented natively in `runtime/web/memory.mjs` as the **R4-lite concept
index**:

- each word maps to a stable prime;
- each note is a set of word primes;
- retrieval counts shared primes (the discrete GCD analogue), with a same-room
  and useful-command boost;
- the index is per character and fast enough for every turn;
- the existing room/command/stale/exits memory remains the outer structure.

This gives the game a working concept recall path now, without a 1.1 GB Python
service or a 9-second turn.

## Conditions to revisit the full router

1. Run a **game-only corpus** (no shared wiki) for character scope.
2. Index asynchronously, not on the request path.
3. Save the cache on a timer or checkpoint, not after every observation.
4. Prove p95 <150 ms over 100 game queries.
5. Prove the top-3 results are game concepts, not unrelated wiki sentences.
6. Keep a local-memory fallback and a visible health state.

Until then, the prime/GCD concept index in `memory.mjs` is the production
memory layer.
