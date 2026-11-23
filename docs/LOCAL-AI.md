# The local free agent

The one free agent no longer needs a key or a metered API. It runs
**Qwen2.5-3B-Instruct (Q4_K_M)** on the existing server's CPU, through
`llama.cpp`'s OpenAI-compatible server. The game proxies it at `/api/free/v1`;
the browser never sees a key and the model binds to `127.0.0.1` only.

This is the free path for one agent. Every other player can still choose Groq,
OpenAI, Anthropic, a custom endpoint, or Ollama with their own key. There is no
mid-session quota that kills a run: the local quotas are set high enough to be
effectively unlimited, and the only physical limit is CPU speed.

## Why this shape

- **No key, no signup, no per-request bill.** The server already exists; the
  model uses spare CPU and about 2.5 GB of RAM.
- **The busy GPU is untouched.** The RTX 4090 is used by another workload; the
  model runs with `-t 20` on the 32-thread Ryzen and does not compete for VRAM.
- **Fast enough.** About **22 tokens/sec** generation and a cached prompt
  prefix; a normal MUD turn is roughly **1–2 seconds**. The first prompt after
  a restart is slower while the KV cache warms.
- **Good enough.** The 1.5B model was faster but looped on `look`; the 3B model
  reads details, moves, and opens containers. The agent still has the game's
  loop guard and command validator.

## Install

From the repository root on the server:

```bash
mkdir -p ~/.mudbench/local-ai ~/.mudbench/models
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git \
  ~/.mudbench/local-ai/llama.cpp
cmake -S ~/.mudbench/local-ai/llama.cpp -B ~/.mudbench/local-ai/llama.cpp/build \
  -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build ~/.mudbench/local-ai/llama.cpp/build --config Release -j 16 \
  --target llama-server

curl -L --fail -o ~/.mudbench/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf

cp deploy/mudbench-local-ai.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now mudbench-local-ai.service
curl -s http://127.0.0.1:8081/health
```

Then add these lines to `~/.mudbench/owner.env` (mode `600`) and restart the
world:

```bash
FREE_AI_KEY=local
FREE_AI_BASE=http://127.0.0.1:8081/v1
FREE_AI_MODEL=qwen2.5-3b-instruct
FREE_AI_DAILY_TURNS=100000
FREE_AI_MINUTE_TURNS=120
FREE_AI_GLOBAL_DAILY=1000000
```

```bash
chmod 600 ~/.mudbench/owner.env
systemctl --user restart mudbench-world.service
curl -s http://127.0.0.1:8090/api/free
```

`/api/free` should report `configured: true`, the model, and the high limits.
The free card then starts the agent as **Free fast (operator) · qwen2.5-3b-instruct**.

## Service

`deploy/mudbench-local-ai.service` uses `%h`, so it works for any user:

```ini
ExecStart=%h/.mudbench/local-ai/llama.cpp/build/bin/llama-server \
  -m %h/.mudbench/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  -c 8192 -t 20 -tb 20 --host 127.0.0.1 --port 8081 -np 2
```

- `-c 8192` — 8k context, enough for the system prompt, room, memory and history.
- `-t 20 -tb 20` — 20 of 32 threads; leave the rest for the game and holo.
- `-np 2` — two request slots; one free agent plus a retry.
- `--host 127.0.0.1` — not reachable from outside the box.

## Tuning

- **Less CPU / more speed:** switch to
  `qwen2.5-1.5b-instruct-q4_k_m.gguf` and `FREE_AI_MODEL=qwen2.5-1.5b-instruct`;
  it is faster but loops more. The 3B is the current choice.
- **More quality:** Qwen2.5-7B-Instruct Q4_K_M is about 4.5 GB and roughly
  8–12 tok/s on this CPU; use it only if the 3B is not good enough.
- **GPU later:** if the 4090 frees up, rebuild llama.cpp with CUDA and add
  `-ngl 99`; the model will be much faster. Do not take the GPU from the
  training job.

## Cost and safety

The incremental cost is **$0**: the CPU, RAM and disk already exist. The model
file is about 2 GB. The server key is the literal string `local`; `llama-server`
is bound to loopback and has no public route. The game's `/api/free` proxy still
requires a short-lived Prism token and applies a per-account quota, so a public
client cannot call the model directly.
