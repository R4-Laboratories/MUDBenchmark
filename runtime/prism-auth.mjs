// Verify a Prism id session on the server, and pin the public log.
//
// A Prism id is public; the login is the signed `prism/session/1` action the
// id's device makes for this origin. The pinned module is stitch's, copied
// byte for byte; `prism-id.lock.json` names the commit and the module hash.
//
// The server remembers the public log it has admitted for each id. A presented
// log that omits a record the server has already seen is refused: that is how
// a device revoked elsewhere stops working once another device has logged in
// with the newer log. The server never holds a private key and never invents a
// record; it stores and merges the public records the protocol admits.

import { admitRecords, logFromRecords, logRoot, verifyAction } from "./web/prism-id.mjs";
import { CREDENTIAL, identityAdmits } from "./identity.mjs";

const MAX_SESSION_MS = 15 * 60 * 1000;
const WINDOW_MS = 5 * 60 * 1000;

export function sessionWithinWindow(issued, now, window = WINDOW_MS) {
  return Number.isSafeInteger(issued) && Number.isSafeInteger(now)
    && issued >= now - window && issued <= now + window;
}
const MAX_RECORDS = 64;
const SESSION_ACTION = "prism/session/1";

// The action nonce is single use inside its window. The map is pruned by age,
// not by an arbitrary count; a restart inside the window still permits one
// replay, so the window is kept short.
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

// Verify a human-signed persona owner (or retire) action. The human's public
// log is already pinned by an ordinary game sign-in; the action is verified
// against that pin, so the AI session carries only the persona log and the
// signed action, never the human's other personas.
// Verify the session-key challenge: the client signs `prism/session-key/1
// <nonce> <counter>` with the private key whose public half is in the signed
// session. A stolen login token alone cannot produce this signature.
export async function verifySessionKey(sessionKey, nonce, counter, signature) {
  if (typeof sessionKey !== "string" || !/^[\w-]{87}$/.test(sessionKey)) return false;
  if (typeof nonce !== "string" || !nonce || nonce.length > 128) return false;
  if (!Number.isInteger(counter) || counter < 0) return false;
  if (typeof signature !== "string" || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(sessionKey, "base64url"),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(signature, "base64url"),
      Buffer.from(`prism/session-key/1 ${nonce} ${counter}`, "utf8"),
    );
  } catch {
    return false;
  }
}

export async function verifyPersonaOwner(owner, { origin, persona, action = "prism/persona-owner/1", now = Date.now(), pinned = null } = {}) {
  const envelope = owner?.envelope;
  const body = envelope?.body;
  if (body?.action !== action) return { ok: false, reason: "not a persona owner action" };
  if (body?.payload?.persona !== persona || body?.payload?.audience !== origin) {
    return { ok: false, reason: "the owner action names another persona or origin" };
  }
  if (typeof body.prism !== "string" || !/^sha256:[0-9a-f]{64}$/.test(body.prism)) {
    return { ok: false, reason: "the owner action names no Prism id" };
  }
  const held = Array.isArray(pinned) ? pinned : pinned?.records;
  if (!Array.isArray(held) || held.length === 0) {
    return { ok: false, reason: "the owner has not signed in here; sign in with your Prism id first" };
  }
  let log;
  try {
    log = await logFromRecords(held);
  } catch {
    return { ok: false, reason: "the owner's pinned log does not parse" };
  }
  pruneReplay(now);
  let verdict;
  try {
    verdict = await verifyAction(body.prism, log, envelope, { audience: origin, now, window: WINDOW_MS, seen });
  } catch (error) {
    return { ok: false, reason: `the owner log does not resolve: ${error.message}` };
  }
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };
  return { ok: true, owner: body.prism, device: verdict.device, action };
}

export async function verifyPrismSession(session, { origin, now = Date.now(), pinned = null, revokedBefore = null, blocked = [] } = {}) {
  const { app, envelope, records } = session ?? {};
  // The same eight inputs the proved Identity kernel decides on. The early
  // returns below give the player a precise reason; the final identityAdmits
  // is the shared policy, so a check that is removed here still refuses.
  const flags = {
    presented: CREDENTIAL.prism,
    stored: CREDENTIAL.prism,
    authenticated: false,
    audience: false,
    window: false,
    unseen: false,
    shape: false,
    expiry: false,
  };
  if (typeof app !== "string" || !origin || app !== origin) {
    return { ok: false, reason: "the session names another origin" };
  }
  flags.audience = true;
  const body = envelope?.body;
  if (body?.action !== SESSION_ACTION) return { ok: false, reason: "not a session action" };
  if (typeof body.prism !== "string" || !/^sha256:[0-9a-f]{64}$/.test(body.prism)) {
    return { ok: false, reason: "the session names no Prism id" };
  }
  if (Array.isArray(blocked) && blocked.includes(body.prism)) {
    return { ok: false, reason: "this Prism id is blocked by the operator" };
  }
  if (!Number.isSafeInteger(body.at)) return { ok: false, reason: "the session has no issue time" };
  // A world reset is a revocation point: a session minted before it cannot be
  // replayed to re-pin the identity after the operator removed it.
  if (revokedBefore !== null && Number.isSafeInteger(revokedBefore) && body.at < revokedBefore) {
    return { ok: false, reason: "the session predates the account reset" };
  }
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
  flags.expiry = true;
  if (!sessionWithinWindow(body.at, now)) {
    return { ok: false, reason: "the session is outside the time window" };
  }
  flags.window = true;
  if (!Array.isArray(records) || records.length > MAX_RECORDS) {
    return { ok: false, reason: "the Prism log is too large" };
  }

  let log;
  try {
    log = await logFromRecords(records);
  } catch {
    return { ok: false, reason: "the Prism log does not parse" };
  }
  flags.shape = true;

  // The pin is the set of records already admitted for this id. Every one must
  // still be present; a newer log may add records, never drop them. The merge
  // refuses a second retirement or a fork.
  const held = Array.isArray(pinned) ? pinned : pinned?.records;
  if (Array.isArray(held) && held.length) {
    let known;
    try {
      known = await logFromRecords(held);
    } catch {
      return { ok: false, reason: "the pinned Prism log does not parse" };
    }
    for (const id of known.keys()) {
      if (!log.has(id)) {
        return { ok: false, reason: "the presented log omits a record the server has already seen" };
      }
    }
    try {
      log = await admitRecords(body.prism, known, log);
    } catch (error) {
      return { ok: false, reason: `the pinned Prism log does not merge: ${error.message}` };
    }
  }
  flags.unseen = true;

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
  flags.authenticated = true;
  if (!identityAdmits(flags)) {
    return { ok: false, reason: "the identity policy refused the session" };
  }

  let root;
  try {
    root = await logRoot(log);
  } catch {
    return { ok: false, reason: "the Prism log has no root" };
  }

  return {
    ok: true,
    prism: body.prism,
    display: prismDisplay(body.prism),
    device: verdict.device,
    deviceId: envelope.signer ?? null,
    expires,
    sessionKey,
    records: [...log.values()],
    root,
  };
}
