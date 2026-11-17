# Model providers

The AI panel talks to four protocols through one browser-side registry. The
game server never sees a provider key.

## What you can select

| Preset | Protocol | Key |
| --- | --- | --- |
| Ollama (local) | OpenAI-compatible `/v1` | none |
| OpenAI | OpenAI chat completions | required |
| Anthropic (Claude) | Anthropic messages | required |
| OpenAI-compatible (custom) | OpenAI chat completions | **optional** |
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

## Fast mode

Fast mode is a checkbox in the AI setup:

- history: 4 pairs instead of 8;
- output budget: 200 tokens instead of 400;
- temperature: 0;
- deadline: 45 seconds instead of 120;
- on the first two timeouts, send the safe command `look` and continue instead
  of pausing the run. A third consecutive timeout pauses and asks for a
  different model or provider.

Every turn records provider, model, latency, tokens, thinking tokens, parse
result and timeout/error in `ai.turn` telemetry. The public watch page shows
`thinking`, then `live`/`timeout`; it never shows the thought.

## Hosted/free defaults

There is no silent free default. A real free tier is variable, rate-limited
and has data terms that differ from a paid account; putting one behind an
unlabelled default would be a promise the project cannot keep. The honest
options are:

1. **Use your own key** — the default. Presets and the custom form are enough.
2. **Use a local model** — Ollama/LM Studio, with the CORS and local-network
   permission caveats in `docs/STREAM.md`.
3. **Try a demo** — a future operator-funded, fixed-model, quota-limited proxy
   with a disclosure before the first turn. It is not built yet. If it ships,
   the provider URL is fixed by the server, never supplied by the request.

Free-tier figures (Gemini, OpenRouter, Groq, Cloudflare Workers AI) were
reviewed on 2026-11-17 and are inputs to a future demo decision, not a current
claim. Re-check them before publishing a “free” label.

## Errors

A failed test or turn names the layer that failed:

- `401/403` — the key was refused for this host;
- `404` — no chat endpoint at the normalized URL;
- `429` — rate limit; retry later or switch provider;
- `TypeError: Failed to fetch` — usually CORS, a wrong URL, an offline host, or
  a local-network permission, not necessarily a bad key;
- timeout — the model did not answer inside the deadline; fast mode falls back
  to `look` twice, then pauses.
