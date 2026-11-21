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
| cold first start | ~2 min | zeta tables + 23,466 wiki sentences; **no model download** |
| warm restart | 13.6 s | cache load only |
| initial scoped context | 192 ms | game memory ranked first |
| warm scoped context | 5–20 ms | scoped notes only |
| remember call | 10–20 ms | append note journal |
| resident memory | ~760 MB | no generation model |
| 100 scoped queries | p50 2ms, p95 3ms, max 4ms | 0 empty, 0 failures |
| journal | 797 notes | max 10k / 30d, compacted |

The original 9–14 s measurements came from per-turn indexing and rewriting the
349 MB cache. The full router is viable when the request path is split:

- `/api/context` only routes and retrieves; it never indexes or saves;
- `/api/remember` appends to a small `memory_notes.jsonl` journal;
- query scope is **identity only**, so the shared wiki cannot drown the game
  notes;
- the journal is replayed at startup, and a restart returns the same fact
  (`silver key` / `crypt chest`) in 10 ms.

## Decision

**Conditional go for a loopback memory sidecar, not for a per-turn voice
model.** The service is deployed as `mudbench-memory.service` on wick:

- patched prime-router with the split context/remember endpoints;
- `USE_OLLAMA=0`; no model download or generation;
- loopback only, never public;
- the game server proxies `r4-context` / `r4-remember` over the authenticated
  socket;
- the browser gets `R4 CONTEXT` plus the local `MEMORY` fallback.

The native prime/GCD concept index in `runtime/web/memory.mjs` remains the
instant fallback and still covers the game when the sidecar is down.

## Still required for the full router

1. Trim the startup cache to game-only data if the 349 MB cache becomes an
   operational burden.
2. Add retention/compaction for `memory_notes.jsonl`.
3. Prove p95 <150 ms over 100 mixed game queries on wick, not only the dev
   machine.
4. Keep a health indicator and a visible fallback state.
5. Do not use the router's voice endpoint for game commands.
