// Redaction for the telemetry stream.
//
// The world's state is allowed to contain credentials; the span log is not.
// Every command, intent, state snapshot and error message passes through these
// pure functions before it is written. The rules are deliberately small and
// testable: a secret verb has no text at all, a private speech verb keeps only
// its length, and account credentials are replaced in state copies.

const SECRET_VERBS = new Set([
  "login", "register", "password", "adopt", "prism", "session-key", "rebind", "metric",
]);

const PRIVATE_SPEECH = new Set(["tell", "mail", "guildchat", "gc", "gchat"]);

export function redactCommand(raw) {
  const text = String(raw ?? "");
  const verb = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (SECRET_VERBS.has(verb)) {
    return { verb, text: null, policy: "secret", length: text.length };
  }
  if (verb === "tutor" && text.trim().split(/\s+/)[1]?.toLowerCase() === "link") {
    return { verb, text: null, policy: "secret", length: text.length };
  }
  if (PRIVATE_SPEECH.has(verb)) {
    return { verb, text: null, policy: "metadata", length: text.length };
  }
  return { verb, text: text.slice(0, 500), policy: "public", length: text.length };
}

function redactCredentialFields(object) {
  for (const key of ["passwordHash", "salt", "tokenHash", "secret", "session", "ownerToken"]) {
    if (key in object) object[key] = "[redacted]";
  }
  return object;
}

export function sanitizeIntent(intent) {
  if (!intent || typeof intent !== "object") return intent;
  const copy = { ...intent };
  redactCredentialFields(copy);
  if (typeof copy.token === "string") copy.token = "[redacted]";
  if (typeof copy.text === "string" && ["say", "tell", "mail", "guildChat", "guildchat"].includes(copy.kind)) {
    copy.textLength = copy.text.length;
    copy.text = "[redacted]";
  }
  return copy;
}

export function sanitizeState(state) {
  if (!state || typeof state !== "object") return state;
  const copy = JSON.parse(JSON.stringify(state));
  for (const account of Object.values(copy.accounts ?? {})) redactCredentialFields(account);
  for (const letter of copy.mail ?? []) {
    if (typeof letter.text === "string") {
      letter.textLength = letter.text.length;
      letter.text = "[redacted]";
    }
  }
  return copy;
}

// Error bodies can echo a key or a bearer token. Keep the shape, drop the
// secret-shaped substrings.
export function scrubSecrets(text) {
  return String(text ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/\b(?:password|token|secret|key)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/)[0]}: [redacted]`);
}

// One flat span from an older log. New writes are already redacted; this is
// the migration path for logs written before the policy existed.
export function scrubSpan(span) {
  if (!span || typeof span !== "object") return span;
  const copy = { ...span };
  if (copy.name === "world.input") {
    const redacted = redactCommand(copy.text ?? copy.command ?? "");
    copy["command.verb"] = redacted.verb;
    if (redacted.text === null) delete copy.text;
    else copy.text = redacted.text;
    copy["text.length"] = redacted.length;
    copy["text.policy"] = redacted.policy;
  }
  if (typeof copy["world.intents"] === "string") {
    try {
      copy["world.intents"] = JSON.stringify(JSON.parse(copy["world.intents"]).map(sanitizeIntent));
    } catch {}
  }
  if (copy.name === "world.baseline" && typeof copy["world.state"] === "string") {
    try {
      copy["world.state"] = JSON.stringify(sanitizeState(JSON.parse(copy["world.state"])));
    } catch {}
  }
  if (["world.tell", "world.mail"].includes(copy.name) && typeof copy.text === "string") {
    copy["text.length"] = copy.text.length;
    copy.text = "[redacted]";
  }
  if (copy.name === "world.guild" && copy["guild.action"] === "chat" && typeof copy.text === "string") {
    copy["text.length"] = copy.text.length;
    copy.text = "[redacted]";
  }
  return copy;
}
