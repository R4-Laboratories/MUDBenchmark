// Verify a Prism id session on the server.
//
// A Prism id is public; the login is the signed `prism/session/1` action the
// id's device makes for this origin. The pinned module is stitch's, copied
// byte for byte; `prism-id.lock.json` names the commit and the module hash.
//
// This verifies; it does not create ids. Creation and device keys live in the
// browser, in `runtime/web/prism-auth.mjs`.

import { logFromRecords, verifyAction } from "./web/prism-id.mjs";

const MAX_SESSION_MS = 8 * 24 * 60 * 60 * 1000;
const SESSION_ACTION = "prism/session/1";

// The action nonce is single use inside its window. A process-local set is
// enough for a login: a replay after a restart still has to be inside the
// sixty-second window and carry a fresh session expiry.
const seen = new Set();
let seenCount = 0;

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

  let log;
  try {
    log = await logFromRecords(records);
  } catch {
    return { ok: false, reason: "the Prism log does not parse" };
  }

  let verdict;
  try {
    verdict = await verifyAction(body.prism, log, envelope, {
      audience: app,
      now,
      window: 60000,
      seen,
    });
  } catch (error) {
    return { ok: false, reason: `the Prism log does not resolve: ${error.message}` };
  }
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  seenCount += 1;
  if (seenCount > 10000) {
    seen.clear();
    seenCount = 0;
  }
  return { ok: true, prism: body.prism, display: prismDisplay(body.prism), device: verdict.device, expires };
}
