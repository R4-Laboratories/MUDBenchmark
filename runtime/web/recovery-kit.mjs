// The recovery kit: a passphrase-encrypted file carrying a Prism recovery
// share and the public log. The share is the secret that lets a new device
// recover the id; the log is what the new device resolves. The file is an
// offline backup, never sent to the server.

const SCHEMA = "mudbenchmark/recovery-kit/1";
const PAYLOAD = "mudbenchmark/recovery-payload/1";
const KDF = "PBKDF2-SHA-256";
const ITERATIONS = 600000;
const MIN_PASSPHRASE = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64 = (bytes) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64 = (text) => {
  const padded = String(text).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealKit(payload, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    schema: SCHEMA,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(ciphertext)),
  };
}

export async function openKit(kit, passphrase) {
  if (kit?.schema !== SCHEMA || kit?.kdf !== KDF) throw new Error("This is not a MUDBench recovery kit.");
  const iterations = Number(kit.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000) throw new Error("The kit's key derivation is not acceptable.");
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE) throw new Error("The passphrase is too short.");
  let salt;
  let iv;
  let ciphertext;
  try {
    salt = unb64(kit.salt);
    iv = unb64(kit.iv);
    ciphertext = unb64(kit.ciphertext);
  } catch {
    throw new Error("The kit is damaged.");
  }
  const key = await deriveKey(passphrase, salt);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("The passphrase is wrong or the kit is damaged.");
  }
  let payload;
  try {
    payload = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("The kit payload is damaged.");
  }
  if (payload?.schema !== PAYLOAD || typeof payload.prism !== "string" || !/^sha256:[0-9a-f]{64}$/.test(payload.prism)
    || !Array.isArray(payload.records) || !Array.isArray(payload.shares)) {
    throw new Error("The kit payload is incomplete.");
  }
  return payload;
}

export const RECOVERY_KIT_SCHEMA = SCHEMA;
export const RECOVERY_PAYLOAD_SCHEMA = PAYLOAD;
