# Model providers

The AI panel talks to eight presets through one browser-side registry. The
game server never sees a user's provider key. The two server-keyed presets are
the exception: the operator key stays on the server and the browser receives
only a short-lived token and a per-account quota.

## What you can select

| Preset | Protocol | Key |
| --- | --- | --- |
| Groq (free key, fast) | OpenAI chat completions | required (free) |
| Free fast (operator) | server proxy to Groq/Gemini/OpenAI-compatible | none |
| Ollama (local) | OpenAI-compatible `/v1` | none |
| OpenAI | OpenAI chat completions | required |
| Anthropic (Claude) | Anthropic messages | required |
| OpenAI-compatible (custom) | OpenAI chat completions | **optional** |
| Gemini demo (Prism only) | server proxy to Gemini's OpenAI endpoint | none |
| Prime Router | Prime Router `/api/chat` | none |

The custom preset is the path for OpenRouter, Groq, Together, LiteLLM, a
company gateway, LM Studio, vLLM, or any other OpenAI-compatible endpoint. The
key field is shown; leave it empty if the endpoint does not need one.

**Groq** is the fast free path for a new browser. Create a free key at
`console.groq.com/keys` (no card) and paste it once; the 8B instant model is
quick, and the free tier is about 30 requests per minute and 14,400 per day,
enough for continuous single-agent play. The key stays in this browser and goes
only to `api.groq.com`. The game presents the **Start a fast free agent** card;
if the browser has no Prism id, it creates one and registers it first, so there
is no sign-up form. The full provider list stays behind **Use another model**,
and the five persona presets change only the system goal, not the provider.

If the operator configures a server-side key, the **Free fast (operator)**
preset appears and the free card starts with no key at all. The server holds the
key and enforces a per-Prism daily/minute quota; the browser receives only a
short-lived token. This is the one-click path for players. The operator can use
Groq (the default), Gemini, or any OpenAI-compatible endpoint.

Pollinations is no longer offered. Its anonymous tier now allows one text reply
every 45 seconds per IP, which is too slow for a playable agent and cannot be
raised without a key. A local Ollama model remains the private, no-account
option; user-supplied keys and custom endpoints are unchanged.

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

## Hosted/free defaults

**Groq direct (free key).** The browser sends the prompt to
`https://api.groq.com/openai/v1/chat/completions` with the player's key. The
default model is `llama-3.1-8b-instant`. The key is stored per origin in this
browser and never reaches the game server. The provider hint links the free key
page and states the tier.

**Operator fast model (server key).** Set `GROQ_API_KEY` (or `FREE_AI_KEY`) on
the game server. The defaults are:

| Variable | Default | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` / `FREE_AI_KEY` | empty | server-side key; never sent to the browser |
| `FREE_AI_BASE` | `https://api.groq.com/openai/v1` | any OpenAI-compatible base |
| `FREE_AI_MODEL` | `llama-3.1-8b-instant` | the model the proxy uses |
| `FREE_AI_DAILY_TURNS` | `5000` | per-Prism daily turns |
| `FREE_AI_MINUTE_TURNS` | `25` | per-Prism turns per minute |
| `FREE_AI_GLOBAL_DAILY` | `14000` | world-wide daily turns |

The browser calls `/api/free/v1/chat/completions` with the same short-lived
`x-demo-token` used by the Gemini demo. The server checks the token and the
quota, then forwards the request with the operator key. `/api/free` and the
`free` field on `/api/demo` report only `configured`, model and limits. The
proxy passes a `429` and `Retry-After` through to the client; the client waits
and retries up to three times before pausing.

The operator may also enable the **Gemini demo** by setting `GEMINI_API_KEY`
(and optionally `GEMINI_MODEL`, `GEMINI_BASE`, `GEMINI_DAILY_TURNS`,
`GEMINI_MINUTE_TURNS`, `GEMINI_GLOBAL_DAILY`) on the server. When configured:

1. The browser shows **Gemini demo (Prism only)**. It never sees the key.
2. An authenticated game socket asks for a short-lived demo token.
3. The proxy checks the token and per-Prism daily/minute limits, then calls
   Gemini with `reasoning_effort: none` (or `low` on deliberate turns).
4. `/api/demo` reports only `configured`, model and limits.

Google's free tier is real but variable: limits are per project (RPM, TPM,
RPD), reset at midnight Pacific, and free-tier data may be used to improve
products. **Free tier does not mean keyless**: Google requires an API key to
attribute quota and stop abuse, and there is no public Gemini endpoint that
accepts anonymous requests. The operator key is the missing input; the code
path is already built and dormant until `GEMINI_API_KEY` is set.

The Gemini demo remains a separate, server-keyed, quota-limited path. The
operator fast model is the recommended one-click path for players; Groq direct
is the recommended path when each player has their own free key. A local model
remains the private, no-account option. Other options are unchanged:
user-supplied keys, a local Ollama/LM Studio model, or a custom
OpenAI-compatible endpoint.

The UI discloses the Groq free-tier cadence in the provider hint and the
operator/Gemini limits before a run. A key is never required just to watch an
AI play. There is no keyless public text API with both unlimited volume and
low latency; a key (player or operator) is required for continuous fast play.

## Errors

A failed test or turn names the layer that failed:

- `401/403` — the key was refused for this host;
- `404` — no chat endpoint at the normalized URL;
- `429` — rate limit; the AI honors `Retry-After` and retries up to three times
  before pausing. Check the Groq minute/day quota or the operator quota;
- `402` — payment or free-tier exhaustion from a provider; switch provider or
  add credit;
- `TypeError: Failed to fetch` — usually CORS, a wrong URL, an offline host, or
  a local-network permission, not necessarily a bad key;
- timeout — the model did not answer inside the deadline; direct mode falls
  back to `look` twice, then pauses;
- `503` on the operator fast model or Gemini demo — the operator has not
  configured a key;
- `429` on the operator fast model or Gemini demo — the per-account or
  world-wide quota is reached; wait for the minute/day reset or use another
  provider.
