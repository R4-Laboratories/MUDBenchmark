// Federated regions, protocol 2.
//
// A handoff is a Prism-signed character grant plus a source-region attestation.
// No password, password hash or salt crosses a region boundary. A legacy
// password account must be claimed by a Prism id before it can travel.

import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { SPELLS } from "./magic.mjs";
import { verifyPrismAction } from "./prism-auth.mjs";

const REGION = /^[a-z0-9_-]{1,32}$/;
const MAX_BODY = 128 * 1024;
const MAX_RECEIVED = 64;
export const FEDERATION_PROTOCOL = "mudbenchmark/region-transfer/2";
export const TRAVEL_ACTION = "mudbenchmark/region-travel/1";

export function rulesFingerprint() {
  const files = [
    "./world.mjs", "./generated/Pulses.mjs", "./levels.mjs", "./quests.mjs",
    "./guilds.mjs", "./equipment.mjs", "./magic.mjs", "./techniques.mjs",
    "./factions.mjs", "./forge.mjs", "./prism-auth.mjs", "./web/prism-id.mjs",
    "../world/data/levels.json", "../world/data/quests.json", "../world/data/world.json",
  ];
  const hash = createHash("sha256");
  for (const file of files) {
    const bytes = readFileSync(new URL(file, import.meta.url));
    hash.update(`${file}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function federationConfig(env = process.env) {
  const id = env.MUD_REGION_ID;
  const raw = env.MUD_REGION_PEERS;
  if (!id && !raw) return null;
  if (!REGION.test(id ?? "") || !raw) throw new Error("federation requires a valid MUD_REGION_ID and MUD_REGION_PEERS");
  if (!env.MUD_REGION_ORIGIN) throw new Error("federation requires MUD_REGION_ORIGIN");
  const origin = new URL(env.MUD_REGION_ORIGIN);
  const originLoopback = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "[::1]";
  if ((!originLoopback && origin.protocol !== "https:") || !["http:", "https:"].includes(origin.protocol) ||
      origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("MUD_REGION_ORIGIN requires an HTTPS origin or a loopback HTTP origin");
  }
  const entries = JSON.parse(raw);
  if (!entries || Array.isArray(entries) || typeof entries !== "object") throw new Error("invalid federation peers");
  const peers = Object.create(null);
  for (const [name, peer] of Object.entries(entries)) {
    if (!REGION.test(name) || name === id || typeof peer?.secret !== "string" || peer.secret.length < 32) {
      throw new Error(`invalid federation peer ${name}`);
    }
    const url = new URL(peer.url);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((!loopback && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error(`peer ${name} requires an HTTPS origin or a loopback HTTP origin`);
    }
    const publicKey = createPublicKey(peer.publicKey);
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error(`peer ${name} needs an Ed25519 key`);
    peers[name] = { url: url.origin, secret: peer.secret, publicKey };
  }
  const rules = rulesFingerprint();
  if (env.MUD_REGION_RULES !== rules) throw new Error("local game rules do not match MUD_REGION_RULES");
  const privateKey = createPrivateKey(readFileSync(env.MUD_REGION_SIGNING_KEY_FILE));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("region needs an Ed25519 signing key");
  const allowedSkills = env.MUD_REGION_ALLOWED_SKILLS === undefined
    ? SPELLS.map((spell) => spell.id)
    : JSON.parse(env.MUD_REGION_ALLOWED_SKILLS);
  if (!Array.isArray(allowedSkills) || allowedSkills.some((id) => !SPELLS.some((spell) => spell.id === id))) {
    throw new Error("MUD_REGION_ALLOWED_SKILLS must be an array of known skill IDs");
  }
  const maxAccounts = env.MUD_REGION_MAX_ACCOUNTS === undefined ? 2000 : Number(env.MUD_REGION_MAX_ACCOUNTS);
  if (!Number.isInteger(maxAccounts) || maxAccounts < 1) throw new Error("MUD_REGION_MAX_ACCOUNTS must be a positive integer");
  return { id, origin: origin.origin, peers, protocol: FEDERATION_PROTOCOL, rules, privateKey, allowedSkills: new Set(allowedSkills), maxAccounts };
}

export const skillAllowed = (config, id) => !config || config.allowedSkills.has(id);

export function signClaim(config, claim) {
  return sign(null, Buffer.from(JSON.stringify(claim)), config.privateKey).toString("base64url");
}

export function verifyClaim(config, issuer, claim, signature) {
  if (!config?.peers?.[issuer] || !claim || typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  return verify(null, Buffer.from(JSON.stringify(claim)), config.peers[issuer].publicKey, Buffer.from(signature, "base64url"));
}

export async function verifyTravelGrant(config, grant, { destinationOrigin, expected = {}, pinned = null } = {}) {
  if (!config) return { ok: false, reason: "federation is not configured" };
  if (!grant || typeof grant !== "object") return { ok: false, reason: "the travel grant is missing" };
  const verdict = await verifyPrismAction(grant.envelope, {
    origin: destinationOrigin,
    records: grant.records ?? [],
    pinned,
    action: TRAVEL_ACTION,
    expected,
  });
  if (!verdict.ok) return verdict;
  if (verdict.payload?.region !== expected.region) return { ok: false, reason: "the grant names another region" };
  if (verdict.payload?.audience !== destinationOrigin) return { ok: false, reason: "the grant names another audience" };
  return { ...verdict, records: grant.records ?? [] };
}

export function authenticatedPeer(config, headers) {
  const name = headers["x-mud-region"];
  if (typeof name !== "string") return null;
  const peer = config?.peers[name];
  if (!peer || typeof peer.secret !== "string" || typeof headers.authorization !== "string") return null;
  const supplied = headers.authorization.startsWith("Bearer ") ? headers.authorization.slice(7) : "";
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(supplied), hash(peer.secret)) ? name : null;
}

export async function requestPeer(config, name, path, body) {
  const peer = config.peers[name];
  if (!peer) throw new Error("unknown region");
  const response = await fetch(new URL(path, peer.url), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${peer.secret}`,
      "x-mud-region": config.id,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "peer refused transfer");
  return result;
}

export async function readFederationBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("transfer too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function appendReceived(previous, transferId) {
  const list = Array.isArray(previous) ? previous : [];
  if (list.includes(transferId)) return list;
  return [...list, transferId].slice(-MAX_RECEIVED);
}
