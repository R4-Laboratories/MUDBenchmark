# Prism identity as the player account

Status: **implemented in the browser and the server; device linking, takeover
and reconnect exist; the admission decision is proved in the model (X5); the AI
is a persona owned by the human's account (L1); an encrypted recovery kit
restores the account on a new device.** The legacy password form remains for
telnet, CLI and older accounts. This records
the two identity protocols, the one this project uses, and the exact server
change.

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
  request's `Origin` is the audience; a successful sign-in is the **account**,
  and the client then chooses a character. `characters` lists them, `play
  <name>` enters one and `create <name>` adds one. The character name is the
  in-game name; the account label is `prism:<first 8 hex>`.
- `adopt` — the one-time legacy claim. The signed-in panel has **Claim an old
  name**; the server checks the old password or token, and the reducer merges
  level, XP, guild, quests and mail keys and tombstones the old record. One
  claim per Prism id; the old login refuses with "This account moved".
- `index.html` — **Use my Prism id** is the primary sign-in; the name/password
  form is under **Use a name and password instead**. The AI has its own Prism id
  in the same browser and a **Reset identity** button.
- **Prism devices** — the signed-in panel can create an out-of-band link offer
  (URI and QR), paste the new device's request and six-digit code, show the
  response, join from another browser, list the id's devices and revoke one.
- **Takeover and reconnect** — a second login for the same id (Prism or legacy)
  tells the old socket "You have been signed in elsewhere", closes it, and lets
  the old actor leave before the new login. The old page clears its session and
  shows the notice; **Use my Prism id** takes the account back. The browser
  re-signs with a fresh `prism/session/1` after a network drop or a server
  restart without a click. The AI signs a fresh session on every socket open and
  reconnects after a close while running; a takeover stops it. A WebSocket
  ping/pong every 30 seconds terminates a socket that stops answering, so a
  stale tab cannot block a takeover.
- `world/fixtures/prism-session.json` — a committed signed session. The gate
  verifies it, refuses a session for another origin, and refuses an expired one.
  The gate also proves the reducer creates a passwordless Prism identity.

The browser test confirmed the id survives a reload (the same `prism:…` after a
fresh page) and that the AI signs in as its own `prism:…`, plays, and pauses on
repetition with no console errors.

## The Identity kernel

The admission decision is proved, not only implemented:

- `world/src/Identity.lex.tex` — `credentialHolds presented stored` refuses a
  kind mismatch, so a password never matches a passwordless record. `admitted
  presented stored authenticated audience window unseen shape expiry` is one
  decision over the eight inputs. Eight refusal theorems hold with every other
  check true: a password offered to a passwordless record, no credential, an
  unauthenticated proof, a foreign audience, a session outside the window, a
  stale log at the pin, a malformed id and an expired session are each refused.
  `prismpm verify` proves all eight; `provedTheorems` rises from 7 to 15.
- `world/src/MudBench.lex.tex` — kind 7 is a nine-byte request: kind, presented
  kind, stored kind, then six 0/1 flags. `identityVerdict` calls
  `Identity::admitted`. The app's `requestMaximum` is 9 and the acceptance
  vectors cover every one-false case plus a flag that is neither 0 nor 1.
- `runtime/identity.mjs` — the JavaScript twin: `credentialHolds`,
  `identityAdmits`, the encoder and a decoder that treats only 1 as true.
  Login never calls the holo; `adopt` does. The server checks the local policy,
  asks the holo with kind 7, and refuses the claim when the kernel is
  unavailable or refuses.
- `world/data/identity-vectors.json` and `world/identity-receipt.json` — the
  fixture and the gate's receipt: kernel hash, app hash, fixture hash and every
  verdict. The gate decodes each request with the JavaScript twin, checks the
  same request and response in the model, plants a flipped vector to prove the
  check fails, and writes the receipt; the release carries it.

## The account and its characters

The Prism id is the account. It is a small record in `state.accounts`:

```json
{
  "kind": "prism",
  "characters": ["casey", "scout"],
  "claimedFrom": "casey"
}
```

A character is the in-game name and the record that owns progression:

```json
{
  "kind": "character",
  "owner": "sha256:…",
  "name": "casey",
  "level": 5,
  "xp": 500,
  "guild": "keepers",
  "guildRank": "officer",
  "quests": { "active": [], "completed": ["scroll"] }
}
```

- The Prism key is immutable; the account label is `prism:<first 8 hex>`.
- Signing in with the Prism id shows the character list. `play <name>` enters
  one; `create <name>` adds one. A second `play` for a character already online
  takes it over and closes the old socket.
- `register`/`login` create or return a legacy account with one character, the
  name itself. Legacy credentials live on the account, not the character.
- `adopt <old-name> <secret>` adds the legacy character to the Prism account and
  retires the legacy account. It keeps its own level, guild, quests and mail; it
  is not merged into another character. One claim per Prism account.
- The migration from v0.32 gives every existing identity one account and one
  character. Items stay world state and are not persisted by the character.

## Recovery kit

A signed-in account can download an **encrypted recovery kit** from the
signed-in panel. The kit holds a one-of-one **paper recovery share** and the
public Prism log (plus any persona logs the session carries), sealed with
PBKDF2-SHA-256 and AES-GCM under a passphrase of at least 12 characters. The
server never sees the kit or the share.

On a new browser, **Restore from a recovery kit** takes the file and
passphrase. The protocol's `recoverPrism` combines the share into the recovery
device, binds the new browser as a member, and revokes every other device. The
account and its characters live on the server, so they come back with the id.
The old browser is refused: its log omits the recovery records, so the pin says
"the presented log omits a record the server has already seen".

- A wrong passphrase or a tampered file is refused before any recovery.
- The account is not duplicated; the same Prism id and characters return.
- Create the kit **before** starting an AI persona if you want the persona
  included. `ensurePersona` seals the persona recovery to the main recovery
  device only when that device exists.
- The kit is a bearer secret. Keep it offline; anyone with the file and the
  passphrase can take the account.

## The AI persona

When you are signed in with your Prism id, the AI is a **persona of that
account**. `ensurePersona(humanSession, origin)` creates a separate Prism id
for the game host; the human's device signs a `prism/persona-owner/1` action
naming that persona and the origin. The AI logs in with the persona session and
that owner action.

- The server verifies the owner action against the human's **pinned log** (the
  human must have signed in here once), stores `owner` and `ai: true` on the
  persona account, and refuses a second owner.
- The AI panel names the character; the persona plays or creates it. The human
  can play another character at the same time; watching does not quit the
  human's play socket.
- The transcript carries `persona`, `owner`, `tick_from` and `tick_to`.
- **Reset** revokes the persona device locally, signs
  `prism/persona-retire/1`, and the server tombstones the persona account and
  its characters. The characters are renamed with a `~<persona suffix>`
  tombstone so their names are free; the next start uses a new epoch and a new
  persona.
- The human's game sign-in filters `prism/persona/1` and
  `prism/persona-key/1` records from the log it sends, so the server never
  receives the human's other personas. It does receive the single owner action
  naming the AI persona.
- Without a human sign-in the AI falls back to its own account and the panel
  says so; sign in with your Prism id and restart it to own it.

## Character handoff

The AI persona owns its own characters, and a signed-in human can also hand it
one of theirs:

- the human signs a `prism/character-handoff/1` action naming the character and
  the AI persona; the server verifies it against the human's pinned log and
  checks that both the character and the persona belong to the human;
- the character keeps its **human owner** and gains a `delegate` (the persona);
  its level, guild, quests and mail stay;
- the AI's character list includes the delegated character; the human can play
  another character at the same time (alice the AI, bob the human);
- the transcript carries the character `alice`, the persona and the human
  owner;
- `prism/character-revoke/1` clears the delegation; the AI's next login as that
  character is refused, and the human can take it back;
- retiring the persona clears every delegation it held;
- a character has one delegate; a second handoff must revoke first.

## The frame

The frame (`frame/frame.mjs`) and `prism-id.mjs` are pinned and copied
byte-for-byte in the reference apps. The game can either:

- vendor both modules and serve them from `/frame.mjs` and `/prism-id.mjs`
  (self-contained, larger release);
- load the canonical frame module by its content hash (smaller release, one
  more cross-origin dependency).

The login itself works without the relay for a newly created id. Linking needs
the relay; recovery is a paper-share kit and does not; instant revocation needs
the relay, and the page's `connect-src` must name it.

## Legacy accounts

`register` and `login` stay for telnet and CLI clients. The browser defaults to
the Prism id. A new id creates a fresh account. An existing password or token
account can be adopted once by a signed-in Prism id; the old record is retired
and its credentials cleared. The browser says the id is browser-local so a
player is not surprised by its loss; a recovery kit restores it on a new device.

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

A two-profile headless Chromium run linked a second device, signed it in as the
same `prism:` after the first quit, revoked it from the first, published, and
saw the removed device's old log refused; the linked session also survived a
reload.

X4 was run in headless Chromium: a second signed-in device took the account
over while the first was online; the first showed the notice and took it back;
after a server restart the first re-signed and was back in the Atrium without a
click; the AI reconnected with a fresh session (its join count went from one to
two and its status returned to live). The reducer gate proves the takeover order
(leave, then login) leaves one actor; the Node run proved the old socket is
closed. A socket that stops answering pings is terminated by the server; a
paused client cannot read its own close, so that half is a server-side check.

X5 was proved and built in the pinned SDK on wick: `prismpm verify` accepted
the eight refusal theorems, `prismpm build` produced the holo, and
`prism-code vectors` replayed 19 of 19 acceptance vectors. A local holo answered
all ten kind-7 fixtures, including a flag of 2 and a short request. The server
claimed a legacy account through the holo, refused a wrong secret, and refused
a claim with the holo down; the gate writes `world/identity-receipt.json` with
the kernel, app and fixture hashes and every verdict.

The account/character run was headless Chromium against a mock
OpenAI-compatible provider: a Prism account created alice and bob, switched
between them, reloaded and found both, claimed oldcasey as a third character,
and played it. The AI account created scout; its Model tab showed the exact
system and user prompt, the trimmed context, the raw reply, the parsed command,
the context size and the token totals, and the mock recorded the same character
name and room text. MB-14, MB-15 and MB-16 record the claims.

L1 was run headless: alice's human account created an AI persona owned by the
same Prism id; the AI played scout while alice stayed online; the Model tab and
the transcript carried the persona, owner and tick range; reset retired the
persona and its character, and the next start created a new persona that reused
scout. MB-18 and MB-19 record the claims.

Recovery was run headless: a signed-in account exported an encrypted kit to a
new passphrase; a fresh browser profile with no Prism storage restored the kit,
found alice and played her; the old profile was taken over and its stale log
refused with "the presented log omits a record"; the account count stayed one.
The gate also proves a wrong passphrase and a tampered kit are refused, a new
device recovers from the paper share, and the old device's action is refused.
MB-20 and MB-21 record the claims.

R3 was run headless: the human handed alice to the AI persona; the AI played
alice while the human played bob; the Model tab and transcript showed alice,
the persona and the human owner; the revoke returned alice and the AI could not
recreate or log in as it. MB-22 and MB-23 record the claims.

Not yet proven by the gate: a tampered signature, an unknown device, and a
replay across a restart.

## Decisions taken

1. **Protocol.** Stitch Prism id (`prism/identity/4`).
2. **Display.** `prism:<first 8 hex>`; the full id is the account key.
3. **Frame.** The game loads the identity module directly (`/prism-id.mjs`) and
   does not vendor the full frame yet. Out-of-band linking is built; recovery is
   later. Devices take turns until X4's takeover.
4. **Relay.** The relay is not consulted. The server pins the public log it has
   seen; a device removed elsewhere is refused once a surviving device has
   logged in with the newer log. Before that, the no-relay design cannot know.
5. **Legacy.** The name/password form remains for telnet, CLI and older
   accounts. The one-time `adopt` claim is built; it accepts a password or a
   legacy token, and `casey` is left to its owner.
