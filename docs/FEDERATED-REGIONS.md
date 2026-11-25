# Federated regions, protocol 2

Two configured MUDBenchmark servers keep independent world state. A player on a
**Prism account** can run `travel east` or `travel west`, sign a short-lived
travel grant in the browser, and continue the character at the destination.
Passwords, password hashes and salts never cross a region boundary. A legacy
password account must first be claimed by a Prism id; `travel` refuses it.

This is an opt-in prototype, not a production federation. Production is
unaffected while `MUD_REGION_ID`, `MUD_REGION_ORIGIN` and `MUD_REGION_PEERS`
are unset.

## Trust model

A handoff carries two independent signatures:

1. **The player's Prism grant.** The browser signs
   `mudbenchmark/region-travel/1` with the player's Prism device. The grant
   names the character, destination region, destination origin and a one-time
   transfer id. The source verifies it against the player's pinned Prism log;
   the destination verifies it against the public records carried with the
   transfer. The grant is useless at another origin.
2. **The source region's attestation.** The source signs the progression
   snapshot with its Ed25519 region key. The destination verifies that
   signature against its configured issuer key and checks the protocol, rules
   fingerprint and destination.

The destination creates or reuses an account keyed by the Prism id. It never
receives a password field. The test asserts that the destination account has no
`passwordHash` or `salt`, that the source signed the claim, and that a replay or
an altered grant is refused.

Shared bearer secrets still authenticate peer HTTP calls. They are a transport
trust decision, not player identity. Non-loopback peer URLs and
`MUD_REGION_ORIGIN` must use HTTPS; loopback HTTP is allowed for the local demo.

## What moves

Moved: character name, level, XP, quests, quest cycles, spellbook and max mana.

Stays local to each region: guild membership and rank, faction standing, forge
components, the Ring record, titles, discovered exits/details, ignored players
and AI memory. On a return, the destination merges the previous local record
and overwrites only the progression named above. Carried items stay in the
source region; item identity and ownership transfer are not implemented.

Each region may disable skills it does not recognize. Disabled skills are held
in `unrecognizedSkills` and come back when the character reaches a region that
recognizes them. `cast`, `train`, `study` and `recite` all consult the policy;
the scroll target form `recite <scroll> on <target>` is parsed from the text
after `on`.

## Durability and limits

Federation mode checkpoints character progression synchronously before
acknowledging it, saves the outgoing marker and the leave in one write, and
refuses to restore an older backup automatically. Rotation is disabled in
federation mode to keep the write small. Measured on this machine with
`rotate: false`:

| Accounts | JSON size | Median save |
| ---: | ---: | ---: |
| 1,000 | 0.57 MB | 6 ms |
| 2,000 | 1.15 MB | 8 ms |
| 10,000 | 5.77 MB | 22 ms |

The effective account cap is the lower of `MAX_ACCOUNTS` (default 500) and
`MUD_REGION_MAX_ACCOUNTS` (default 2,000). The synchronous full-state write has
not been load-tested with many active players; this cap is the prototype
ceiling, not a production capacity claim.

An uncertain transfer leaves the source account `outgoing`; signing in there
with the Prism id retries the same signed grant while it is inside the Prism
action window. If the grant expires, the pending transfer needs an operator. A destination name collision
leaves the transfer pending and needs an operator. `received` transfer ids are
bounded to the last 64. The source region keeps the signed grant and snapshot in
the same durable marker, so a process crash at the handoff does not silently
lose the retry.

## Local demonstration

From the repository root, install runtime dependencies with
`npm ci --prefix runtime`. Use a fresh directory; do not regenerate keys for an
existing federation.

```sh
umask 077
mkdir -p "$HOME/.mudbench-region-demo"
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))' > "$HOME/.mudbench-region-demo/secret"
node --input-type=module -e 'import {rulesFingerprint} from "./runtime/federation.mjs"; console.log(rulesFingerprint())' > "$HOME/.mudbench-region-demo/rules"
openssl genpkey -algorithm ED25519 -out "$HOME/.mudbench-region-demo/west-key.pem"
openssl pkey -in "$HOME/.mudbench-region-demo/west-key.pem" -pubout -out "$HOME/.mudbench-region-demo/west-public.pem"
openssl genpkey -algorithm ED25519 -out "$HOME/.mudbench-region-demo/east-key.pem"
openssl pkey -in "$HOME/.mudbench-region-demo/east-key.pem" -pubout -out "$HOME/.mudbench-region-demo/east-public.pem"
```

In two terminals, from the repository root:

```sh
export MUD_PEER_SECRET="$(cat "$HOME/.mudbench-region-demo/secret")"
export MUD_REGION_RULES="$(cat "$HOME/.mudbench-region-demo/rules")"
```

West:

```sh
MUD_REGION_ID=west \
MUD_REGION_ORIGIN=http://127.0.0.1:8091 \
MUD_REGION_SIGNING_KEY_FILE="$HOME/.mudbench-region-demo/west-key.pem" \
MUD_REGION_PEERS="$(node -e 'console.log(JSON.stringify({east:{url:"http://127.0.0.1:8092",secret:process.env.MUD_PEER_SECRET,publicKey:require("node:fs").readFileSync(process.env.HOME+"/.mudbench-region-demo/east-public.pem","utf8")}}))')" \
TELNET_PORT=4001 WEB_PORT=8091 \
STATE_FILE="$HOME/.mudbench-region-demo/west.json" \
IDENTITY_FILE="$HOME/.mudbench-region-demo/west-identities.json" \
TRACE_FILE="$HOME/.mudbench-region-demo/west-trace.jsonl" \
TELEMETRY_LOG="$HOME/.mudbench-region-demo/west-spans.jsonl" \
node runtime/server.mjs
```

East:

```sh
MUD_REGION_ID=east \
MUD_REGION_ORIGIN=http://127.0.0.1:8092 \
MUD_REGION_ALLOWED_SKILLS='["mend"]' \
MUD_REGION_SIGNING_KEY_FILE="$HOME/.mudbench-region-demo/east-key.pem" \
MUD_REGION_PEERS="$(node -e 'console.log(JSON.stringify({west:{url:"http://127.0.0.1:8091",secret:process.env.MUD_PEER_SECRET,publicKey:require("node:fs").readFileSync(process.env.HOME+"/.mudbench-region-demo/west-public.pem","utf8")}}))')" \
TELNET_PORT=4002 WEB_PORT=8092 \
STATE_FILE="$HOME/.mudbench-region-demo/east.json" \
IDENTITY_FILE="$HOME/.mudbench-region-demo/east-identities.json" \
TRACE_FILE="$HOME/.mudbench-region-demo/east-trace.jsonl" \
TELEMETRY_LOG="$HOME/.mudbench-region-demo/east-spans.jsonl" \
node runtime/server.mjs
```

Open `http://127.0.0.1:8091/`, sign in with a Prism id, create or play a
character, then type `travel east`. The server sends a `#travel` request; the
browser signs it and sends the grant automatically. Reconnect at
`http://127.0.0.1:8092/`, sign in with the same Prism id and `play <name>`.
`travel west` returns the character. A password account gets a refusal telling
the player to claim the character first.

Run `node --test runtime/federation.test.mjs`. It covers the grant and region
signatures, a two-process Prism transfer, local fields returning intact, skill
filtering, replay and altered-grant refusal, legacy refusal, an outage retry and
a process restart.

## Not implemented

Historical acquisition proof, item import, nested parent policies, offline
players, divergence merging, browser redirects, mTLS, load-tested synchronous
checkpoints, an operator tool for unresolved or expired transfers. The source region is
trusted for the character's progression; a region signature proves which region
made the claim, not that the player earned every skill under that region's
rules.
