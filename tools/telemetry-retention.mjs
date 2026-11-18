#!/usr/bin/env node
// Inspect or apply telemetry retention.
//
//   node tools/telemetry-retention.mjs --dir ~/.mudbench/telemetry
//   node tools/telemetry-retention.mjs --dir ~/.mudbench/telemetry --apply
//
// The default is a dry run. `spans.jsonl` and `trace.jsonl` are never removed.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { planRetention } from "../runtime/retention.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const dir = option("dir", join(process.env.HOME ?? ".", ".mudbench", "telemetry"));
if (!existsSync(dir)) {
  console.error(`No telemetry directory at ${dir}.`);
  process.exit(1);
}
const files = [];
const walk = (root) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = statSync(path);
    files.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
  }
};
walk(dir);
const plan = planRetention(files, {
  keepDays: Number(option("keep-days", 90)),
  maxBytes: Number(option("max-bytes", 4 * 1024 * 1024 * 1024)),
});
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
console.log(`keep ${plan.keep.length} files (${mb(plan.bytes)}); remove ${plan.remove.length} files (${mb(plan.removedBytes)})`);
for (const file of plan.remove) console.log(`  remove ${file.path} (${mb(file.size)})`);
if (!args.includes("--apply")) {
  console.log("dry run: pass --apply to delete the listed archives");
  process.exit(0);
}
for (const file of plan.remove) {
  try { rmSync(file.path, { force: true }); } catch (error) { console.error(`could not remove ${file.path}: ${error.message}`); process.exitCode = 1; }
}
console.log(`removed ${plan.remove.length} files`);
