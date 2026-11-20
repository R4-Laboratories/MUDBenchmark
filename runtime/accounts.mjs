// Accounts: a name, a password, and nothing a game rule depends on.
//
// Passwords never enter the world state in plaintext and never enter the
// reducer. The server verifies a credential and tells the tick that the
// identity is authenticated; the world only learns who is playing.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Names that imply an operator or a world role are reserved. The legacy set is
// what login refuses; the larger set is what new names refuse. Splitting them
// keeps an existing account with an old reserved word able to sign in.
export const LEGACY_RESERVED_NAMES = new Set(["admin", "administrator", "system", "moderator", "wizard", "staff", "owner", "npc"]);
export const RESERVED_NAMES = new Set([
  ...LEGACY_RESERVED_NAMES,
  "mod", "gm", "gamemaster", "sysadmin", "sysop", "support", "official",
  "operator", "root", "superuser", "helpdesk",
]);

// A new name is checked as a whole and as hyphen/underscore-separated tokens,
// with the usual leetspeak digits folded to letters. Reserved words match
// exactly, with a numeric suffix ("admin2"), or behind "the" ("theadm").
// Ordinary words that merely contain one ("badminton", "wizardry") pass.
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "!": "i" };
const foldName = (value) => value.toLowerCase().replace(/[0134578@$!]/g, (character) => LEET[character]);
const RESERVED_PATTERNS = [...RESERVED_NAMES].map((word) => new RegExp(`^(?:the)?${word}\\d*$`));
const claimsReserved = (name) => {
  const lower = name.toLowerCase();
  const folded = foldName(name);
  const stripDigits = (value) => value.replace(/\d+$/, "");
  const candidates = [lower, folded].flatMap((value) => {
    const variants = [value, stripDigits(value), foldName(stripDigits(value))];
    return variants.flatMap((variant) => [variant.replace(/[-_]+/g, ""), ...variant.split(/[-_]+/)]);
  });
  return candidates.some((token) => RESERVED_PATTERNS.some((pattern) => pattern.test(token)));
};

// The shape check is also used on login, so it stays permissive: a legacy
// one- or two-character name must still be able to sign in. New accounts and
// characters use validNewName, which adds the length, letter and policy checks.
export const validName = (name) => typeof name === "string" && /^[a-z0-9_-]{1,24}$/i.test(name) && !LEGACY_RESERVED_NAMES.has(name.toLowerCase());

export const MIN_NAME_LENGTH = 3;
export const validNewName = (name) =>
  validName(name) && name.length >= MIN_NAME_LENGTH && /[a-z]/i.test(name) && !claimsReserved(name);
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
