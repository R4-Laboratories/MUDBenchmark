// Read and summarize the flat span log the server writes. The summary is the
// benchmark view: counts, tick range, latency, actors and rooms. The command
// text stays in the log; the public /spans endpoint returns aggregates and the
// recent command ticks, never the text.

import { closeSync, openSync, readSync, statSync } from "node:fs";

const MAX_BYTES = 4 * 1024 * 1024;

export function summarizeSpans(lines, { recent = 100 } = {}) {
  const spans = [];
  for (const line of lines) {
    const text = typeof line === "string" ? line.trim() : "";
    if (!text) continue;
    try {
      const span = JSON.parse(text);
      if (span && typeof span.name === "string") spans.push(span);
    } catch {
      // A partial or foreign line is not a span; skip it.
    }
  }
  const kinds = {};
  const commands = [];
  const actors = new Set();
  const rooms = new Set();
  let minTick = null;
  let maxTick = null;
  let first = null;
  let last = null;
  let latencyCount = 0;
  let latencyTotal = 0;
  let latencyMax = 0;
  for (const span of spans) {
    kinds[span.name] = (kinds[span.name] ?? 0) + 1;
    if (typeof span.at === "string") {
      if (first === null || span.at < first) first = span.at;
      if (last === null || span.at > last) last = span.at;
    }
    if (span["actor.id"] !== undefined && span["actor.id"] !== null) actors.add(String(span["actor.id"]));
    if (span["room.id"] !== undefined && span["room.id"] !== null) rooms.add(String(span["room.id"]));
    const tick = Number(span["world.tick"]);
    if (Number.isInteger(tick)) {
      minTick = minTick === null ? tick : Math.min(minTick, tick);
      maxTick = maxTick === null ? tick : Math.max(maxTick, tick);
    }
    const duration = Number(span.duration_ms);
    if (Number.isFinite(duration) && duration > 0) {
      latencyCount += 1;
      latencyTotal += duration;
      latencyMax = Math.max(latencyMax, duration);
    }
    if (span.name === "world.input" && !span.refused) {
      commands.push({
        tick: Number.isInteger(tick) ? tick : null,
        text: String(span.text ?? ""),
        actor: span["actor.id"] ?? null,
        at: span.at ?? null,
      });
    }
  }
  return {
    schema: "mudbenchmark/spans/1",
    count: spans.length,
    kinds,
    first,
    last,
    ticks: { min: minTick, max: maxTick },
    latency: {
      count: latencyCount,
      avg_ms: latencyCount ? Math.round(latencyTotal / latencyCount) : 0,
      max_ms: latencyMax,
    },
    actors: [...actors],
    rooms: [...rooms],
    commands: commands.slice(-recent),
  };
}

export function redactSpans(summary) {
  return {
    ...summary,
    actors: summary.actors.length,
    rooms: summary.rooms.length,
    commands: summary.commands.length,
    recent: summary.commands.slice(-20).map(({ tick, at }) => ({ tick, at })),
  };
}

export function readSpanTail(file, { maxBytes = MAX_BYTES, recent = 100 } = {}) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return summarizeSpans([], { recent });
  }
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  if (length <= 0) return summarizeSpans([], { recent });
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  let text = buffer.toString("utf8");
  if (start > 0) {
    const newline = text.indexOf("\n");
    if (newline >= 0) text = text.slice(newline + 1);
  }
  return summarizeSpans(text.split("\n"), { recent });
}
