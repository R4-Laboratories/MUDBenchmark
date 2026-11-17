// Span emission for MUDBench.
//
// Emits OpenTelemetry OTLP/HTTP JSON to OTEL_EXPORTER_OTLP_ENDPOINT when it is
// set; otherwise appends readable JSONL to TELEMETRY_LOG so a run can be
// inspected on a machine with no collector. Either way the attribute names are
// the ones in docs/SAFETY-MODEL.md, because a schema that changes shape with
// the transport is not a schema.

import { appendFileSync, renameSync, statSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

const ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const LOG = process.env.TELEMETRY_LOG ?? "/tmp/mudbench-spans.jsonl";
export const TELEMETRY_LOG = LOG;
const SERVICE = process.env.OTEL_SERVICE_NAME ?? "mudbench";
const MAX_BYTES = Number(process.env.TELEMETRY_MAX_BYTES ?? 64 * 1024 * 1024);
let writes = 0;

// Rotate the local JSONL at a fixed size. The archive keeps its timestamp; the
// next append creates a fresh live file. A full disk must not stop the world.
function rotateIfNeeded() {
  writes += 1;
  if (writes % 5000 !== 0) return;
  try {
    if (statSync(LOG).size < MAX_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(LOG, `${LOG}.${stamp}`);
  } catch {}
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
  try {
    rotateIfNeeded();
    appendFileSync(LOG, `${JSON.stringify(flat)}\n`);
  } catch {
    // never let telemetry break a turn
  }
}
