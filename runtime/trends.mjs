// Pure aggregation for the telemetry trend view.
//
// There is no pass/fail here. The output is a description of what happened:
// how many sessions, how long model turns took, how many parsed, which commands
// were used, how far characters progressed, and what the world looked like at
// each snapshot. Benchmarks are queries over this, added later.

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const countBy = (values) => {
  const out = {};
  for (const value of values) {
    const key = value ?? "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
};

const verb = (command) => String(command ?? "").trim().split(/\s+/)[0].toLowerCase() || null;

export function summarizeTrends(spans) {
  const all = Array.isArray(spans) ? spans : [];
  const counts = countBy(all.map((span) => span.name));
  const times = all.map((span) => span.at).filter((at) => typeof at === "string").sort();
  const ai = all.filter((span) => span.name === "ai.turn" || span.name === "agent.decision");
  const inputs = all.filter((span) => span.name === "world.input");
  const snapshots = all.filter((span) => span.name === "world.snapshot");
  const clients = all.filter((span) => span.name === "world.client");
  const disconnects = all.filter((span) => span.name === "world.disconnect");
  const sessions = all.filter((span) => span.name === "world.session");

  const aiLatency = ai.map((span) => number(span["ai.latency_ms"] ?? span["telemetry.latency_ms"])).filter((n) => n !== null);
  const aiTurns = ai.filter((span) => span.name === "ai.turn");
  const aiParsed = ai.filter((span) => span["ai.parse_ok"] === true || span["ai.parse_ok"] === "true" || span["output.parse_ok"] === true || span["output.parse_ok"] === "true");
  const aiTimedOut = ai.filter((span) => span["ai.timeout"] === true || span["ai.timeout"] === "true");
  const aiErrors = ai.filter((span) => span["ai.error"]);

  const lastSnapshot = snapshots[snapshots.length - 1] ?? null;
  const snapshotActors = lastSnapshot?.["world.actors"]
    ? (() => { try { return JSON.parse(lastSnapshot["world.actors"]); } catch { return []; } })()
    : [];
  const levels = snapshotActors.map((actor) => number(actor.level)).filter((n) => n !== null);
  const onlines = snapshots.map((span) => number(span["world.online"])).filter((n) => n !== null);
  const resetSeconds = snapshots.map((span) => number(span["world.reset_seconds"])).filter((n) => n !== null);

  return {
    schema: "mudbenchmark/trends/1",
    spans: all.length,
    first: times[0] ?? null,
    last: times[times.length - 1] ?? null,
    counts,
    ai: {
      turns: ai.length,
      providers: countBy(ai.map((span) => span["ai.provider"])),
      models: countBy(ai.map((span) => span["ai.model"] ?? span.model)),
      parsed: ai.length ? aiParsed.length / ai.length : null,
      timeouts: aiTimedOut.length,
      errors: countBy(aiErrors.map((span) => span["ai.error"])),
      latency_ms: {
        count: aiLatency.length,
        p50: percentile(aiLatency, 50),
        p95: percentile(aiLatency, 95),
        max: aiLatency.length ? Math.max(...aiLatency) : null,
      },
      tokens_in: aiTurns.reduce((sum, span) => sum + (number(span["ai.prompt_tokens"]) ?? 0), 0),
      tokens_out: aiTurns.reduce((sum, span) => sum + (number(span["ai.completion_tokens"]) ?? 0), 0),
      thinking_tokens: aiTurns.reduce((sum, span) => sum + (number(span["ai.thinking_tokens"]) ?? 0), 0),
      commands: countBy(ai.map((span) => verb(span["ai.command"] ?? span["output.command"]))),
      prompt_versions: countBy(ai.map((span) => span["ai.prompt_version"])),
      reasonings: countBy(ai.map((span) => span["ai.reasoning"])),
      deliberate: ai.filter((span) => span["ai.deliberate"] === true || span["ai.deliberate"] === "true").length,
      direct: ai.filter((span) => span["ai.fast"] === true || span["ai.fast"] === "true").length,
      by_mode: (() => {
        const groups = { direct: [], full: [] };
        for (const span of ai) {
          const latency = number(span["ai.latency_ms"] ?? span["telemetry.latency_ms"]);
          if (latency === null) continue;
          const direct = span["ai.fast"] === true || span["ai.fast"] === "true";
          groups[direct ? "direct" : "full"].push(latency);
        }
        return Object.fromEntries(Object.entries(groups).map(([mode, values]) => [mode, {
          turns: values.length,
          p50: percentile(values, 50),
          p95: percentile(values, 95),
        }]));
      })(),
    },
    world: {
      snapshots: snapshots.length,
      online: {
        latest: lastSnapshot ? number(lastSnapshot["world.online"]) : null,
        max: onlines.length ? Math.max(...onlines) : null,
        avg: onlines.length ? onlines.reduce((a, b) => a + b, 0) / onlines.length : null,
      },
      accounts: lastSnapshot ? number(lastSnapshot["world.accounts"]) : null,
      characters: lastSnapshot ? number(lastSnapshot["world.characters"]) : null,
      levels: {
        count: levels.length,
        max: levels.length ? Math.max(...levels) : null,
        avg: levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null,
      },
      reset_seconds: {
        latest: resetSeconds.length ? resetSeconds[resetSeconds.length - 1] : null,
        min: resetSeconds.length ? Math.min(...resetSeconds) : null,
        max: resetSeconds.length ? Math.max(...resetSeconds) : null,
      },
    },
    commands: {
      accepted: inputs.filter((span) => !span.refused).length,
      refused: inputs.filter((span) => span.refused).length,
      top: countBy(inputs.filter((span) => !span.refused).map((span) => verb(span.text ?? span.command))),
    },
    clients: {
      connections: clients.length,
      transports: countBy(clients.map((span) => span["client.transport"])),
      sessions: sessions.length,
      disconnects: disconnects.length,
      average_connection_ms: (() => {
        const values = disconnects.map((span) => number(span.duration_ms)).filter((n) => n !== null);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      })(),
    },
  };
}

export function trendLines(summary) {
  const pct = (value) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
  const ms = (value) => value === null ? "—" : `${Math.round(value)} ms`;
  const lines = [
    `spans ${summary.spans}  ${summary.first ?? "—"} → ${summary.last ?? "—"}`,
    `ai turns ${summary.ai.turns}  parsed ${pct(summary.ai.parsed)}  timeout ${summary.ai.timeouts}`,
    `latency p50 ${ms(summary.ai.latency_ms.p50)}  p95 ${ms(summary.ai.latency_ms.p95)}  max ${ms(summary.ai.latency_ms.max)}`,
    `tokens in ${summary.ai.tokens_in}  out ${summary.ai.tokens_out}  thinking ${summary.ai.thinking_tokens}`,
    `providers ${JSON.stringify(summary.ai.providers)}  models ${JSON.stringify(summary.ai.models)}`,
    `commands accepted ${summary.commands.accepted}  refused ${summary.commands.refused}`,
    `world online ${summary.world.online.latest ?? "—"}  max ${summary.world.online.max ?? "—"}  levels max ${summary.world.levels.max ?? "—"}  reset ${summary.world.reset_seconds.latest ?? "—"}s`,
    `clients ${summary.clients.connections}  ${JSON.stringify(summary.clients.transports)}  sessions ${summary.clients.sessions}`,
  ];
  return lines;
}
