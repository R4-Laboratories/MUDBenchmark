// Aggregate harness runs by arm.
// Usage: node aggregate.mjs /tmp/r-flat-1.jsonl ... /tmp/r-routed-1.jsonl ...

import { readFileSync } from "node:fs";

const arms = { flat: [], routed: [] };

for (const path of process.argv.slice(2)) {
  const arm = path.includes("routed") ? "routed" : "flat";
  const rows = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const decisions = rows.filter((r) => r.event === "decision");
  const solved = rows.find((r) => r.event === "solved");
  arms[arm].push({
    turns: decisions.length,
    solvedAt: solved ? solved.turn : null,
    looks: decisions.filter((r) => r.command.startsWith("look")).length,
    moves: decisions.filter((r) => /^(north|south|east|west)$/.test(r.command)).length,
    parsed: decisions.filter((r) => r.parse_ok).length,
    tokensIn: decisions.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0),
    tokensOut: decisions.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0),
    byTurn: decisions.map((r) => r.usage?.prompt_tokens ?? 0),
  });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (n, d = 1) => Number(n).toFixed(d);

for (const [arm, runs] of Object.entries(arms)) {
  if (!runs.length) continue;
  const solvedRuns = runs.filter((r) => r.solvedAt !== null);
  console.log(`\n${arm}: ${runs.length} runs`);
  console.log(`  solved ${solvedRuns.length}/${runs.length}` +
    (solvedRuns.length ? `  median turns to solve ${fmt(median(solvedRuns.map((r) => r.solvedAt)))}` : ""));
  console.log(`  turns ${fmt(mean(runs.map((r) => r.turns)))}  looks ${fmt(mean(runs.map((r) => r.looks)))}  moves ${fmt(mean(runs.map((r) => r.moves)))}`);
  console.log(`  parsed ${fmt(mean(runs.map((r) => r.parsed / r.turns * 100)))}%`);
  console.log(`  tokens in ${Math.round(mean(runs.map((r) => r.tokensIn)))}  out ${Math.round(mean(runs.map((r) => r.tokensOut)))}`);
  const maxTurn = Math.max(...runs.map((r) => r.byTurn.length));
  const curve = [];
  for (let i = 0; i < Math.min(maxTurn, 10); i += 1) {
    const at = runs.filter((r) => r.byTurn.length > i).map((r) => r.byTurn[i]);
    curve.push(`${i + 1}:${Math.round(mean(at))}`);
  }
  console.log(`  input tokens by turn  ${curve.join("  ")}`);
}
