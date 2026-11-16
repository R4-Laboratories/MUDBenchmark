# Identity, login and persistence: audit and roadmap

Status: audit of v0.26.0 as deployed on wick, 2026-11-16. Read-only: no runtime
code, tests, game data, git state or deployment was changed. The audit ran
`node tools/gate.mjs`, read the live state and spans on wick, imported the
pinned identity module in Node, and read the deployed artifact.

**Implementation note (v0.27).** N1 (durable state, backups, fail-loud load,
one-time migration), N2 (authenticated-login invariant, `kind` normalization),
N4 (deploy proves `/` and the pinned module hash), and the N3 caps, ten-minute
expiry, five-minute window and device-id logging are implemented and gated.
N5 is partial (`navigator.storage.persist()` plus honest copy). N3's full
vector set, X1 claim, X2 log pinning, X3 linking, X4 heartbeat, X5 identity
kernel and X6 release-on-merge remain.

The question is narrow: **is a Prism id actually a player account yet?** The
answer is that the signature path is real and the account is real, but the
account is not yet durable, claimable or recoverable, and the documentation
claims more than the code and the gate prove.

Severity used below:

- **Blocker** — an account can be lost, or authentication can be bypassed, on a
  path that exists or will exist in the next release.
- **High** — theft, lockout or loss under a plausible condition, or a claim in
  the docs that the code does not support.
- **Medium** — degraded security, durability or clarity.
- **Low** — latent or polish.

---

## A. Executive summary

### What is real

- A browser creates or loads a Prism id in IndexedDB, signs one
  `prism/session/1` action for `location.origin`, and sends one WebSocket line
  `prism <base64url {app, envelope, records}>`
  (`runtime/web/prism-auth.mjs:84-108`, `runtime/server.mjs:286-324`).
- The server verifies with the pinned Stitch module, checks `app === origin`,
  the session-key shape, and an expiry no more than eight days out, then calls
  `verifyAction` with a 60-second window and a process-local `seen` set
  (`runtime/prism-auth.mjs:12-73`).
- The reducer creates a passwordless identity keyed by the id, with
  `kind: "prism"`, `prism: <id>`, `tokenHash: null`, and display
  `prism:<first 8 hex>` (`runtime/world.mjs:789-800`,
  `runtime/prism-auth.mjs:21-24`).
- The pinned file matches its lock and the deployed artifact:
  `runtime/web/prism-id.mjs` is `68482230e97b…d0d0`, the lock records the same
  output hash, and the file in `~/.mudbench/artifacts/v0.26.0/runtime/web/` has
  the same hash.
- The gate proves the happy path and two refusals (`tools/gate.mjs:274-286`),
  and `node tools/gate.mjs` passes with `prismId signed` and
  `prismLogin 1 account`.
- A Prism identity survives a checkpoint and a reload *in memory*: I ran
  `step → checkpointIdentities → upgradeState → login` and `kind`, `prism` and
  the display name all survived.
- The live world now holds one Prism account: key prefix `sha256:250b…`,
  display `prism:250b2246`, created at tick 442509 by a signed session. The
  single `world.prism` span for that login exists. There is no evidence of a
  second login, a restart, a link, a recovery, a revocation, or a login through
  the production tunnel.
- Deploy preserves the state file across releases: the v0.26.0 restart resumed
  the pre-existing world with its identities intact (96 legacy + 1 Prism at
  11:14 EST; the server logged "resumed at tick 441534").

### What is fragile

- The live state file is `/tmp/mudbench-world.json` on a **tmpfs**. A reboot,
  or a `/tmp` cleanup, erases every account. The live unit sets no
  `STATE_FILE`; the default is the only thing in play
  (`runtime/server.mjs:30`, `deploy/mudbench-world.service:9-12`).
- A state file that does not parse is **silently replaced by a fresh world**
  (`runtime/server.mjs:115-129`). There is no error, no backup and no refusal
  to start.
- The reducer will accept an **unauthenticated login with no token** for any
  record whose `tokenHash` is `null` — which is precisely every Prism record
  (`runtime/world.mjs:741-744`). No server path emits that intent today, but
  the invariant "the reducer only sees authenticated intents" is not enforced.
- **A revoked device is not refused.** The server verifies the log the client
  presents; a device holding its pre-revocation log signs in after it has been
  removed. I demonstrated this in Node: after `revokeDevice`, the old log
  verified `true`; the same key verified `false` against the new log. The
  documentation's claim that a fresh session per connection refuses a removed
  device (`docs/PRISM-IDENTITY.md:70-77`, `177-178`) is false without
  server-side log pinning.
- The "seven-day" session is a **60-second bearer token** in practice: the
  action must be within ±60 s of server time (`runtime/prism-auth.mjs:55-62`),
  so `expires` only bounds an expiry that is never reached. A restart inside
  those 60 seconds clears the in-memory `seen` set and permits one replay.
- The **session key is generated and discarded**. The browser exports only the
  public half (`runtime/web/prism-auth.mjs:94-99`), so the per-command
  signature the comment promises can never be made.
- The browser device key is **non-extractable** (`createDevice` calls
  `newKeys(false)`, `runtime/web/prism-id.mjs:1036-1073`). There is no export,
  no link and no recovery. Clearing site data, losing the profile, or a Safari
  storage eviction loses the character permanently.
- The page says "that id is the account" and "the id stays in this browser"
  (`runtime/web/index.html:205-208`) but never says that clearing the browser
  loses it.
- The login line is **19,030 characters** (14,272 bytes of JSON, one record);
  there is no cap before `JSON.parse`, and `WebSocketServer` uses the `ws`
  default `maxPayload` (`runtime/server.mjs:294-302`, `1420-1440`).
- Reconnect does not re-authenticate: the human socket reconnects as a guest
  (`runtime/web/index.html:463-472`), the AI reuses a session signed once
  (`906-913`), and a dead socket can hold an id against a new login because
  there is no WebSocket heartbeat.
- The live `world.prism` span has **no `prism.device` attribute**:
  `runtime/server.mjs:319` reads `verdict.device?.id`, but `resolvePrism`
  returns device *records* without an `id` field
  (`runtime/web/prism-id.mjs:1426`). Device attribution is always null.
- The deploy health check only asks `/health`. A tarball that omitted
  `runtime/web` would deploy green while "Use my Prism id" returns 404
  (`deploy/mudbench-deploy.sh:124-127`, `runtime/server.mjs:1378-1389`).

### What is missing

- A durable state location, backups, a corruption policy and a restore drill.
- A one-time claim from a legacy credential; 96 live legacy accounts, 86 of
  them token-only (including `casey`), cannot become Prism accounts today. A
  password-only claim would reach 7 of 96.
- Device linking and recovery; the protocol functions exist and are unused.
- Server-side public-log pinning, without which revocation and linking are
  cosmetic.
- A host-visible ownership binding for the AI. Today it is a second,
  independent id; the protocol's persona record is private and supports one
  persona per audience, so "one id owns the human and the AI" needs a design
  decision, not just a UI.
- Identity vectors beyond three cases, a module-hash check, and an identity
  claim in `claims/ledger.json`.
- A production test through the tunnel. The one live login is a hand run, not
  a gate.

---

## B. Gap table

### B.1 Identity lifecycle

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| No recovery: non-extractable device key, no export, no link, no recovery kit. | **Blocker** | `runtime/web/prism-id.mjs:1036-1073` (`newKeys(false)`); `runtime/web/prism-auth.mjs:111-113` only deletes | Cleared site data, lost profile or browser eviction = permanent loss; support cannot help | Ship out-of-band device linking first, then threshold recovery; state the risk in the UI |
| IndexedDB is best-effort; a failure silently falls back to an in-page Map. | High | `runtime/web/prism-auth.mjs:37-64`; header comment `8-10` | A private window creates a new account on every reload with no warning | Detect the fallback, say "this window will not keep the id", and refuse to present it as an account |
| No `navigator.storage.persist()` request. | Medium | No occurrence in `runtime/web` | Chrome may evict under pressure; Safari's ITP can evict after 7 days without interaction | Request persistence at first id creation; show granted/denied |
| Two tabs with the same id: the second is refused; no takeover. | Medium | `runtime/server.mjs:304-306`; `runtime/world.mjs:730-733` | "That Prism id is already signed in" with no path forward; a dead socket blocks for minutes | Add a takeover prompt and a heartbeat (see B.2) |
| AI **Reset identity** deletes the browser store only; the account is orphaned. | Medium | `runtime/web/index.html:658-665`; `runtime/web/prism-auth.mjs:111-113`; no identity deletion anywhere | Unbounded orphan `prism:` accounts; old AI progress unreachable; no undo | Retire/tombstone the account and create the next persona explicitly |
| The AI is a second independent id, not an owned persona. | High (for candidate 1) | `runtime/web/index.html:758`; `docs/PRISM-IDENTITY.md:145-150`; `runtime/web/prism-id.mjs:2125-2133` | No ownership, no recovery, no way to tell "my AI" from another player in `who` | `ensurePersona` plus a host-visible owner record; see D/L1 |

### B.2 Login security

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| A passwordless record can be claimed by an unauthenticated no-token login intent. | **High** (latent) | `runtime/world.mjs:741-744`; `tools/gate.mjs:508` sets `tokenHash: null`; I reproduced key takeover in Node | Any future caller (agent bridge, admin tool, harness) takes over every Prism account | Require `authenticated === true || prism === true`; gate the intent |
| No server-side log pinning; a revoked device's old log verifies. | **High** | `runtime/prism-auth.mjs:50-66` trusts the presented log; Node test: old log `true`, new log `false`; `docs/PRISM-IDENTITY.md:70-77` | "Remove device" is cosmetic; a stolen device keeps the account | Persist the public log per id, refuse a presented log missing a known bind/revoke, merge and store the union |
| 60 s window vs 7-day expiry; the replay set is process-local and count-cleared. | Medium | `runtime/prism-auth.mjs:12-19`, `41-46`, `55-72`; `runtime/web/prism-auth.mjs:101` | A restart inside 60 s permits one replay; the expiry is decorative and misleads a future change | Set `expires` to 10 min, cap at 15; prune `seen` by time; persist the set or pin the log |
| Session key generated, public half sent, private half discarded. | Medium | `runtime/web/prism-auth.mjs:94-99`; `runtime/prism-auth.mjs:38-40` | Dead weight; the comment promises a signature that cannot be made | Remove it, or retain the key and implement a server challenge |
| No payload cap; `ws` default `maxPayload`; 19,030-char wire line measured. | Medium | `runtime/server.mjs:294-302`, `1420-1440`; Node measurement | Cheap memory DoS with a large line or 4 MB record array | Cap the line at 64 KiB and records at 64 before parsing; set `maxPayload` |
| No heartbeat; duplicate refusal; no re-auth on reconnect. | Medium | `runtime/server.mjs:1420-1446`; `runtime/web/index.html:463-472` | A dead socket blocks re-login; a blip leaves the page signed out | Ping/pong, takeover, automatic re-sign |
| Origin is a header, not an allowlist; a non-browser client can match it. | Low | `runtime/server.mjs:1433`; `runtime/prism-auth.mjs:28-30` | The check is a cross-site replay guard, not client authentication; a stolen token works from any script | Add `ALLOWED_ORIGINS`; describe the check accurately |
| One error message for audience, replay and time; >60 s clock skew blocks login. | Medium | `runtime/web/prism-id.mjs:2383-2398`; Node test `now-61s` refused | Users with a slow clock cannot sign in and cannot tell why | 5-minute past window; log the specific cause; friendlier message |
| `prism` is allowed while already signed in. | Low | `runtime/server.mjs:286-324` lacks the `actor?.key` guard at `335`, `350` | Silent account switch; up to 60 s of uncheckpointed progress lost | Same guard as `login`/`register` |
| `prism.device` is always null. | Medium | `runtime/server.mjs:319` vs `runtime/web/prism-id.mjs:1426`; the live span lacks it | No device attribution for revocation, audit or multi-device | Return the device id (or hash the record) and log it |
| Per-connection rate limit only; account creation unbounded; no GC. | Low/Medium | `runtime/server.mjs:98-111`; no deletion of identities | Account/id spam, orphan growth, 32-bit display collisions | Cap identities, retire inactive, limit creation per connection |

### B.3 Account persistence

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| `STATE_FILE` defaults to `/tmp` on tmpfs; the live unit has no override. | **Blocker** | `runtime/server.mjs:30`; `deploy/mudbench-world.service:9-12`; `/proc/<pid>/environ` has only `DECOY_MODE`; `df -h /tmp` is tmpfs | Reboot or `/tmp` cleanup erases all 97 identities, including the new Prism account | `~/.mudbench/state/world.json`, created by the unit/deploy; migrate the live file before restart |
| A corrupt or truncated state file silently starts a fresh world. | **Blocker** | `runtime/server.mjs:115-129` | Total account loss with no error and no trace | Rename the bad file aside, log, refuse to start (or start read-only); keep N backups |
| No backup/restore; save failures are only logged; state shares tmpfs with 132 MB of spans. | High | `runtime/server.mjs:133-142`; `runtime/telemetry.mjs:11`; live `/tmp` sizes | Silent stale state; a full disk stops saves | Rotate backups, expose state age on `/health`, alert on save failure, rotate logs |
| `kind` is written only for new Prism records; legacy records have none. | Medium | `runtime/world.mjs:792`; live state: 96 legacy records with no `kind`; `docs/PRISM-IDENTITY.md:120-121` | A future `kind === "legacy"` branch misses every existing account | Default `kind` in `upgradeState`; gate it |
| No legacy claim/migration; 96 live accounts cannot adopt a Prism id. | **High** | `docs/PRISM-IDENTITY.md:152-158`, `180`; no claim code; live count: 7 password, 86 token-only (including `casey`), 4 neither | The headline is false for every existing player, and a password-only claim would reach 7 of 96 | One-time claim that accepts a password **or** the legacy token, with tombstones/aliases; see D/X1 |
| Display collision at 32 bits; no handle registry; prefix matching. | Low | `runtime/prism-auth.mjs:21-24`; `runtime/server.mjs:457-468` | Two ids can share `prism:xxxxxxxx`; `mail`/`tell` can hit the wrong one | Use 10+ hex or a handle registry; refuse ambiguous prefixes |
| `who`, `llms.txt` and `help` omit Prism; docs claim `who <name>` and a handle. | Medium | `runtime/server.mjs:416-420`, `384-391`; `runtime/llms.mjs:24-30`; `docs/PRISM-IDENTITY.md:118-119` | An agent reading the contract never learns the primary sign-in; users cannot see the full id | Generate the account section from code; add `who <name>` or drop the claim |
| Legacy clients are password-only; a Prism user cannot run `agent.mjs`/`harness.mjs`. | Medium | `runtime/agent.mjs:194-201`; `runtime/harness.mjs:246-257` | One account cannot span browser, CLI and harness, contradicting "the id is the account" | A documented CLI/link path, or an explicit "CLI characters are legacy" position |

### B.4 AI identity

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| No ownership, no AI marker, no transcript identity. | Medium | `runtime/web/index.html:1115-1144`; `runtime/web/ai.mjs:9-45` | A watched run cannot be tied to an account or a tick range; the AI is indistinguishable in `who` | Persona owner record; `ai: true` on the account; transcript id/tick range |
| Reset has no confirmation and orphans the character. | Medium | `runtime/web/index.html:658-665` | Misclick loses the AI's progress with no undo | Confirm, retire, list owned AIs |
| `PASS_KEY` and the old register path are dead; docs describe the old AI. | Low | `runtime/web/index.html:375`; `docs/AGENT.md:49-52` | Readers expect a generated password that no longer exists | Remove the constant and update the doc |

### B.5 Release and deploy

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| Deploy health check does not check the login assets. | **High** | `deploy/mudbench-deploy.sh:124-127`; `runtime/server.mjs:1378-1389` | A tarball missing `runtime/web` deploys green while sign-in 404s | Require `/` to contain `id="prism-login"` and `/prism-id.mjs` to hash to the lock |
| Pinned module served `no-store`, statically imported, 174 KB. | Low/Medium | `runtime/server.mjs:1382`; `runtime/web/index.html:327` | Every page view downloads 174 KB before any login | Content-addressed path + immutable cache; dynamic import on click |
| Gate covers good, wrong origin and expiry only; docs claim replay, tamper, unknown device and second-connection resume. | Medium | `tools/gate.mjs:274-286`; `docs/PRISM-IDENTITY.md:162-169` | A regression in replay, tamper or restart passes; the docs overstate the proof | Add the vectors in D/N3; fix the doc |
| No module-hash check in the gate. | Low | The gate does not read `prism-id.lock.json`; the deployed hash matches today | An accidental edit of the pinned module ships | Hash check in the gate and the deploy |
| No identity claim in `claims/ledger.json`. | Medium | The ledger has no MB-08; the gate prints `prismId`/`prismLogin` | The headline sits outside the project's honesty system | Add MB-08 with a gate reference |

### B.6 Verification

| Gap | Severity | Evidence | Consequence | Fix |
| --- | --- | --- | --- | --- |
| One live login, no second login, restart, link, recovery, revocation or tunnel test. | Medium | Live: one Prism identity, one `world.prism` span, tick 442509 | "Works" is a hand run; the multi-device and revocation stories are unverified | The acceptance tests in D |
| The documented "removed device is refused on next connect" is false. | **High** | `docs/PRISM-IDENTITY.md:70-77`, `177-178`; Node revocation test | Operators will believe a removed device is gone when it is not | Server-side log pinning; correct the doc |
| The documented "second connection resumes" is false (it is refused). | Low | `docs/PRISM-IDENTITY.md:164-165`; `runtime/server.mjs:304-306` | Confusing expectations and tests | Fix the doc or add takeover |
| The docs' account JSON (`handle`, `who <name>`, unique changeable handle) is not implemented. | Medium | `docs/PRISM-IDENTITY.md:102-119`; `runtime/server.mjs:416-420` | The design reads as shipped when it is not | Mark it as design; implement with the claim |

---

## C. Recommendation

**Recommend candidate 1, narrowed to "the account survives, can be claimed, and
can be recovered" — durability and claim first, linking second, persona third.
Do not start with persona or with the stream.**

### Why this is the next step

1. **The loss is total and the fix is cheap.** A Prism account can be destroyed
   today by a reboot (`/tmp`), a corrupted save (silent reset) or a cleared
   browser (non-extractable key, no recovery). Every one of those is a
   permanent loss with no support path. Moving one file, adding backups and a
   fail-loud load, and shipping a link flow removes the only failure a player
   will not forgive.
2. **The headline is false for every current player.** There are 96 legacy
   identities and one Prism identity in the live world. The owner's own
   `casey` account is legacy, and 86 of the 96 are token-only, so a
   password-only claim would adopt 7. Until the claim exists, "a Prism id is
   the player account" describes new players only.
3. **Linking cannot be safe before pinning.** I proved that a revoked device's
   pre-revocation log still verifies. Adding a second device before server-side
   log pinning would multiply the number of keys that can outlive a revocation.
   Pinning is therefore not a detour from candidate 1; it is its first half.
4. **The persona has a protocol shape problem.** The pinned module supports one
   persona per audience and keeps the ownership record inside the private
   boundary (`runtime/web/prism-id.mjs:2125-2133`, `2186-2208`). A host cannot
   verify that a persona belongs to a human id from the persona log alone. The
   AI ownership story needs a host-visible owner record and a sign-off; it is a
   design item, not a UI item, and it should follow the durable account.

### Against the other two

- **Candidate 2 (stream polish)** is largely built: five provider presets, a
  model list, Ollama detection, a transcript download and the Mind panel
  (`runtime/web/ai.mjs:9-45`, `runtime/web/index.html:599-728`, `1115-1144`).
  The remaining work (highlights, a benchmark view, local-model polish) does
  not remove any loss path, and every new stream user is exposed to the loss
  above. It is a good "Later" item once the account can be kept.
- **Candidate 3 (S2 publisher/admission and release-on-merge)** is important to
  the project's thesis, but its blocking decision is the owner's, not the
  code's: `main` requires checks the loop's direct push cannot satisfy, so the
  loop needs either a protection change or a branch-dispatch-merge path
  (`docs/SELF-IMPROVEMENT.md:196-212`). The release-on-merge half is a small CI
  change and can run in parallel (D/X6). Its discipline — claims, vectors,
  receipts — is applied to identity here via MB-08 and the identity kernel, so
  it is not deferred, only re-ordered.

### Impact, risk, dependency

- **Impact:** removes the three total-loss paths, makes the 96 legacy accounts
  adoptable, and gives the first real recovery story. It also produces the
  server-side log that every later multi-device feature needs.
- **Risk:** the AI persona slips by one release. Mitigation: the persona is the
  first "Later" item and reuses the pinning and owner-record work. The claim is
  the riskiest data change: do it with tombstones/aliases and gate tests, not a
  bulk rewrite.
- **Dependencies:** a durable directory on wick and a reboot window (owner); a
  decision on the release path for candidate 3 (owner); no new third-party
  dependency — the relay is not needed for this slice.

---

## D. Ordered roadmap

### Now — v0.27 "the account survives"

**N1. Durable state, backups, fail-loud load.** *(runtime + deploy)*
Move `STATE_FILE` to `~/.mudbench/state/world.json` (set it in the unit and in
the deploy script's unit rewrite), create the directory, write a rotating
backup (`world.json.1..5`), fsync the temp file before `rename`, and on a parse
error rename the bad file to `world.json.corrupt.<ts>`, log loudly and exit
non-zero instead of starting a fresh world. The deploy must migrate
`/tmp/mudbench-world.json` once, only if the destination is absent, and print
the identity count.
*Acceptance:* create a test Prism account; `systemctl --user restart`; same
level. `kill -9`; restart; same. Reboot wick; same. Truncate a copy; the server
refuses to start and names the corrupt file. `/health` or a new `/state` shows
the state age and identity count.
*Depends:* an owner-approved reboot window; a state directory on wick.

**N2. Reducer auth invariant and `kind` normalization.** *(runtime + gate)*
Require `intent.authenticated === true || intent.prism === true` in the login
branch; a record with `tokenHash === null` is only claimable by `prism`.
Default `kind` to `prism`/`legacy` in `upgradeState` so the 96 existing records
are typed.
*Acceptance:* gate proves an unauthenticated no-token login is refused for a
Prism record and for a legacy record with `tokenHash: null`; `upgradeState`
gives every record a `kind`; a Prism identity survives
`checkpointIdentities → upgradeState → login` with `kind`, `prism` and name.

**N3. Login hardening and identity vectors.** *(runtime + gate)*
Cap the `prism` line (64 KiB) and `records` (64) before `JSON.parse`; set
`maxPayload` on the WebSocket server. Set `expires` to 10 minutes and cap it at
15. Keep a 60-second future bound with a server-side check on `body.at`, and
pass a 5-minute window to `verifyAction` so a slow clock in the past does not
lock a player out (the pinned module uses one window for both sides, so the
asymmetry belongs in the server wrapper, not in the module). Log the specific
refusal reason and show a friendly one. Add an `ALLOWED_ORIGINS` list and keep
`app === origin`. Return and log the device id (fix `prism.device`). Add gate
vectors: good, wrong origin, expired, stale but unexpired, replayed with the
same `seen`, tampered signature, unknown device, oversized line, too many
records, and a malformed id.
*Acceptance:* all vectors pass; a 19 KB login still works; a 65 KB line is
refused before parse; a client 2 minutes slow can log in; a client 10 minutes
slow is refused with a clock hint.

**N4. The deploy proves the login asset.** *(deploy + gate)*
After the health check, GET `/` and require `id="prism-login"`; GET
`/prism-id.mjs` and compare its SHA-256 to `prism-id.lock.json`; roll back on
either failure. Add the same hash check to the gate.
*Acceptance:* a deliberately broken tarball (remove `runtime/web/prism-id.mjs`)
fails the deploy and rolls back; the good one passes; the gate fails on a
one-byte edit of the module.

**N5. Storage persistence and honest copy.** *(browser)*
Call `navigator.storage.persist()` before creating an id; show granted/denied.
Change the sign-in copy to say the id is only in this browser and that losing
the browser loses the character until linking exists; add the same note to the
signed-in panel. Detect the IndexedDB fallback and say "this window will not
keep the id."
*Acceptance:* the page reports persistence; a private window shows the warning;
a refresh in a private window does not silently present a new account as if it
were the old one.

**N6. MB-08 and the docs truth pass.** *(claims + docs)*
Add a build claim: "A Prism id signs in with a signed session for the page
origin; the account is keyed by the id, has no password, and survives a
checkpoint and reload; a wrong origin, expired or replayed session is refused."
`gate: tools/gate.mjs`. Remove or mark as design the unbuilt `handle`,
`who <name>`, `kind: legacy` and migration claims in `docs/PRISM-IDENTITY.md`;
fix the "second connection resumes" and "removed device is refused" sentences.
*Acceptance:* the `claims` gate line passes; a doc/code diff review finds no
unmarked claim.

### Next — v0.28 "claim and recover"

**X1. Legacy claim.** *(runtime + browser + gate)*
A signed-in Prism user opens "Claim an old name", enters the legacy name and
its password **or** legacy token (86 of the 96 live records are token-only);
the server verifies whichever credential the record holds and sends a claim
intent. The reducer merges level/XP/guild/quests, aliases mail
(`toKey`/`fromKey`), guild `members`/`guildRank` and any other keyed record,
sets the Prism identity's display to the old name, and tombstones the old
record: `retired: true`, `mergedInto: <prism>`, `passwordHash: null`,
`tokenHash: null`. `findIdentity`, `findActor`, `who` and `mail` must skip
retired records so the name resolves to exactly one account. The old login
refuses with "This account moved; sign in with your Prism id."
*Acceptance:* claim a test legacy account once; a second claim refuses; the old
password or token login refuses; mail sent before the claim is delivered after;
guild rank survives; a restart preserves all of it; `who` and `tell` by the old
name reach the Prism account only. Do `casey` last, with the owner present
(and its legacy token in hand, or accept that `casey` cannot be claimed).
*Depends:* N2.

**X2. Server-side log pinning and revocation at next login.** *(runtime)*
Store the pinned public log in a server-side `IDENTITY_FILE` next to the state
(same atomic write and backup policy), not inside `state`: `step` clones an
explicit field list, so a new top-level field is dropped every tick. Refuse a
presented log that omits any stored bind or revocation; merge the union and
persist it. Bound the stored set (e.g. 256 records per id; action records are
not stored today). A log that does not resolve is refused, not merged.
*Acceptance:* link device B; A revokes B; B's pre-revocation log is refused at
the next login; A's new log succeeds; the stored union contains the revocation;
a forged record cannot be merged; a restart preserves the pinned log.
*Depends:* N3 (device id logging).

**X3. Out-of-band device linking, no relay.** *(browser + runtime + gate)*
"Link another device" calls `createLinkOffer`, shows the URI as text and QR;
the new device pastes the URI, calls `requestLink`, shows the six-digit code
and the request JSON; the old device pastes the request, confirms the code,
calls `acceptLinkRequest` and shows the response JSON; the new device calls
`completeLink`, stores the session (including `personas`) in IndexedDB, and
logs in. A "Devices" list calls `revokeDevice`.
*Acceptance:* two browser profiles link and both log in as the same `prism:`;
a wrong six-digit code is refused; an expired offer is refused; a replayed
response is refused; removing A makes A fail at the next login (X2) while B
still works; a restart preserves the linked session.
*Depends:* X2; N1.

**X4. Heartbeat, reconnect, takeover.** *(runtime + browser)*
WebSocket ping/pong every 30 s. On a second login for an id that is online,
either close the old socket and accept (takeover) or offer the choice. The
browser re-signs on reconnect instead of returning to the guest screen.
*Acceptance:* drop the network for two minutes; the page reconnects and
re-authenticates without a click; a stale socket does not block; two tabs show
a takeover prompt; the AI reconnects with a fresh session instead of a stale
one.

**X5. Identity kernel and receipt.** *(lexlean + prismpm + gate)*
Add `world/src/Identity.lex.tex` (one decision function over booleans:
credential kind, authenticated, audience match, in-window, unseen, id format,
expiry bound, record kind) and prove: a passwordless record is never admitted
by a password; a session outside the window or for a foreign audience is never
admitted; a revoked device is never admitted given the pinned log; a malformed
id is never admitted. The server keeps its JS implementation (login must not
depend on the holo being up); the gate replays the kernel's vectors against the
JS and writes a receipt (kernel hash, fixture hash, verdicts) into the release.
*Acceptance:* `prismpm verify` and `prismpm build` include the module; the gate
matches every vector; a planted bad vector fails; the receipt is in the
artifact and cited in the release notes.

**X6. Release-on-merge, the small half of candidate 3.** *(CI)*
A `workflow_dispatch` "release this commit" that requires the gate on that
exact SHA, creates the tag and the GitHub release, and lets the deploy timer
pull. Do not auto-release every merge: the world should not restart under
players as a side effect of a merge.
*Acceptance:* a merged, gated commit is released with one action and deployed;
a red gate cannot release; a rollback is rehearsed.

### Later — v0.29 and beyond

**L1. AI persona ownership.** *(browser + runtime; design sign-off)*
`ensurePersona(humanSession, origin)` creates the persona; the AI logs in with
the persona session plus the human's signed `persona` record; the server
verifies the owner record (signed by the human id, persona and audience match),
stores `owner`, marks the account `ai: true`, and refuses a second owner.
Reset revokes the persona device, tombstones the account and creates a new
persona. Transcripts carry the persona id and tick range.
*Acceptance:* the AI account's owner is the human id; a second human cannot
claim it; reset leaves a tombstone, not an orphan; the human and AI can play at
once; the server cannot read the human's other personas.
*Depends:* X2, X3, and a decision that the host-visible owner record is
acceptable (the protocol keeps the owner record private and supports one
persona per audience).

**L2. Relay / instant revocation.** *(runtime; optional)*
Only if "revoked at next login" is too slow: run `createRelayBus` server-side
(or self-host) and pass `bus` to `heardLog`. Login must not depend on the
relay. If ntfy.sh is used, document its 30-minute warm retention and metadata.
*Acceptance:* revoke on A; B is refused within one login; the relay being down
does not block login; the relay sees only an opaque topic and framed bytes.

**L3. Session-key challenge.** *(browser + runtime; only if chosen)*
Retain the private key for the page lifetime; the server sends a nonce after
the WebSocket opens; the client signs `prism/session-key/1 <nonce> <counter>`;
the server verifies and refuses a reused counter. Otherwise delete the field
and the 87-character check.
*Acceptance:* a stolen login token replayed on a second connection is refused;
a command without a valid signature is refused; the 250 ms budget is unaffected.

**L4. Stream polish (candidate 2).** *(browser + runtime)*
Highlights, a benchmark view over spans, transcript identity and tick range,
better local-model UX. Many pieces exist; this is the remainder.
*Acceptance:* a run's transcript and the server's spans agree on commands and
ticks; a highlight is reproducible from the spans; a local model can be chosen
without a key.

**L5. S2 publisher/admission and the full release decision (candidate 3).**
*(loop + CI + prismpm)*
The loop's first real commit, the admission kernel, the branch-protection/push
decision, and an identity claim in the admission. The release-on-merge half is
already X6.
*Acceptance:* the loop's commit is admitted, gated, released, deployed and
rolled back once; a planted bad candidate cannot merge.

### Dependency summary

- `N1 → N3 (live clock test), N4, X2, X3, L1`
- `N2 → N6, X1, X5`
- `N3 → X2, X5, L3`
- `X2 → X3, L1, L2`
- `X3 → L1`
- `X6` is independent and can run in parallel.
- `L4` is independent; `L5` follows `X6`.
- Nothing in Now or Next needs the relay or a new third-party service.

---

## E. Risks and unknowns to resolve before calling identity "done"

1. **Browser storage eviction.** Safari's ITP can evict script-writable storage
   after seven days without interaction; Chrome may evict under pressure.
   `navigator.storage.persist()` helps Chrome, not ITP. Test on a real iPhone
   and a low-storage Android; decide whether a returning player after a week
   still finds the id. If not, linking/recovery is not optional.
2. **Private windows.** IndexedDB may be memory-only. Confirm the warning and
   that no account is silently created on reload.
3. **Production origin through the tunnel.** The origin check has never been
   exercised through Cloudflare. Run a headless browser against
   `https://play.r4labs.org`, click "Use my Prism id", and assert
   `Signing in as prism:`; run the same against localhost in the gate.
4. **Clock skew.** A 60-second past window fails on a slow device clock. Test
   with a page whose `Date.now` is two minutes slow; verify the new window and
   the message.
5. **Reboot.** The only proof that the state is durable is a reboot. Schedule a
   window, migrate the live file first, and check the identity count and the
   `casey` account afterwards.
6. **Corruption.** Truncate a copy of the state, start the server against it,
   and confirm it refuses to start rather than resetting. Restore from a backup.
7. **Claim edge cases.** Mail and guild membership are keyed by the old name;
   a bulk rewrite can lose either. Use aliases/tombstones and test a legacy
   account with mail, a guild rank and an active quest. Test a password
   identity and a token-only identity: 86 of the 96 live records have no
   password. A legacy account that is online during the claim must be handled
   (refuse or disconnect).
8. **Linking edge cases.** The pending offer lives in memory; a reload loses
   it (acceptable within the TTL). A stolen offer within five minutes is
   defeated by the six-digit code; test a mismatched code and a replayed
   response. A fork (two logs) must not merge.
9. **Persona privacy.** The owner record is host-visible; the rest of the human
   log (other personas, other hosts) must not be. Confirm the server stores
   only the record it needs and cannot enumerate the human's personas.
10. **Account abuse.** There is no cap, no deletion and no GC; 32-bit display
    names collide at scale. Decide a cap and a retirement policy before the
    world is public.
11. **Telemetry privacy.** The full Prism id is a stable pseudonym in the span
    stream; the stream lives in `/tmp` and grows. Decide retention and who can
    read it before exporting spans.
12. **The relay, if used.** ntfy.sh promises 30 minutes of retained messages,
    not durability; metadata is visible to the relay. Prefer server pinning for
    login; use the relay only for instant revocation, and self-host it if the
    dependency is unacceptable.
13. **The live accounts.** 96 legacy identities include test junk
    (`role0-1`, `probe3-4`, …). The claim UI must not enumerate them; claim by
    name and password, not by a list.
14. **The AI's provider key** is in plaintext localStorage on a shared machine.
    Not identity, but adjacent; the "Forget key" button exists.

---

## F. The role of lexlean and prismpm

They remain the build scaffolding and the proof surface. Nothing here replaces
them, forks them or moves the world model out of them.

- **lexlean** owns the *policy* model. The new `Identity` module is a small
  decision function over booleans, not a re-implementation of the pinned
  cryptography. It proves the four obligations that matter for an account:
  a passwordless record is never admitted by a password; a session outside the
  window or for a foreign audience is never admitted; a revoked device is never
  admitted given the pinned log; a malformed id is never admitted. The Lean
  theorem is about the same `judge` the holo runs, so the proof and the guest
  cannot drift.
- **prismpm** owns the build, the lock, the ratchet and the artifact. The
  identity module joins `world/lexlean.toml` and `world/prismpm.lock`; a change
  to it updates the lock in the same pull request. The holo already carries the
  transition admission; the identity kernel travels in the same artifact, so a
  release is still one holo plus one runtime.
- **The gate** is the binding between the proof and the JavaScript that
  actually runs. The server keeps a JS implementation of the identity decision
  because login must survive the holo unit restarting; the gate replays the
  kernel's vectors against that JS and writes a receipt (kernel hash, fixture
  hash, verdicts). If the owner wants the kernel on the hot path, run the same
  compiled holo **in-process** in the server (`prism-code`), not over HTTP; do
  not add a network dependency to login.
- **Receipts** follow the existing pattern: `prismpm verify` proves,
  `prismpm build` compiles, the gate replays every acceptance vector, and the
  release notes cite the receipt. An identity claim in `claims/ledger.json`
  (MB-08) makes the headline subject to the same honesty rules as the world
  claims.
- **What stays plain runtime:** the pinned Stitch verification, the state
  path/backups/restore, server-side log pinning, the link transport, the claim
  merge, the heartbeat and the UI. These are stateful or I/O-bound; a proof
  would add ceremony without removing a failure.

---

## Appendix: evidence

Run on 2026-11-16 between 11:00 and 11:20 EST.

- `node tools/gate.mjs` → `gate: passed`; the identity lines are
  `prismId signed` and `prismLogin 1 account`.
- `shasum -a 256 runtime/web/prism-id.mjs` →
  `68482230e97b35a042295ec003687e745b34ba92275f0fc6a671bc1510f6d0d0`;
  the lock's `output.sha256` is the same; the deployed
  `~/.mudbench/artifacts/v0.26.0/runtime/web/prism-id.mjs` is the same.
- Node, pinned module: `createPrism` + `signAction` → JSON 14,272 bytes,
  base64url **19,030** characters, one record; `verifyAction` allowed; the
  same envelope with the same `seen` refused; `now + 61 s` refused;
  `now − 61 s` refused.
- Node, revocation: link B to A; B verifies `true`; `revokeDevice(A, B)`;
  B's **old** log still verifies `true`; B against A's **new** log verifies
  `false` (`signature or revocation`).
- Node, reducer: a Prism login creates a passwordless record; an
  unauthenticated `{kind:"login", key}` with no token sets the actor's key
  (takeover) because `tokenHash === null`.
- Node, persistence: `checkpointIdentities → upgradeState → login` keeps
  `kind: "prism"`, `prism`, and `name`.
- Live wick: `~/.local/bin/mudbench-deploy --status` → release v0.26.0, holo
  and world in `~/.mudbench/artifacts/v0.26.0`; the unit's `WorkingDirectory`
  is the artifact runtime.
- Live state: 97 identities = 96 legacy + 1 Prism (`prism:250b2246`, key
  prefix `sha256:250b…`), created at tick 442509; the `world.prism` span
  exists and has no `prism.device` attribute. Of the 96 legacy records, 7 have
  a password, 86 a legacy token, 4 neither; `casey` is token-only.
- Live environment: `/proc/<pid>/environ` has `DECOY_MODE` only; `STATE_FILE`
  defaults to `/tmp/mudbench-world.json`; `/tmp` is tmpfs; the file is 42 KB;
  `/tmp/mudbench-spans.jsonl` is 132 MB and grows about 39 KB per 20 s;
  `/tmp/mudbench-trace.jsonl` grows about 24 MB per day.
- Deployed page: `/` contains `id="prism-login"` and
  `Use a name and password instead`; `/prism-id.mjs` returns 200,
  `content-type: text/javascript; charset=utf-8`, `cache-control: no-store`.
- `ssh wick 'mudbench-deploy --status'` fails in a non-interactive shell
  because `~/.local/bin` is not on `PATH`; the absolute path works. A minor
  ergonomics issue, not an identity issue.
