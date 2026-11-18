import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { redactCommand } from "./telemetry-policy.mjs";
import { loadTutorClaims, saveTutorClaims, tutorCommand, tutorConfig } from "./tutor-region.mjs";

const SECRET = "t".repeat(40);
const HASH = "a".repeat(64);

// A stand-in for the Tutor region: it holds the truth and the MUD only asks.
async function fakeTutor() {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
      const reply = (status, json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${SECRET}`) return reply(401, { error: "unauthorized" });
      const { character, problem_id: problem, code } = JSON.parse(body);
      if (req.url === "/region/link") return code === "GOOD-CODE" ? reply(200, { protocol: "tutor/region-claim/1", linked: true }) : reply(400, { error: "refused" });
      const answer = { protocol: "tutor/region-claim/1", character, problem_id: problem, linked: character === "alia", verified: problem === "000a" };
      if (answer.linked && answer.verified) Object.assign(answer, { completed_at: "2026-01-01T00:00:00+00:00", ledger_seq: 3, ledger_hash: HASH });
      reply(200, answer);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = tutorConfig({ TUTOR_REGION_URL: `http://127.0.0.1:${server.address().port}/`, TUTOR_REGION_SECRET: SECRET });
  return { server, config, seen };
}

test("the MUD asks Tutor, records a yes once, and never invents one", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tutor-claims-"));
  const { server, config, seen } = await fakeTutor();
  t.after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });
  const file = join(dir, "claims.json");
  const claims = loadTutorClaims(file);
  const run = (character, args) => tutorCommand({ config, claims, character, args, now: () => "now" });

  assert.match((await run("alia", ["link", "BAD-CODE"])).text, /refused/);
  assert.match((await run("alia", ["link", "GOOD-CODE"])).text, /Linked/);
  assert.match((await run("bob", ["claim", "000a"])).text, /not linked/);
  assert.match((await run("alia", ["claim", "999"])).text, /no completion/);
  assert.deepEqual(claims.characters, {});

  const first = await run("alia", ["claim", "000a"]);
  assert.equal(first.changed, true);
  assert.equal(claims.characters.alia.problems["000a"].ledgerSeq, 3);
  const again = await run("alia", ["claim", "000a"]);
  assert.equal(again.changed, false);
  assert.match(again.text, /Already recorded/);

  saveTutorClaims(file, claims);
  assert.equal(loadTutorClaims(file).characters.alia.problems["000a"].ledgerHash, HASH);
  assert.ok(seen.every((call) => call.auth === `Bearer ${SECRET}`));
});

test("an unreachable or wrong Tutor never records anything", async () => {
  const claims = { schema: "mudbenchmark/tutor-claims/1", characters: {} };
  const down = tutorConfig({ TUTOR_REGION_URL: "http://127.0.0.1:1/", TUTOR_REGION_SECRET: SECRET, TUTOR_REGION_TIMEOUT_MS: "500" });
  const result = await tutorCommand({ config: down, claims, character: "alia", args: ["claim", "000a"] });
  assert.match(result.text, /not available/);
  const lying = async () => new Response(JSON.stringify({ protocol: "tutor/region-claim/1", character: "other", problem_id: "000a", linked: true, verified: true }), { status: 200 });
  const wrong = await tutorCommand({ config: down, claims, character: "alia", args: ["claim", "000a"], fetchImpl: lying });
  assert.match(wrong.text, /not available/);
  assert.deepEqual(claims.characters, {});
});

test("configuration refuses weak secrets and plain remote HTTP, and link codes are not logged", () => {
  assert.equal(tutorConfig({}), null);
  assert.throws(() => tutorConfig({ TUTOR_REGION_URL: "https://tutor.example/", TUTOR_REGION_SECRET: "short" }));
  assert.throws(() => tutorConfig({ TUTOR_REGION_URL: "http://tutor.example/", TUTOR_REGION_SECRET: SECRET }));
  const redacted = redactCommand("tutor link ABCD-2345");
  assert.equal(redacted.text, null);
  assert.equal(redacted.policy, "secret");
  assert.equal(redactCommand("tutor claim 000a").policy, "public");
});
