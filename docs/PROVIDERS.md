# Model providers

The AI panel talks to five protocols through one browser-side registry. The
game server never sees a user's provider key. The Gemini demo is the exception:
its operator key stays on the server and the browser receives only a
short-lived demo token.

## What you can select

| Preset | Protocol | Key |
| --- | --- | --- |
| Ollama (local) | OpenAI-compatible `/v1` | none |
| OpenAI | OpenAI chat completions | required |
| Anthropic (Claude) | Anthropic messages | required |
| OpenAI-compatible (custom) | OpenAI chat completions | **optional** |
| Gemini demo (Prism only) | server proxy to Gemini's OpenAI endpoint | none |
| Prime Router | Prime Router `/api/chat` | none |

The custom preset is the path for OpenRouter, Groq, Together, LiteLLM, a
company gateway, LM Studio, vLLM, or any other OpenAI-compatible endpoint. The
key field is shown; leave it empty if the endpoint does not need one.

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

There is no silent free default. The operator may enable the **Gemini demo**
by setting `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`,
`GEMINI_BASE`, `GEMINI_DAILY_TURNS`, `GEMINI_MINUTE_TURNS`,
`GEMINI_GLOBAL_DAILY`) on the server. When configured:

1. The browser shows **Gemini demo (Prism only)**. It never sees the key.
2. An authenticated game socket asks for a short-lived demo token.
3. The proxy checks the token and per-Prism daily/minute limits, then calls
   Gemini with `reasoning_effort: none` (or `low` on deliberate turns).
4. `/api/demo` reports only `configured`, model and limits.

Google's free tier is real but variable: limits are per project (RPM, TPM,
RPD), reset at midnight Pacific, and free-tier data may be used to improve
products. The UI discloses that before the run. The demo is deliberately
opt-in; a local model remains the no-cost path.

Other options are unchanged: user-supplied keys, a local Ollama/LM Studio
model, or a custom OpenAI-compatible endpoint.

## Errors

A failed test or turn names the layer that failed:

- `401/403` — the key was refused for this host;
- `404` — no chat endpoint at the normalized URL;
- `429` — rate limit; retry later or switch provider;
- `TypeError: Failed to fetch` — usually CORS, a wrong URL, an offline host, or
  a local-network permission, not necessarily a bad key;
- timeout — the model did not answer inside the deadline; direct mode falls
  back to `look` twice, then pauses;
- `503` on the Gemini demo — the operator has not configured a key;
- `429` on the Gemini demo — the per-account or world-wide demo quota is
  reached; wait for the minute/day reset or use another provider.
