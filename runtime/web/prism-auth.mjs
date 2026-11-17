// The browser side of a Prism id login.
//
// The id is stitch's Prism id, created and kept in this browser's IndexedDB by
// the pinned module. It never leaves the device except as public records and
// signatures. Sign-in is one `prism/session/1` action for this page's origin;
// the server verifies it in `runtime/prism-auth.mjs`.
//
// Storage is best-effort: a private window can lose IndexedDB, in which case a
// reload makes a new id. The id is never sent to the game server except as the
// public signed session.

import * as Prism from "./prism-id.mjs";

const DB_NAME = "mudbench-prism";
const DB_VERSION = 1;
const STORE = "identities";
const memory = new Map();
let memoryOnly = false;

export const storageMode = () => (memoryOnly ? "memory" : "indexeddb");

const b64u = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
  });
}

async function read(store) {
  // A write in this page is the newest truth; IndexedDB is for the next load.
  // Without this, a linked session saved in memory can be shadowed by a stale
  // IndexedDB record until the page is reloaded.
  if (memory.has(store)) return memory.get(store);
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    memoryOnly = true;
    return memory.get(store) ?? null;
  }
}

async function write(store, value) {
  memory.set(store, value);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // The in-memory copy still works for this page, but a reload will not.
    memoryOnly = true;
  }
}

async function remove(store) {
  memory.delete(store);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(store);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function identity(store = "default") {
  const session = await read(store);
  return session?.prism ?? null;
}

export async function load(store = "default") {
  return read(store);
}

export async function save(store, session) {
  await write(store, session);
}

export async function signIn(store = "default", app = location.origin) {
  // Ask the browser to keep this origin's storage. A denial is not fatal, but
  // it is shown; eviction would otherwise look like a deleted account.
  if (navigator.storage?.persist) {
    try { await navigator.storage.persist(); } catch {}
  }
  let session = await read(store);
  if (!session?.prism || !session?.log) {
    session = await Prism.createPrism({});
    await write(store, session);
  }

  // The session key is a real non-extractable P-256 key. The game server does
  // not need it for the login action, but the protocol expects it and a later
  // per-command signature can use it.
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", keys.publicKey);
  const now = Date.now();
  const expires = now + 10 * 60 * 1000;
  const envelope = await Prism.signAction(
    session,
    "prism/session/1",
    { sessionKey: b64u(raw), expires },
    { audience: app, now },
  );
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) ?? false; } catch {}
  // The main log now carries the persona ids and audiences. The game server
  // only needs the device and revocation records; never send the persona
  // records, so it cannot read the human's other personas.
  const records = [...session.log.values()].filter((record) =>
    !["prism/persona/1", "prism/persona-key/1"].includes(record.body?.kind));
  return { app, envelope, records, persisted, storage: storageMode() };
}

export async function reset(store = "default") {
  await remove(store);
}

// ---------------------------------------------------------------- AI personas

const PERSONA_EPOCH = "mudbench-ai-persona-epoch";
const personaEpoch = () => {
  try { return Math.max(0, Number(localStorage.getItem(PERSONA_EPOCH)) || 0); } catch { return 0; }
};
export const nextPersonaEpoch = () => {
  const next = personaEpoch() + 1;
  try { localStorage.setItem(PERSONA_EPOCH, String(next)); } catch {}
  return next;
};
const personaAudience = (app, epoch) => (epoch ? `${app}#persona-${epoch}` : app);

// The AI is a persona of the human's Prism id. The human signs an owner action
// naming the persona and the game origin; the persona session signs the login.
// The server verifies the owner action against the human's pinned log. The
// human's main log never leaves this browser.
export async function personaSignIn(store = "default", app = location.origin) {
  let session = await read(store);
  if (!session?.prism || !session?.log) return null;
  const epoch = personaEpoch();
  const audience = personaAudience(app, epoch);
  session = await Prism.ensurePersona(session, audience);
  await write(store, session);
  const { persona, records } = await Prism.personaFor(session, audience);
  const owner = await Prism.signAction(
    session,
    "prism/persona-owner/1",
    { persona, audience: app, epoch },
    { audience: app, now: Date.now() },
  );
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const raw = await crypto.subtle.exportKey("raw", keys.publicKey);
  const now = Date.now();
  const envelope = await Prism.signAction(
    { prism: persona, device: session.personaDevices.get(audience) },
    "prism/session/1",
    { sessionKey: b64u(raw), expires: now + 10 * 60 * 1000 },
    { audience: app, now },
  );
  let persisted = false;
  try { persisted = (await navigator.storage?.persisted?.()) ?? false; } catch {}
  return {
    app, envelope, records, owner: { envelope: owner },
    persona, personaAudience: audience, epoch, ownerPrism: session.prism,
    persisted, storage: storageMode(),
  };
}

// Retire the persona: revoke its device in the persona log, sign the retire
// action with the human's main session, and forget the device locally. The
// server tombstones the persona account and its characters; the next start
// uses a new epoch and a new persona.
export async function personaRetire(store = "default", app = location.origin, persona, audience) {
  const session = await read(store);
  if (!session?.prism || !session?.log || !persona || !audience) return null;
  const device = session.personaDevices.get(audience);
  const personaLog = session.personas.get(persona);
  if (device && personaLog) {
    try {
      const personaSession = {
        prism: persona, device, keyring: new Map(), log: personaLog,
        shareable: false, personas: new Map(), personaDevices: new Map(),
      };
      const revoked = await Prism.revokeDevice(personaSession, device.id, { rotate: false });
      const personas = new Map(session.personas).set(persona, revoked.log);
      const personaDevices = new Map(session.personaDevices);
      personaDevices.delete(audience);
      await write(store, { ...session, personas, personaDevices });
    } catch {
      // The server tombstone is still the authority; a local revoke is best effort.
    }
  }
  const envelope = await Prism.signAction(
    session,
    "prism/persona-retire/1",
    { persona, audience: app },
    { audience: app, now: Date.now() },
  );
  return { envelope };
}
