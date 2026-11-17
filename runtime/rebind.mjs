// Owner-authorized rebind for a legacy account that has no credential.
//
// Three accounts on the live world have neither a password nor a token. They
// cannot be claimed by the ordinary `adopt` path because there is nothing to
// prove ownership with. The operator holds one owner token, set on the world
// unit as `MUDBENCH_OWNER_TOKEN`, and uses it on the local console to choose
// one of two outcomes per account:
//
//   token  Issue a one-time delivery token. Only its SHA-256 hash is stored;
//          the plaintext is written once by the operator's tool. The account
//          is then an ordinary legacy account: login with the token, play, and
//          adopt it into a Prism account with the same token.
//
//   prism  Move the legacy character onto an existing Prism account at once.
//          The character keeps its progress, guild and quests; the legacy
//          account is retired with a `mergedInto` tombstone. No secret is
//          created.
//
// A rebind never touches an account that already has a credential: that
// account has a working login and uses `adopt`. It never moves a character
// that is online, because the live actor would keep the old owner.

import { createHash, timingSafeEqual } from "node:crypto";

export const REBIND_MODES = ["token", "prism"];

export function tokenHash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validTokenHash(hash) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

export function normalizePrismId(value) {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^sha256:/, "");
  return /^[0-9a-f]{64}$/.test(hex) ? `sha256:${hex}` : null;
}

// Constant-time comparison of the operator token. A missing or empty value is
// refused before the comparison, so an unset environment variable cannot turn
// into an empty-token bypass.
export function ownerAllowed(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// The policy, separate from the reducer. `account` is the legacy account;
// `targetAccount` is the Prism account for the prism mode. The reducer repeats
// these checks because an intent can arrive from anywhere in the queue.
export function rebindPlan(account, request = {}, targetAccount = null) {
  const refuse = (why) => ({ ok: false, why });
  if (!account || typeof account !== "object") return refuse("no such account");
  if (account.kind !== "legacy") return refuse("not a legacy account");
  if (account.retired || account.mergedInto) return refuse("the account has already moved");
  if (account.passwordHash || account.tokenHash) {
    return refuse("the account already has a credential; sign in and adopt it");
  }

  if (request.mode === "token") {
    if (!validTokenHash(request.tokenHash)) return refuse("the token hash is not 64 lowercase hex");
    return { ok: true, mode: "token", tokenHash: request.tokenHash };
  }

  if (request.mode === "prism") {
    const prism = normalizePrismId(request.prism);
    if (!prism) return refuse("the Prism id is not 64 lowercase hex");
    if (!targetAccount) return refuse("the target Prism account has not signed in");
    if (targetAccount.kind !== "prism") return refuse("the target is not a Prism account");
    if (targetAccount.retired) return refuse("the target Prism account is retired");
    if ((targetAccount.characters ?? []).includes(request.name)) {
      return refuse("the character is already on the target account");
    }
    return { ok: true, mode: "prism", prism };
  }

  return refuse("the rebind mode is token or prism");
}
