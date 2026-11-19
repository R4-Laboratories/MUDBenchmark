// Normalize one AI turn metric sent by a browser client.
//
// The server records only the numbers and the command, never the thought, the
// prompt, the reply or the provider key. Metrics are cheap enough to send every
// turn and are the raw material for trend queries rather than a pass/fail
// benchmark.

export const AI_TURN_KIND = "ai.turn";

function text(value, max) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function number(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), max) : null;
}

export function normalizeAiTurn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind !== AI_TURN_KIND) return null;
  const provider = text(value.provider, 64);
  const model = text(value.model, 128);
  if (!provider && !model) return null;
  return {
    kind: AI_TURN_KIND,
    provider,
    model,
    latency_ms: number(value.latency_ms, 600_000),
    prompt_tokens: number(value.prompt_tokens, 10_000_000),
    completion_tokens: number(value.completion_tokens, 10_000_000),
    thinking_tokens: number(value.thinking_tokens, 10_000_000),
    parse_ok: typeof value.parse_ok === "boolean" ? value.parse_ok : null,
    command: text(value.command, 240),
    thought_chars: number(value.thought_chars, 100_000),
    timeout: value.timeout === true,
    error: text(value.error, 200),
    turn: number(value.turn, 1_000_000),
    tick: number(value.tick, 1_000_000_000),
    fast: value.fast === true,
    deliberate: value.deliberate === true,
    reasoning: text(value.reasoning, 16),
    invalid: value.invalid === true,
    invalid_reason: text(value.invalid_reason, 120),
    repair: text(value.repair, 80),
    loop: value.loop === true,
    memory_hit: value.memory_hit === true,
    r4_hit: value.r4_hit === true,
    rooms_seen: number(value.rooms_seen, 100_000),
    prompt_version: text(value.prompt_version, 32),
  };
}

export function aiTurnAttributes(metric) {
  return {
    "ai.provider": metric.provider,
    "ai.model": metric.model,
    "ai.latency_ms": metric.latency_ms,
    "ai.prompt_tokens": metric.prompt_tokens,
    "ai.completion_tokens": metric.completion_tokens,
    "ai.thinking_tokens": metric.thinking_tokens,
    "ai.parse_ok": metric.parse_ok,
    "ai.command": metric.command,
    "ai.thought_chars": metric.thought_chars,
    "ai.timeout": metric.timeout,
    "ai.error": metric.error,
    "ai.turn": metric.turn,
    "world.tick": metric.tick,
    "ai.fast": metric.fast,
    "ai.deliberate": metric.deliberate,
    "ai.reasoning": metric.reasoning,
    "ai.invalid": metric.invalid,
    "ai.invalid_reason": metric.invalid_reason,
    "ai.repair": metric.repair,
    "ai.loop": metric.loop,
    "ai.memory_hit": metric.memory_hit,
    "ai.r4_hit": metric.r4_hit,
    "ai.rooms_seen": metric.rooms_seen,
    "ai.prompt_version": metric.prompt_version,
  };
}
