# Model providers

The AI panel talks to seven presets through one browser-side registry. Every
key is supplied by the player and stays in the browser; the game server never
sees a provider key and does not host or proxy a model.

## What you can select

| Preset | Protocol | Key |
| --- | --- | --- |
| Groq (free key, fast) | OpenAI chat completions | required (free) |
| Anthropic (Claude) | Anthropic messages | required |
| OpenAI | OpenAI chat completions | required |
| DeepSeek | OpenAI chat completions | required |
| OpenAI-compatible (custom) | OpenAI chat completions | **optional** |
| Ollama (local) | OpenAI-compatible `/v1` | none |
| Prime Router | Prime Router `/api/chat` | none |

The custom preset is the path for OpenRouter, Groq, Together, LiteLLM, a
company gateway, LM Studio, vLLM, or any other OpenAI-compatible endpoint. The
key field is shown; leave it empty if the endpoint does not need one.

**Groq** is the free path for a new browser. Create a free key at
`console.groq.com/keys` (no card) and paste it once; the default model is
`openai/gpt-oss-20b`, about 30 requests per minute and 1,000 per day. That is
enough for a session but not continuous all-day play. The key stays in this
browser and goes only to `api.groq.com`. The free card leads with Groq; if the
browser has no Prism id, it creates one and registers it first, so there is no
form. The full provider list stays behind **Use another model**, and the five
persona presets change only the system goal, not the provider.

**Anthropic, OpenAI, DeepSeek and custom** use the player's own key. DeepSeek is
the low-cost paid option (`deepseek-flash`, about $0.15/M input and $0.60/M
output off-peak, with `deepseek-v4-pro` for harder turns). The custom preset is
the path for OpenRouter, Together, LiteLLM, a company gateway, LM Studio, vLLM,
or any other OpenAI-compatible endpoint; leave the key empty if it needs none.

Pollinations is no longer offered. Its anonymous tier now allows one text reply
every 45 seconds per IP, which is too slow for a playable agent and cannot be
raised without a key. The local Ollama and Prime Router presets remain the
private, no-account options.

An Anthropic-compatible gateway uses the **Anthropic (Claude)** preset with its
base URL and key; the client sends `x-api-key` and the direct-browser header.

## Base URLs

Paste what the provider documents. The client normalizes it:

```
https://api.openai.com/v1/chat/completions → https://api.openai.com/v1
https://api.openai.com/v1/                 → https://api.openai.com/v1
api.openai.com/v1                          → https://api.openai.com/v1
http://127.0.0.1:11434/v1/                 → http://127.0.0.1:11434/v1
```

It never appends a second `/chat/completions` or `/messages`.

## Keys

- A key is stored per **origin**, not in one global slot. A key saved for
  `https://api.openai.com` is never sent to `https://openrouter.ai`.
- The field is blank when a saved key exists; leaving it blank uses the saved
  key. **Forget key** removes only the current host's key.
- The key never reaches the game server, transcript, Model tab or telemetry.
- LocalStorage is not a secret store. A script on this origin, an extension
  with page access, or anyone using this device can read it. Use a limited key
  and forget it on a shared machine.

The first time this version runs, a pre-v0.44 global key is moved only when the
active preset is OpenAI or Anthropic and its origin matches the preset. It is
never attached to an arbitrary custom endpoint.

## Direct prompt, action injection and reasoning

**Direct prompt** is the default fast path. Each turn injects:

- the room text, exits, objects, NPCs and examine-able details;
- the current self state, inventory names and active quest objectives;
- a shortlist of legal actions for this room (including `say`, `tell`,
  `global`, `talk`, socials and room actions).

The shortlist is a hint, not a cage. The model may use any legal command from
the compact `COMMANDS` line, including speech to players. It returns
`THOUGHT`, `REPLY` and `COMMAND`; the parser accepts a missing `REPLY` and
falls back to a known verb.

A compact per-character memory is injected every turn. It records rooms seen,
commands tried in the current room, whether the result changed (`stale`), and
which exits lead to unseen rooms. It persists in browser storage across runs,
so a reload does not reset the character's map. After a stale command repeats
or a movement cycle appears, a loop guard replaces the command with a fresh
exit, `look`, or `wait` instead of pausing the run. This is the structured
memory layer; the R4 router's integer/GCD concept retrieval can replace or
augment it without changing the game interface.

**Reasoning** is a separate setting:

| Setting | Behaviour |
| --- | --- |
| Auto (default) | Direct turns disable thinking; first turns, director messages, low HP, repeated commands and every eighth turn allow it. |
| Always allow thinking | Provider thinking is enabled when the model supports it. |
| Never reason | The provider thinking switch is forced off. |

Ollama uses `think: true/false` only for models that support it and
`keep_alive: -1`; a model like qwen2.5 receives `think:false` rather than a
400. Gemini 2.5 uses `reasoning_effort: none` for direct turns and `low` for
deliberate turns. OpenAI reasoning models use `reasoning_effort` and
`max_completion_tokens`. Standard mode leaves provider defaults alone.

Direct prompt also:

- keeps two history pairs instead of eight;
- budgets 120 output tokens instead of 400;
- sets temperature 0;
- times out at 25 seconds rather than 120, then sends `look` and continues;
- records provider, model, latency, tokens, thinking tokens, parse result,
  direct/deliberate, reasoning setting, prompt version and timeout/error in
  `ai.turn` telemetry.

The public watch page shows `thinking`, then `live`/`timeout`; it never shows
the thought.

## Free and paid providers

**Groq (free key).** The browser sends the prompt to
`https://api.groq.com/openai/v1/chat/completions` with the player's key. The
default model is `openai/gpt-oss-20b`; the free tier is about 30 requests per
minute and 1,000 per day. The key is stored per origin in this browser and
never reaches the game server. The provider hint links the free key page and
states the tier.

**DeepSeek (paid key).** The browser sends the prompt to
`https://api.deepseek.com/v1/chat/completions` with the player's key. The
default is `deepseek-flash`; edit the model field to `deepseek-v4-pro` for
harder turns. It is a low-cost paid API, not a free tier.

**Anthropic, OpenAI and custom.** Anthropic uses its messages endpoint with the
direct-browser header; OpenAI and custom endpoints use OpenAI chat completions.
The key is optional only for a custom endpoint that does not need one.

**No server-hosted model.** The game server does not run a model, hold a shared
key, or proxy provider calls. The operator fast-model and Gemini-demo routes
(`/api/free`, `/api/gemini`, the `FREE_AI_*` and `GEMINI_*` env vars) were
removed in v0.91.52. There is no keyless public text API with both unlimited
volume and low latency; a player key is required for continuous fast play.

**R4 in the browser.** Each AI harness imports `/router.mjs` and runs the
`assemble` router locally. It builds the affordances, objective, world,
resources, persistence, social and recall layers and injects the routed context
into the provider prompt. The server's optional R4 sidecar remains available to
external agents and tools, but the browser AI does not call it. The server never
sees the provider key or the AI's context.

The UI discloses the Groq free-tier cadence and each provider hint before a run.
A key is never required just to watch an AI play. The local Ollama/Prime Router
options need no key; every hosted provider uses the player's key.

## Errors

A failed test or turn names the layer that failed:

- `401/403` — the key was refused for this host;
- `404` — no chat endpoint at the normalized URL;
- `429` — provider rate limit; the AI honors `Retry-After` and retries up to
  three times before pausing. Check the Groq minute/day quota or the OpenAI,
  Anthropic or DeepSeek quota;
- `402` — payment or free-tier exhaustion from a provider; switch provider or
  add credit;
- `TypeError: Failed to fetch` — usually CORS, a wrong URL, an offline host, or
  a local-network permission, not necessarily a bad key;
- timeout — the model did not answer inside the deadline; direct mode falls
  back to `look` twice, then pauses.
