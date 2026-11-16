// Verify a Prism id session on the server.
//
// A Prism id is public; the login is the signed `prism/session/1` action the
// id's device makes for this origin. The pinned module is stitch's, copied
// byte for byte; `prism-id.lock.json` names the commit and the module hash.
//
// This verifies; it does not create ids. Creation and device keys live in the
// browser, in `runtime/web/prism-auth.mjs`.

import { logFromRecords, verifyAction } from "./web/prism-id.mjs";

const MAX_SESSION_MS = 15 * 60 * 1000;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_RECORDS = 64;
const SESSION_ACTION = "prism/session/1";

// The action nonce is single use inside its window. The map is pruned by age,
// not by an arbitrary count: a restart inside the window still permits one
// replay, so the window is kept short and the log pinning (the next step)
// addresses the remaining gap.
const replay = new Map();
const seen = {
  has: (key) => replay.has(key),
  add: (key) => { replay.set(key, Date.now()); },
};
function pruneReplay(now) {
  for (const [key, at] of replay) {
    if (now - at > WINDOW_MS) replay.delete(key);
  }
}

export function prismDisplay(prism) {
  const hex = String(prism).replace(/^sha256:/, "");
  return `prism:${hex.slice(0, 8)}`;
}

export async function verifyPrismSession(session, { origin, now = Date.now() } = {}) {
  const { app, envelope, records } = session ?? {};
  if (typeof app !== "string" || !origin || app !== origin) {
    return { ok: false, reason: "the session names another origin" };
  }
  const body = envelope?.body;
  if (body?.action !== SESSION_ACTION) return { ok: false, reason: "not a session action" };
  if (typeof body.prism !== "string" || !/^sha256:[0-9a-f]{64}$/.test(body.prism)) {
    return { ok: false, reason: "the session names no Prism id" };
  }
  if (!Number.isSafeInteger(body.at)) return { ok: false, reason: "the session has no issue time" };
  const { sessionKey, expires } = body.payload ?? {};
  if (typeof sessionKey !== "string" || !/^[\w-]{87}$/.test(sessionKey)) {
    return { ok: false, reason: "the session key is malformed" };
  }
  if (!Number.isSafeInteger(expires) || expires <= now) {
    return { ok: false, reason: "the session has expired" };
  }
  if (expires > body.at + MAX_SESSION_MS) {
    return { ok: false, reason: "the session lasts too long" };
  }
  if (!Array.isArray(records) || records.length > MAX_RECORDS) {
    return { ok: false, reason: "the Prism log is too large" };
  }

  let log;
  try {
    log = await logFromRecords(records);
  } catch {
    return { ok: false, reason: "the Prism log does not parse" };
  }

  pruneReplay(now);
  let verdict;
  try {
    verdict = await verifyAction(body.prism, log, envelope, {
      audience: app,
      now,
      window: WINDOW_MS,
      seen,
    });
  } catch (error) {
    return { ok: false, reason: `the Prism log does not resolve: ${error.message}` };
  }
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  return {
    ok: true,
    prism: body.prism,
    display: prismDisplay(body.prism),
    device: verdict.device,
    deviceId: envelope.signer ?? null,
    expires,
  };
}
