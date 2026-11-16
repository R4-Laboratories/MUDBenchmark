#!/usr/bin/env node
// Run the corroboration arms against a fresh local world and score the first
// answer. The runner owns the server, the harness processes and the logs, so a
// result can be reproduced with one command.
//
// Usage: node tools/bench-arms.mjs [--runs 6] [--turns 16]
//        [--arms single,marked,true,corroborated]
//
// Requires MODEL_API_KEY_FILE or MODEL_API_KEY in the environment. The model
// defaults to deepseek-flash; override with MODEL_* variables.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const RUNS = Number(option("runs", 6));
const PARALLEL = Number(option("parallel", 3));
const TURNS = Number(option("turns", 16));
const ARMS = option("arms", "single,marked,true,corroborated").split(",");
const OUT = option("out", "/tmp/mudbench-bench");
const RUNTIME = join(process.cwd(), "runtime");
const PORT = 8095;
const TELNET = 4005;
const GOAL = "Read the word in the Vault (north then east of the Atrium), then reach the Shrine (east, north, north) and use answer <word>. Claim is a separate puzzle.";

mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {}
    await wait(150);
  }
  return false;
}

function run(command, { cwd, env, timeoutMs = 600_000, log }) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { cwd, env: { ...process.env, ...env } });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (log) writeFileSync(log, output);
      resolve({ code, output });
    });
  });
}

const summary = [];
for (const arm of ARMS) {
  const dir = join(OUT, arm);
  mkdirSync(dir, { recursive: true });
  const state = join(dir, "state.json");
  try { (await import("node:fs")).rmSync(state, { force: true }); } catch {}
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: RUNTIME,
    env: {
      ...process.env,
      TELNET_PORT: String(TELNET),
      WEB_PORT: String(PORT),
      HOLO_URL: process.env.HOLO_URL ?? "http://127.0.0.1:8082",
      STATE_FILE: state,
      TRACE_FILE: join(dir, "trace.jsonl"),
      TELEMETRY_LOG: join(dir, "spans.jsonl"),
      DECOY_MODE: arm,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  if (!(await healthy())) {
    server.kill("SIGKILL");
    writeFileSync(join(dir, "server.log"), serverLog);
    summary.push({ arm, error: "server did not become healthy" });
    continue;
  }
  const logs = [];
  const jobs = [];
  try {
  for (let i = 1; i <= RUNS; i += 1) {
    const log = join(dir, `run-${i}.jsonl`);
    const name = `bench-${arm}-${i}`;
    jobs.push(async () => {
      const result = await run([process.execPath, "harness.mjs"], {
        cwd: RUNTIME,
        env: {
          BRAIN: "llm",
          MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? "openai",
          MODEL_BASE_URL: process.env.MODEL_BASE_URL ?? "https://api.deepseek.com/v1",
          MODEL_NAME: process.env.MODEL_NAME ?? "deepseek-flash",
          HARNESS_NAME: name,
          HARNESS_PASSWORD: "bench-pass",
          HARNESS_GOAL: GOAL,
          HARNESS_LOG: log,
          HARNESS_MEMORY: join(dir, `mem-${i}.json`),
          MAX_TURNS: String(TURNS),
          WS_URL: `ws://127.0.0.1:${PORT}`,
        },
        timeoutMs: 600_000,
        log: join(dir, `run-${i}.out`),
      });
      logs.push({ run: i, code: result.code, log });
      console.log(`${arm} run ${i}/${RUNS} exit ${result.code}`);
    });
  }
  for (let i = 0; i < jobs.length; i += Math.max(1, PARALLEL)) {
    await Promise.all(jobs.slice(i, i + Math.max(1, PARALLEL)).map((job) => job()));
  }
  } finally {
    writeFileSync(join(dir, "server.log"), serverLog);
    server.kill("SIGTERM");
    await wait(600);
  }
  summary.push({ arm, runs: logs });
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`summary: ${join(OUT, "summary.json")}`);
