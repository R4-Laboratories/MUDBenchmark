// Tutor is a region: the one authority for learner completions. This world
// never checks a completion itself. It asks Tutor, records the answer, and
// does nothing else with it yet (no reward).
//
// Linking a character to a learner needs both sides: the learner runs
// `tutor region link` at Tutor and gets a one-time code, and the player redeems
// it here with `tutor link <code>`.

import { loadStateFile, saveStateFile } from "./state.mjs";

export const TUTOR_PROTOCOL = "tutor/region-claim/1";
const SCHEMA = "mudbenchmark/tutor-claims/1";
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const CODE = /^[A-Za-z0-9-]{4,16}$/;
const MAX_RESPONSE = 8192;
const UNAVAILABLE = "Tutor is not available right now. Try again later.\r\n";

export function tutorConfig(env = process.env) {
  const raw = env.TUTOR_REGION_URL;
  const secret = env.TUTOR_REGION_SECRET ?? "";
  if (!raw && !secret) return null;
  if (!raw || secret.length < 32) {
    throw new Error("tutor region needs TUTOR_REGION_URL and a TUTOR_REGION_SECRET of at least 32 characters");
  }
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["http:", "https:"].includes(url.protocol) || (!loopback && url.protocol !== "https:") ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("the tutor region needs an HTTPS origin or a loopback HTTP origin");
  }
  return { origin: url.origin, secret, timeoutMs: Number(env.TUTOR_REGION_TIMEOUT_MS ?? 5000) };
}

export async function askTutor(config, path, body, fetchImpl = fetch) {
  const response = await fetchImpl(config.origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
    redirect: "error",
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE) throw new Error("tutor response too large");
  const answer = JSON.parse(text);
  if (!response.ok) return { refused: true, status: response.status };
  if (answer?.protocol !== TUTOR_PROTOCOL) throw new Error("unexpected tutor protocol");
  return answer;
}

export function loadTutorClaims(file) {
  return loadStateFile(file, {
    initial: () => ({ schema: SCHEMA, characters: {} }),
    restore: (raw) => {
      if (raw?.schema !== SCHEMA || typeof raw.characters !== "object" || raw.characters === null) {
        throw new Error("the tutor claim store has an unknown schema");
      }
      return { schema: SCHEMA, characters: raw.characters };
    },
  });
}

export const saveTutorClaims = (file, claims) => saveStateFile(file, claims);

// The first verified answer is kept; asking again never rewrites it.
function record(claims, character, problem, answer, now) {
  const entry = claims.characters[character] ?? (claims.characters[character] = { problems: {} });
  if (entry.problems[problem]) return false;
  entry.problems[problem] = {
    completedAt: answer.completed_at,
    ledgerSeq: answer.ledger_seq,
    ledgerHash: answer.ledger_hash,
    problemHash: answer.problem_hash ?? null,
    recordedAt: now(),
  };
  return true;
}

/** Handle `tutor`, `tutor link <code>` and `tutor claim <problem>` for a signed-in character. */
export async function tutorCommand({ config, claims, character, args, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  if (!config) return { text: "This world has no Tutor server set up, so it cannot check your solution. (Operator: set TUTOR_REGION_URL and TUTOR_REGION_SECRET.)\r\n", changed: false };
  const [action, value] = args;

  if (!action) {
    const problems = Object.keys(claims.characters[character]?.problems ?? {});
    const text = problems.length
      ? `Tutor completions recorded for you: ${problems.join(", ")}.\r\n`
      : "No Tutor completions recorded yet. tutor link <code>, then tutor claim <problem>.\r\n";
    return { text, changed: false };
  }

  try {
    if (action === "link") {
      if (!CODE.test(value ?? "")) return { text: "Usage: tutor link <code> (from `tutor region link` at Tutor).\r\n", changed: false };
      const answer = await askTutor(config, "/region/link", { character, code: value }, fetchImpl);
      return answer.refused
        ? { text: "Tutor refused that code.\r\n", changed: false }
        : { text: "Linked to your Tutor learner. Now: tutor claim <problem>.\r\n", changed: false };
    }

    if (action === "claim") {
      if (!NAME.test(value ?? "")) return { text: "Usage: tutor claim <problem>.\r\n", changed: false };
      const answer = await askTutor(config, "/region/claim", { character, problem_id: value }, fetchImpl);
      if (answer.refused) return { text: "Tutor refused that claim.\r\n", changed: false };
      if (answer.character !== character || answer.problem_id !== value || typeof answer.verified !== "boolean") {
        throw new Error("tutor answered a different claim");
      }
      if (!answer.linked) return { text: "You are not linked to a Tutor learner. tutor link <code> first.\r\n", changed: false };
      if (!answer.verified) return { text: `Tutor has no completion of ${value} for you.\r\n`, changed: false };
      if (typeof answer.completed_at !== "string" || !Number.isSafeInteger(answer.ledger_seq) ||
          !/^[0-9a-f]{64}$/.test(answer.ledger_hash ?? "")) {
        throw new Error("tutor sent an incomplete verification");
      }
      const changed = record(claims, character, value, answer, now);
      return { text: changed ? `Tutor confirms ${value}. Recorded.\r\n` : `Tutor confirms ${value}. Already recorded.\r\n`, changed };
    }
  } catch {
    return { text: UNAVAILABLE, changed: false };
  }

  return { text: "Usage: tutor, tutor link <code>, tutor claim <problem>.\r\n", changed: false };
}
