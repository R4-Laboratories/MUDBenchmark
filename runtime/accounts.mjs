// Accounts: a name, a password, and nothing a game rule depends on.
//
// Passwords never enter the world state in plaintext and never enter the
// reducer. The server verifies a credential and tells the tick that the
// identity is authenticated; the world only learns who is playing.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const validName = (name) => typeof name === "string" && /^[a-z0-9_-]{1,24}$/i.test(name);
export const validPassword = (password) =>
  typeof password === "string" && password.length >= 6 && password.length <= 128;

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 32).toString("hex") };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
