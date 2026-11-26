# Bonsai 2.5 27B on wick

The local 4090 runs the Ternary Bonsai 2.5 27B agent model. It is a separate
model server; the MUDBench game server still holds no model and no provider key.

## What is installed

- `~/bonsai/models/Ternary-Bonsai-2.5-27B-PTQ1_0-mtp.gguf` — 5.9 GB
- `~/bonsai/bin/llama-server` — PrismML llama.cpp fork, CUDA 12.8 build
- `~/bonsai/cuda12/nvidia/...` — CUDA 12 runtime and cuBLAS libraries
- `~/bonsai/logs/server.log`

Start it with:

```sh
cd ~/bonsai
export LD_LIBRARY_PATH=$HOME/bonsai/bin:$HOME/bonsai/cuda12/nvidia/cuda_runtime/lib:$HOME/bonsai/cuda12/nvidia/cublas/lib
./bin/llama-server \
  -m models/Ternary-Bonsai-2.5-27B-PTQ1_0-mtp.gguf \
  --spec-type draft-mtp --spec-draft-n-max 3 --spec-draft-p-min 0.1 \
  -ngl 999 -fa on -c 32768 -np 1 --jinja \
  --host 127.0.0.1 --port 8085 -a bonsai
```

From the Mac, tunnel it to localhost:

```sh
ssh -N -L 8085:127.0.0.1:8085 wick
```

Then select **Bonsai 2.5 27B (local 4090)** in the browser, or run:

```sh
node tools/agent-score.mjs --provider=bonsai --model=bonsai --turns=200
```

## Measured

With the 4090 also running a training job at about 68% utilization:

- prompt prefill: ~485 tok/s
- decode: **~129 tok/s** with MTP (`draft_n` > 0)
- VRAM: about 10.4 GB at 32k context

The model card's plain 4090 decode is 112 tok/s; MTP is 1.5–1.8× faster. A
clean 200 tok/s requires the training job to be idle and a shorter context.

## Scorecard

A 200-turn Bonsai run visited **44 rooms**, completed **4 quests**, produced
175 plans / 168 lessons, had 6 blocked attempts, 1 death, and finished at level
2 / 204 XP. It reached the Moonwell, Moon Throne, Eclipse Stair, Mirror Vault
and Salt Heart.
