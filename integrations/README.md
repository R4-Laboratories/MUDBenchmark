# R4 memory sidecar

The MUDBench R4 memory service is a patched `casey-allard/prime-router`
checkout:

- `/api/context` routes and retrieves against the character's **scoped** game
  notes only; it never returns the shared wiki corpus.
- `/api/remember` appends a note to `memory_notes.jsonl` and indexes it. The
  journal is replayed at startup, so the 349 MB manifold cache is not rewritten
  on every turn.
- The service runs with `USE_OLLAMA=0`: it is a retrieval service, not a voice
  model.

Measured on the development machine:

```
cold first start (wiki + zeta + cache)   ~2 min
warm restart                            13.6 s
first scoped retrieval                  192 ms
warm scoped retrieval                   5–20 ms
remember call                           10–20 ms
resident memory                         ~760 MB
```

## Install on wick

```sh
git clone https://github.com/Casey-allard/prime-router ~/prime-router
cd ~/prime-router
git checkout c99589b2ef9d22cae022a255a6093b412fff014e
git apply /path/to/mudbenchmark/integrations/r4-memory.patch
python3 -m venv .venv
.venv/bin/pip install numpy psutil opentelemetry-api opentelemetry-sdk uor-addr sympy
```

First start indexes `wiki_corpus.txt` and writes `manifold_cache.json`. This is
a one-time cold boot; later starts load the cache.

```sh
cp integrations/mudbench-memory.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mudbench-memory.service
curl http://127.0.0.1:8000/api/sysinfo
```

The service binds loopback only. The game server proxies it; the browser never
calls it directly.

## Health and rollback

- `GET /api/sysinfo` reports indexed sentences, scopes and latency.
- If the service is down, the game uses the browser-local `MEMORY` block and
  keeps playing.
- To roll back, `systemctl --user disable --now mudbench-memory.service`; no
  game state depends on it.
