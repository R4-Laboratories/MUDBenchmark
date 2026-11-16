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
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(store);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
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
    // The in-memory copy still works for this page.
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

export async function signIn(store = "default", app = location.origin) {
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
  const expires = now + 7 * 24 * 60 * 60 * 1000;
  const envelope = await Prism.signAction(
    session,
    "prism/session/1",
    { sessionKey: b64u(raw), expires },
    { audience: app, now },
  );
  return { app, envelope, records: [...session.log.values()] };
}

export async function reset(store = "default") {
  await remove(store);
}
