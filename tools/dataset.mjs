#!/usr/bin/env node
// Turn span files into a dataset.
//
// The game is the instrument; this is the thing that reads it. No pass or fail:
// one row per observation, with what happened, who did it, when, and what it
// cost. Benchmarks are queries over this, not a schema the game was written to
// satisfy.
//
// Usage: node tools/dataset.mjs out.jsonl spans/*.jsonl

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [outPath, ...inputs] = process.argv.slice(2);
if (!outPath || inputs.length === 0) {
  console.error("usage: node tools/dataset.mjs out.jsonl span-file...");
  process.exit(2);
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const rows = [];
for (const file of inputs) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.trim().split("\n")) {
    if (!line.trim()) continue;
    let span;
    try {
      span = JSON.parse(line);
    } catch {
      continue;
    }

    // State digests exist so a run can be replayed; they are not observations.
    if (span.name === "world.tick" || span.name === "world.baseline") continue;

    const tick = num(span["world.tick"]);
    const common = {
      source: file.split("/").pop(),
      span: span.name,
      tick,
      ts: span.ts ?? null,
      duration_ms: span.duration_ms ?? null,
    };

    if (span.name === "agent.decision") {
      rows.push({
        ...common,
        event: "decision",
        actor: span["actor.name"] ?? null,
        action: span["output.command"] ?? null,
        parsed: span["output.parse_ok"] === "true" || span["output.parse_ok"] === true,
        tokens_in: num(span["telemetry.tokens_in"]),
        tokens_out: num(span["telemetry.tokens_out"]),
        latency_ms: num(span["telemetry.latency_ms"]),
        router: span["router.mode"] ?? null,
        observation_hash: span["observation.hash"] ?? null,
      });
      continue;
    }

    if (span.name === "world.transition") {
      rows.push({
        ...common,
        event: "transition",
        actor: span["actor.id"] ?? null,
        action: span["action.kind"] ?? null,
        verdict: span["admission.verdict"] ?? null,
        room_from: num(span["room.from"]),
        room_to: num(span["room.to"]),
        events: num(span["event.count"]),
      });
      continue;
    }

    if (span.name === "world.trade") {
      rows.push({
        ...common,
        event: "trade",
        actor: span["actor.id"] ?? null,
        action: span["action.kind"] ?? null,
        object: span["object.id"] ?? null,
        price: num(span.price),
        paid: num(span.paid),
        room_from: num(span["room.id"]),
      });
      continue;
    }

    if (span.name === "world.weather") {
      rows.push({
        ...common,
        event: "weather",
        from: span["weather.from"] ?? null,
        to: span["weather.to"] ?? null,
        room_from: num(span["room.id"]),
      });
      continue;
    }

    if (span.name === "world.combat") {
      rows.push({
        ...common,
        event: "combat",
        actor: span["actor.id"] ?? null,
        target: span["target.id"] ?? null,
        damage: num(span.damage),
        target_hp: num(span["target.hp"]),
        verdict: span.outcome ?? null,
        room_from: num(span["room.id"]),
      });
      continue;
    }

    if (span.name === "world.object") {
      rows.push({
        ...common,
        event: "object",
        actor: span["actor.id"] ?? null,
        action: span["action.kind"] ?? null,
        object: span["object.id"] ?? null,
        container: span["container.id"] ?? null,
        bites_left: num(span["bites.left"]),
        room_from: num(span["room.from"]),
        room_to: num(span["room.to"]),
      });
      continue;
    }

    if (span.name === "world.input") {
      rows.push({
        ...common,
        event: "input",
        actor: span["actor.id"] ?? null,
        action: span.command ?? null,
        verdict: span.refused ?? null,
        wait_ms: num(span.since_ms),
      });
      continue;
    }

    if (span.name === "world.say" || span.name === "world.channel" || span.name === "world.tell" || span.name === "world.mail") {
      rows.push({
        ...common,
        event: span.name.slice("world.".length),
        actor: span["actor.id"] ?? null,
        target: span["target.id"] ?? span["target.key"] ?? null,
        channel: span["channel.id"] ?? null,
        recipients: num(span.recipients),
        delivered: span.delivered === "true" || span.delivered === true,
        text: span.text ?? null,
        text_length: num(span["text.length"]),
        room_from: num(span["room.id"]),
      });
      continue;
    }

    if (span.name === "world.social") {
      rows.push({
        ...common,
        event: "social",
        actor: span["actor.id"] ?? null,
        target: span["target.id"] ?? null,
        action: span["social.id"] ?? null,
        room_from: num(span["room.id"]),
      });
      continue;
    }

    if (span.name === "world.claim" || span.name === "world.answer") {
      rows.push({
        ...common,
        event: span.name === "world.claim" ? "claim" : "answer",
        actor: span["actor.id"] ?? null,
        action: span["output.claim"] ?? span["output.answer"] ?? null,
        topic: span["claim.topic"] ?? "word",
        verdict: span["safety.verdict"] ?? null,
        witnessed: span["truth.witnessed"] ?? null,
        role: num(span["actor.role"]),
      });
      continue;
    }

    rows.push({ ...common, event: "other" });
  }
}

mkdirSync(dirname(outPath) || ".", { recursive: true });
writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);

const count = (key) => {
  const out = {};
  for (const row of rows) out[row[key] ?? "null"] = (out[row[key] ?? "null"] ?? 0) + 1;
  return out;
};

console.log(`${rows.length} observations → ${outPath}`);
console.log("by event:  ", JSON.stringify(count("event")));
const decisions = rows.filter((r) => r.event === "decision");
const tokens = decisions.reduce((s, r) => s + (r.tokens_in ?? 0), 0);
const latency = decisions.filter((r) => r.latency_ms !== null).map((r) => r.latency_ms);
if (decisions.length) {
  console.log(`decisions:  ${decisions.length}, ${decisions.filter((d) => d.parsed).length} parsed`);
  console.log(`tokens in:  ${tokens}`);
  if (latency.length) {
    const sorted = [...latency].sort((a, b) => a - b);
    console.log(`latency ms: median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted[sorted.length - 1]}`);
  }
}
const verdicts = rows.filter((r) => r.verdict && ["claim", "answer"].includes(r.event));
if (verdicts.length) console.log("claim/answer verdicts:", JSON.stringify(count("verdict")));
