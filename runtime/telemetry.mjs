// Span emission for MUDBench.
//
// Emits OpenTelemetry OTLP/HTTP JSON to OTEL_EXPORTER_OTLP_ENDPOINT when it is
// set; otherwise appends readable JSONL to TELEMETRY_LOG so a run can be
// inspected on a machine with no collector. Either way the attribute names are
// the ones in docs/SAFETY-MODEL.md, because a schema that changes shape with
// the transport is not a schema.

import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

const ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const LOG = process.env.TELEMETRY_LOG ?? "/tmp/mudbench-spans.jsonl";
export const TELEMETRY_LOG = LOG;
// The full log is dominated by tick spans. Player statistics only need the
// sparse session, movement, quest, combat, snapshot and input records, so they
// get their own compact log next to the main one.
const PLAYER_LOG = process.env.PLAYER_LOG
  ?? (LOG.endsWith(".jsonl") ? `${LOG.slice(0, -6)}.players.jsonl` : `${LOG}.players.jsonl`);
export const PLAYER_LOG_FILE = PLAYER_LOG;
export const PLAYER_SPAN_NAMES = new Set([
  "world.session", "world.disconnect", "world.quest", "world.transition",
  "world.combat", "world.snapshot", "world.input",
]);
const SERVICE = process.env.OTEL_SERVICE_NAME ?? "mudbench";
const MAX_BYTES = Number(process.env.TELEMETRY_MAX_BYTES ?? 64 * 1024 * 1024);
const PLAYER_MAX_BYTES = Number(process.env.PLAYER_MAX_BYTES ?? 16 * 1024 * 1024);
let writes = 0;
let playerWrites = 0;

// Rotate the local JSONL at a fixed size. The archive keeps its timestamp; the
// next append creates a fresh live file. A full disk must not stop the world.
function rotatePlayerIfNeeded() {
  playerWrites += 1;
  if (playerWrites % 5000 !== 0) return;
  try {
    if (statSync(PLAYER_LOG).size < PLAYER_MAX_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(PLAYER_LOG, `${PLAYER_LOG}.${stamp}`);
  } catch {}
}

function rotateIfNeeded() {
  writes += 1;
  if (writes % 5000 !== 0) return;
  try {
    if (statSync(LOG).size < MAX_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(LOG, `${LOG}.${stamp}`);
  } catch {}
}

/** Keep only the spans the compact player view needs, one JSON object per line. */
export function selectPlayerLines(text) {
  const kept = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const span = JSON.parse(line);
      if (span && PLAYER_SPAN_NAMES.has(span.name)) kept.push(line);
    } catch {
      // a partial or foreign line is not a span
    }
  }
  return kept.length ? `${kept.join("\n")}\n` : "";
}

/**
 * Seed the compact player log from the main log on first start. The full log
 * already holds the history; this is a one-time filter, not a second record.
 */
export function ensurePlayerLog() {
  if (existsSync(PLAYER_LOG) || !existsSync(LOG)) return { created: false, kept: 0 };
  try {
    const text = selectPlayerLines(readFileSync(LOG, "utf8"));
    writeFileSync(PLAYER_LOG, text);
    return { created: true, kept: text ? text.trim().split("\n").length : 0 };
  } catch {
    return { created: false, kept: 0 };
  }
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const traceId = () => hex(16);
const spanId = () => hex(8);

export const digest = (text) =>
  createHash("sha256").update(String(text), "utf8").digest("hex");

function attrValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(attrValue) } };
  return { stringValue: String(value) };
}

const toAttributes = (attrs) =>
  Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([key, value]) => ({ key, value: attrValue(value) }));

/**
 * Record one span. Fire and forget: telemetry must never break the world, so a
 * failed export is swallowed and the decision it describes still happens.
 */
export function recordSpan(name, attributes = {}, durationMs = 0) {
  const start = Date.now() - Math.round(durationMs);
  const span = {
    traceId: traceId(),
    spanId: spanId(),
    name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: String(start * 1_000_000),
    endTimeUnixNano: String(Date.now() * 1_000_000),
    attributes: toAttributes(attributes),
    status: { code: 0 },
  };

  if (ENDPOINT) {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: toAttributes({ "service.name": SERVICE }),
          },
          scopeSpans: [{ scope: { name: "mudbench", version: "0.1.0" }, spans: [span] }],
        },
      ],
    });
    fetch(`${ENDPOINT.replace(/\/$/, "")}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {});
  }

  // The local JSONL copy is always written, even when an OTLP collector is
  // configured. The collector is a convenience, not the only record: trend
  // queries and dataset builds read this file directly.
  const flat = { name, at: new Date(start).toISOString(), duration_ms: Math.round(durationMs) };
  for (const { key, value } of span.attributes) {
    flat[key] = Object.values(value)[0];
  }
  const line = `${JSON.stringify(flat)}\n`;
  try {
    rotateIfNeeded();
    appendFileSync(LOG, line);
  } catch {
    // never let telemetry break a turn
  }
  if (PLAYER_SPAN_NAMES.has(name)) {
    try {
      rotatePlayerIfNeeded();
      appendFileSync(PLAYER_LOG, line);
    } catch {
      // the compact view is an optimization, not the record
    }
  }
}
