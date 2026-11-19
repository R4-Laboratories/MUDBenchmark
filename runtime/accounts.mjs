// Accounts: a name, a password, and nothing a game rule depends on.
//
// Passwords never enter the world state in plaintext and never enter the
// reducer. The server verifies a credential and tells the tick that the
// identity is authenticated; the world only learns who is playing.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Names that imply an operator or a world role are reserved. The list is
// deliberately short: it blocks impersonation, not ordinary player names.
export const RESERVED_NAMES = new Set(["admin", "administrator", "system", "moderator", "wizard", "staff", "owner", "npc"]);

export const validName = (name) => typeof name === "string" && /^[a-z0-9_-]{1,24}$/i.test(name) && !RESERVED_NAMES.has(name.toLowerCase());
export const validPassword = (password) =>
  typeof password === "string" && password.length >= 6 && password.length <= 128;

// A cap is a hard ceiling on new accounts, not on existing logins. Zero or a
// negative value means no cap, which is useful for local tests.
export function accountCapReached(count, cap) {
  return Number.isInteger(cap) && cap > 0 && count >= cap;
}

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
