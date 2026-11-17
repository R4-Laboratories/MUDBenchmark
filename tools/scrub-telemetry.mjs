#!/usr/bin/env node
// Scrub secrets and private bodies from a flat span log.
//
// New server writes are already redacted. This is for logs written before the
// policy existed (and for imported logs). It preserves the event shape, counts
// and timings; only credential/private text fields change.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { scrubSpan } from "../runtime/telemetry-policy.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const input = option("file", null);
const output = option("out", null);
const inPlace = args.includes("--in-place");
if (!input || (!output && !inPlace)) {
  console.error("usage: scrub-telemetry --file <spans.jsonl> (--out <file> | --in-place)");
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`scrub-telemetry: no file at ${input}`);
  process.exit(1);
}

const lines = readFileSync(input, "utf8").split("\n");
const result = [];
let spans = 0;
let changed = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  let span;
  try { span = JSON.parse(line); } catch { continue; }
  const clean = scrubSpan(span);
  spans += 1;
  if (JSON.stringify(clean) !== JSON.stringify(span)) changed += 1;
  result.push(JSON.stringify(clean));
}
const text = `${result.join("\n")}\n`;
if (inPlace) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(input, `${input}.pre-scrub-${stamp}`);
  writeFileSync(input, text);
  console.log(`scrubbed ${spans} spans (${changed} changed); backup ${input}.pre-scrub-${stamp}`);
} else {
  writeFileSync(output, text);
  console.log(`scrubbed ${spans} spans (${changed} changed) -> ${output}`);
}
