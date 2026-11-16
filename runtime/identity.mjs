// The identity policy in JavaScript, paired with the proved Identity kernel.
//
// The model proves the decision: a credential is admitted exactly when its kind
// matches the record, the proof authenticated, the audience and window match,
// the log is fresh, the id is well formed and the expiry is in bounds. The
// server keeps this implementation because login must not depend on the holo
// being up; the gate replays the kernel's fixtures through this file and checks
// the same requests and responses in world/src/MudBench.lex.tex. If the two
// ever disagree, the gate is red before a release.

export const CREDENTIAL = Object.freeze({
  none: 0,
  password: 1,
  token: 2,
  prism: 3,
});

// Kinds are exact: a password is not a token, a token is not a Prism session,
// and "no credential" matches nothing.
export function credentialHolds(presented, stored) {
  return presented !== CREDENTIAL.none && presented === stored;
}

export function identityAdmits({
  presented,
  stored,
  authenticated,
  audience,
  window,
  unseen,
  shape,
  expiry,
}) {
  return Boolean(
    credentialHolds(presented, stored) &&
    authenticated &&
    audience &&
    window &&
    unseen &&
    shape &&
    expiry,
  );
}

// The kind-7 request: kind, presented, stored, then six 0/1 flags.
export const IDENTITY_KIND = 7;

export function identityRequest(flags) {
  return [
    IDENTITY_KIND,
    flags.presented,
    flags.stored,
    flags.authenticated ? 1 : 0,
    flags.audience ? 1 : 0,
    flags.window ? 1 : 0,
    flags.unseen ? 1 : 0,
    flags.shape ? 1 : 0,
    flags.expiry ? 1 : 0,
  ];
}

// Decode a request exactly as the model's flagAt does: a flag is true only when
// its byte is 1. Anything else, including 2, is false.
export function decodeIdentityRequest(bytes) {
  if (!bytes || bytes.length !== 9 || bytes[0] !== IDENTITY_KIND) return null;
  return {
    presented: bytes[1],
    stored: bytes[2],
    authenticated: bytes[3] === 1,
    audience: bytes[4] === 1,
    window: bytes[5] === 1,
    unseen: bytes[6] === 1,
    shape: bytes[7] === 1,
    expiry: bytes[8] === 1,
  };
}

export function identityVerdict(bytes) {
  const flags = decodeIdentityRequest(bytes);
  if (!flags) return "invalid request";
  return identityAdmits(flags) ? "admissible" : "refused";
}
