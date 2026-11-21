#!/usr/bin/env node
// R4 memory service benchmark.
//
//   node tools/r4-bench.mjs --url http://127.0.0.1:8000 --count 100
//
// Seeds a few game facts under a bench identity, then measures scoped
// retrieval. The service must keep game memory separate from the shared wiki.

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = (option("url", "http://127.0.0.1:8000")).replace(/\/+$/, "");
const identity = option("identity", "prism:bench:r4");
const count = Math.max(1, Math.min(500, Number(option("count", 100)) || 100));
const limit = Math.max(1, Math.min(12, Number(option("limit", 6)) || 6));

const facts = [
  "The Atrium plaque reads: the Vault keeps the word. The Vault is north then east.",
  "The Corridor has an oaken chest; it contains a copper coin and a curled scroll.",
  "The Vault door is grey wood and the word carved into it is AMBER.",
  "The Shrine accepts the true word. The shrine keeper listens without speaking.",
  "The Storeroom shopkeeper sells a short sword and a leather jerkin for coins.",
  "The Gilded Rat innkeeper sells stew for three coins and bread for less.",
  "The Mages' Guild is above the Atrium; the archmage trains spells there.",
  "The harbor lighthouse keeper needs a lens from the docks.",
  "The Ember Deep is behind the Quiet Door; the last lantern opens it.",
  "The first flame is at the end of the Ember Deep; the ember warden guards it.",
  "The wild boar roams the wilds and drops a tusk.",
  "The crypt ghoul is in the undercroft and the guild clerk wants it defeated.",
];

const queries = [
  "What does the plaque in the Atrium say about the Vault?",
  "What is inside the oaken chest in the Corridor?",
  "What word is carved into the Vault door?",
  "Where does the Shrine keeper wait and what does the shrine accept?",
  "Who sells a short sword and what does it cost?",
  "What does the innkeeper at the Gilded Rat sell?",
  "Where is the Mages' Guild and who trains spells?",
  "What does the lighthouse keeper need?",
  "How do I open the Quiet Door to the Ember Deep?",
  "What guards the first flame?",
  "Which creature drops a tusk in the wilds?",
  "Who wants the crypt ghoul defeated?",
  "What is the true word and where is it answered?",
  "Which shop has a leather jerkin?",
  "Where is the copper coin?",
  "What is the path from the Atrium to the Vault?",
  "Who is the archmage and what is the guild?",
  "What is the last lantern used for?",
  "Where is the ember warden?",
  "What does the guild clerk ask for?",
];

const post = async (path, body) => {
  const started = performance.now();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, ms: performance.now() - started, data, text };
};

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

if (args.includes("--seed")) {
  for (const fact of facts) {
    const seeded = await post("/api/remember", { identity, text: fact });
    if (!seeded.ok) {
      console.error(`seed failed (${seeded.status}): ${seeded.text.slice(0, 160)}`);
      process.exit(1);
    }
  }
}

const latencies = [];
const empty = [];
const examples = [];
let failures = 0;
for (let index = 0; index < count; index += 1) {
  const query = `${queries[index % queries.length]} (run ${index + 1})`;
  const result = await post("/api/context", { identity, text: query, limit });
  if (!result.ok) {
    failures += 1;
    continue;
  }
  const latency = Number(result.data?.latency_ms ?? result.ms);
  latencies.push(latency);
  const concepts = result.data?.concepts ?? [];
  if (!concepts.length) empty.push(query);
  if (examples.length < 8) examples.push({ query, latency_ms: Math.round(latency), top: concepts[0]?.text?.slice(0, 130) ?? null });
}

const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);
const max = latencies.length ? Math.max(...latencies) : null;
const report = {
  url,
  identity,
  count,
  ok: latencies.length,
  failures,
  empty: empty.length,
  p50_ms: p50 === null ? null : Math.round(p50),
  p95_ms: p95 === null ? null : Math.round(p95),
  max_ms: max === null ? null : Math.round(max),
  avg_ms: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
  examples,
};
console.log(JSON.stringify(report, null, 2));
if (failures > 0 || empty.length > 0 || (p95 !== null && p95 > 150)) {
  console.error(`r4-bench: FAIL (p95 ${report.p95_ms}ms, empty ${empty.length}, failures ${failures})`);
  process.exit(1);
}
console.log("r4-bench: PASS");
