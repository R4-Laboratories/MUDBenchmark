# Prism identity as the player account

Status: **implemented in the browser and the server; the leaf password form remains
for telnet, CLI and older accounts.** This records the two identity protocols,
the one this project uses, and the exact server change.

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

1. Parses the session and requires `app === location.origin` and a valid
   `expires` no more than eight days out.
2. Rebuilds the log with `logFromRecords(records)`.
3. Calls `verifyAction(body.prism, log, envelope, { audience: app, now,
   window: 60000 })`, which checks the action kind, signature, audience,
   replay nonce, time window, device role and revocation.
4. On `allowed`, uses `body.prism` as the account key. A new id creates a new
   actor; a known id restores level, XP, guild and quests.
5. Never sees a password for a Prism account and never stores the id's private
   keys.

The WebSocket is the authenticated session after login. Per-command signatures
are not needed; a reconnect signs a fresh session. A short-lived `seen` set
refuses a replayed envelope.

**Removed devices.** `verifyAction` checks the log the client presented. A
device removed elsewhere can sign until its session expires unless the server
hears the id's public log. Two options, in order of work:

- require a fresh session per connection (cheap; a removed device is refused
  on its next connect, not instantly);
- fetch the public log topic from the relay and pass `bus` to `verifyAction`
  (instant, but adds the relay dependency).

## What is implemented

- `runtime/web/prism-id.mjs` — the pinned Stitch module, copied byte for byte;
  `prism-id.lock.json` names the source commit and the module hash.
- `runtime/web/prism-auth.mjs` — creates or loads the id in IndexedDB, makes a
  non-extractable P-256 session key, and signs `prism/session/1` for the page
  origin.
- `runtime/prism-auth.mjs` — the server verifier: session key and expiry,
  `logFromRecords`, `verifyAction`, and a short-lived replay set.
- `server.mjs` — the WebSocket `prism <base64url session>` command. The upgrade
  request's `Origin` is the audience; a successful login creates or restores an
  account keyed by the id and names it `prism:<first 8 hex>`.
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

The account key is the Prism id. The display name is a handle bound to it.

```json
{
  "prism": "sha256:…",
  "handle": "casey",
  "level": 3,
  "xp": 120,
  "guild": "…",
  "quests": { "active": [], "completed": [] },
  "created": 1762516800000
}
```

- `prism` is immutable. `handle` is 1–24 characters, unique, and changeable.
- `who` shows `casey (prism:9f2c…)`; the full id is available on `who <name>`.
- Items stay world state and are not persisted by identity.
- The `identities` record in the world state gains a `kind` field:
  `prism` or `legacy`.

## The AI character

The AI should be a **persona of the same Prism id**, not a second identity.
The module already exports `ensurePersona(session, audience)` and
`signPersonaAction(...)` for exactly this. The human's id owns the AI character;
the director chat stays local to the browser; the game server sees the persona
as the player.

A separate id per AI is possible, but it makes ownership and recovery worse.

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
account can be claimed once, by proving the password and then binding the name
as the handle; after that the id is the account and the password is retired for
that character.

## Tests

- Node: create → sign → verify allowed; wrong audience, expired envelope,
  tampered signature, unknown device and replay refused.
- Server: a Prism login creates an actor; the same id on a second connection
  resumes it; a second id is a second character; a bare id is refused; a
  session naming another origin is refused.
- Browser: the frame creates the id, signs the session, the game logs in, and
  the AI persona plays.
- Migration: a legacy account claims once and cannot be claimed again.

## Decisions taken

1. **Protocol.** Stitch Prism id (`prism/identity/4`).
2. **Display.** `prism:<first 8 hex>`; the full id is the account key.
3. **Frame.** The game loads the identity module directly (`/prism-id.mjs`) and
   does not vendor the full frame yet. Linking and recovery are later work.
4. **Relay.** A fresh session per connection; the relay is not consulted, so a
   device removed elsewhere is refused on its next connect, not instantly.
5. **Legacy.** The name/password form remains for telnet, CLI and older
   accounts. A one-time claim of an old account by a Prism id is not built yet.
