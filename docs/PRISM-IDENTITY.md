# Prism identity as the player account

Status: **implemented in the browser and the server; browser-local until device
linking exists; the legacy password form remains for telnet, CLI and older
accounts.** This records the two identity protocols, the one this project
uses, and the exact server change.

## What the three repositories contain

They are not one protocol. There are two generations:

| Source | Protocol | Authentication |
| --- | --- | --- |
| `afflom/me` (`identity/`) | `prism/identity/1` | A passkey. The account is the hash of the passkey's public key. `id.uor.foundation` runs the WebAuthn ceremony, `registry.uor.foundation/passkey/*` stores key records, and the app receives a seven-day signed session. No password. |
| `uor-foundation/foundry` (`identity/`) and `afflom/stitch` | `prism/identity/4` | A self-sovereign Prism id. The frame makes a non-extractable device key in IndexedDB. There is no sign-in and no account server. A session is a `prism/session/1` signed action naming the app origin. The relay is for linking, recovery and log sync only. |

Foundry's identity README says `identity/4` replaces `identity/1`, `/2` and
`/3`. The id is stitch's Prism id, pinned by commit in `identity/stitch.lock`.

**The public id is not a credential.** A client that sends only a Prism id can
be impersonated by anyone who knows it. The login has to be a signed session
the server verifies.

## Recommendation: stitch's Prism id (`prism/identity/4`)

It is the current protocol, it needs no registry or identity server, and the
verifier runs on a server. This was tested, not assumed:

```text
createPrism({})                              -> sha256:c6c80…
signAction(session, "prism/session/1", …)    -> envelope
verifyAction(prism, log, envelope, {audience}) -> { allowed: true, reason: "ok" }
verifyAction(…, wrong audience)               -> { allowed: false, reason: "audience, replay or time window" }
```

The pinned module (`identity/prism-id.mjs`, 2,777 lines, 69 exports) imports in
Node and exports `createPrism`, `signAction`, `verifyAction`, `logFromRecords`,
`resolvePrism`, `ensurePersona` and `signPersonaAction`. No browser, DOM or
IndexedDB is needed for verification.

## The login flow

The browser:

1. Loads the pinned identity module and the frame (vendored, or the canonical
   module by hash).
2. On first touch, creates or loads the id in IndexedDB `prism-id`.
3. Makes a non-extractable P-256 session key and signs
   `prism/session/1` for `location.origin`, with the session key and an expiry.
4. Sends one WebSocket line: `prism <json>` where the JSON is
   `{ app, envelope, records }` — the same session shape the frame's
   `verifySession` uses. The records are the id's public log.

The server:

1. Parses the session and requires `app === location.origin`, a well-formed
   session key, and an expiry no more than fifteen minutes out. The action
   itself must be within a five-minute window of server time.
2. Rebuilds the log with `logFromRecords(records)`.
3. Calls `verifyAction(body.prism, log, envelope, { audience: app, now,
   window: 5 * 60 * 1000 })`, which checks the action kind, signature,
   audience, replay nonce, time window, device role and revocation.
4. On `allowed`, uses `body.prism` as the account key. A new id creates a new
   actor; a known id restores level, XP, guild and quests.
5. Never sees a password for a Prism account and never stores the id's private
   keys.

The WebSocket is the authenticated session after login. Per-command signatures
are not needed; a reconnect signs a fresh session. A short-lived, age-pruned
`seen` map refuses a replayed envelope. The session key is generated and sent,
but the server does not yet use it for per-command signatures: the login is a
short-lived bearer credential (five-minute window, ten-minute expiry).

**Removed devices are refused once the revocation is pinned.** The server keeps
the public log it has admitted for each Prism id in `identities.json`, next to
the world state, with the same atomic write, backups and fail-loud load. A
presented log must contain every stored record; a newer log may add records.
When a device is revoked, the surviving device's next login presents the newer
log, the server merges and stores the revocation, and the revoked device's
pre-revocation log is refused from then on.

The limit is inherent to a no-relay design: until the server has seen the newer
log it cannot know a device was revoked. The protection is eventual at the next
legitimate login, not instant. Device linking in the browser is X3; the server
mechanism and its gate are in place.

## What is implemented

- `runtime/web/prism-id.mjs` — the pinned Stitch module, copied byte for byte;
  `prism-id.lock.json` names the source commit and the module hash.
- `runtime/web/prism-auth.mjs` — creates or loads the id in IndexedDB, makes a
  non-extractable P-256 session key, and signs `prism/session/1` for the page
  origin.
- `runtime/prism-auth.mjs` — the server verifier: session key and expiry,
  `logFromRecords`, `verifyAction`, a short-lived replay set, and the pinned
  public log (a presented log may add records, never omit one). The pinned logs
  live in `identities.json`, separate from the tick state.
- `server.mjs` — the WebSocket `prism <base64url session>` command. The upgrade
  request's `Origin` is the audience; a successful login creates or restores an
  account keyed by the id and names it `prism:<first 8 hex>`.
- `adopt` — the one-time legacy claim. The signed-in panel has **Claim an old
  name**; the server checks the old password or token, and the reducer merges
  level, XP, guild, quests and mail keys and tombstones the old record. One
  claim per Prism id; the old login refuses with "This account moved".
- `index.html` — **Use my Prism id** is the primary sign-in; the name/password
  form is under **Use a name and password instead**. The AI has its own Prism id
  in the same browser and a **Reset identity** button.
- `world/fixtures/prism-session.json` — a committed signed session. The gate
  verifies it, refuses a session for another origin, and refuses an expired one.
  The gate also proves the reducer creates a passwordless Prism identity.

The browser test confirmed the id survives a reload (the same `prism:…` after a
fresh page) and that the AI signs in as its own `prism:…`, plays, and pauses on
repetition with no console errors.

## The account

The account key is the Prism id. The display is the short id.

```json
{
  "kind": "prism",
  "prism": "sha256:…",
  "name": "prism:9f2c1a3b",
  "level": 3,
  "xp": 120,
  "guild": "…",
  "quests": { "active": [], "completed": [] },
  "created": 1762516800000
}
```

- `prism` is immutable. The display is `prism:<first 8 hex>` for a new account;
  a claimed account displays the old name (`casey`) and keeps the Prism key as
  the account. A handle registry is not built yet, and `who <name>` does not
  exist.
- Items stay world state and are not persisted by identity.
- `kind` is `prism` or `legacy`; older records are typed on the next
  `upgradeState`.

## The AI character

The current implementation gives the AI its **own Prism id**, created in the
same browser under the IndexedDB store `ai`, with a **Reset identity** button.
It is a real Prism player: its own account, its own progress, the same signed
session flow. It is not yet owned by the human's id.

The next step is the **persona** path: `ensurePersona(session, audience)` and
`signPersonaAction(...)` are already exported by the pinned module. One id would
own both the human and the AI, the director chat stays local, and the server
would key the AI account by the persona while the base id remains the owner.
That is a larger change; until it lands, two ids in one browser is the honest
description.

## The frame

The frame (`frame/frame.mjs`) and `prism-id.mjs` are pinned and copied
byte-for-byte in the reference apps. The game can either:

- vendor both modules and serve them from `/frame.mjs` and `/prism-id.mjs`
  (self-contained, larger release);
- load the canonical frame module by its content hash (smaller release, one
  more cross-origin dependency).

The login itself works without the relay for a newly created id. Linking,
recovery and instant revocation need the relay, and the page's `connect-src`
must name it.

## Legacy accounts

`register` and `login` stay for telnet and CLI clients. The browser defaults to
the Prism id. A new id creates a fresh account. An existing name/password
account cannot be claimed yet; the one-time claim is the next identity step
(X1). The browser says the id is browser-local so a player is not surprised by
its loss.

## Tests

The gate proves the committed signed fixture, a wrong origin, an expired
session, a passwordless Prism account, the unauthenticated-takeover refusal,
and state atomicity/backup/fail-loud. A hand test proved create → sign → verify
and that the browser id survives a reload; another proved the AI signs in and
plays under its own id.

The gate also proves the one-time claim: the old name and progression move to
the Prism key, mail and guild keys are aliased, the old credentials are cleared
and tombstoned, a second claim and the old login are refused, the claim survives
a checkpoint, and the account resumes under the old name. A live server test
covered both the password and token claim paths.

The gate proves the pinned log: a linked device can sign in; the surviving
device signs in after a revocation; the merged log contains the revocation; the
revoked device's pre-revocation log is refused; the pin survives a file write
and load; a tampered log is refused. A live server test reproduced the same
sequence and refused the old log again after a restart.

Not yet proven by the gate: a tampered signature, an unknown device, a replay
across a restart, a second connection resuming (today it is refused), device
linking, recovery, revocation, and a production browser through the tunnel.

## Decisions taken

1. **Protocol.** Stitch Prism id (`prism/identity/4`).
2. **Display.** `prism:<first 8 hex>`; the full id is the account key.
3. **Frame.** The game loads the identity module directly (`/prism-id.mjs`) and
   does not vendor the full frame yet. Linking and recovery are later work.
4. **Relay.** The relay is not consulted. The server pins the public log it has
   seen; a device removed elsewhere is refused once a surviving device has
   logged in with the newer log. Before that, the no-relay design cannot know.
5. **Legacy.** The name/password form remains for telnet, CLI and older
   accounts. The one-time `adopt` claim is built; it accepts a password or a
   legacy token, and `casey` is left to its owner.
