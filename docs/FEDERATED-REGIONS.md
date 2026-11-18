# Federated regions prototype

Two configured MUDBenchmark servers retain independent world state. A player on
a legacy password account can run `travel east` or `travel west`, then reconnect
and log in at the destination. Character XP, level, spells, and quest progress
move; carried items remain in the source region. Guild membership and privileges
are local to each region. The source signs the transferred progression and
skills with its Ed25519 key. The destination verifies that signature against
its configured issuer key, checks that the skills exist and fit the claimed
level, and stores the signed snapshot with the character. Each region may
disable skills it does not recognize; the disabled skills remain with the
character and can become usable again elsewhere.

This is an experimental, mutually trusted two-region handoff, not a production
federation or a CIRIS integration. Transfers require both servers online. An
uncertain transfer locks the source character; logging in at the source retries
the same transfer. A destination name collision also leaves it pending and
requires operator intervention. Never delete or edit an outgoing transfer to
recover it without checking the destination first. Federation refuses to restore
an older state backup automatically, because rollback can duplicate or lose a
character.

The operators choose a seed rules fingerprint and configure it on both
servers. Each server refuses to start federation if its local rules differ,
and peers compare that fingerprint and the transfer protocol before travel.
This only covers the files listed in `runtime/federation.mjs`, not map or
content compatibility. It is self-reported: it does not prove a region runs
trusted code, certify membership, implement a parent server, or support policy
revocation.

A signed snapshot proves which trusted region made the claim; it does not prove
the player earned a skill according to the rules, nor does it provide an
acquisition history. The receiver currently trusts the issuer for that.

## Local demonstration

From the repository root, install the runtime dependency with
`npm ci --prefix runtime`. In a shell, prepare a private directory:
Use a fresh directory; do not regenerate keys for an existing federation.

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

In each of two terminals, from the repository root:

```sh
export MUD_PEER_SECRET="$(cat "$HOME/.mudbench-region-demo/secret")"
export MUD_REGION_RULES="$(cat "$HOME/.mudbench-region-demo/rules")"
```

In the first terminal:

```sh
MUD_REGION_ID=west \
MUD_REGION_SIGNING_KEY_FILE="$HOME/.mudbench-region-demo/west-key.pem" \
MUD_REGION_PEERS="$(node -e 'console.log(JSON.stringify({east:{url:"http://127.0.0.1:8092",secret:process.env.MUD_PEER_SECRET,publicKey:require("node:fs").readFileSync(process.env.HOME+"/.mudbench-region-demo/east-public.pem","utf8")}}))')" \
TELNET_PORT=4001 WEB_PORT=8091 \
STATE_FILE="$HOME/.mudbench-region-demo/west.json" \
IDENTITY_FILE="$HOME/.mudbench-region-demo/west-identities.json" \
TRACE_FILE="$HOME/.mudbench-region-demo/west-trace.jsonl" \
TELEMETRY_LOG="$HOME/.mudbench-region-demo/west-spans.jsonl" \
node runtime/server.mjs
```

In the second:

```sh
MUD_REGION_ID=east \
MUD_REGION_SIGNING_KEY_FILE="$HOME/.mudbench-region-demo/east-key.pem" \
MUD_REGION_ALLOWED_SKILLS='["mend"]' \
MUD_REGION_PEERS="$(node -e 'console.log(JSON.stringify({west:{url:"http://127.0.0.1:8091",secret:process.env.MUD_PEER_SECRET,publicKey:require("node:fs").readFileSync(process.env.HOME+"/.mudbench-region-demo/west-public.pem","utf8")}}))')" \
TELNET_PORT=4002 WEB_PORT=8092 \
STATE_FILE="$HOME/.mudbench-region-demo/east.json" \
IDENTITY_FILE="$HOME/.mudbench-region-demo/east-identities.json" \
TRACE_FILE="$HOME/.mudbench-region-demo/east-trace.jsonl" \
TELEMETRY_LOG="$HOME/.mudbench-region-demo/east-spans.jsonl" \
node runtime/server.mjs
```

Open `http://127.0.0.1:8091/`, register a password account, and enter
`travel east`. Once the transfer completes, open `http://127.0.0.1:8092/` and
log in with the same account. `travel west` returns it.

The two servers and clients are bound to loopback. Non-loopback peer URLs must
use HTTPS via a separately configured reverse proxy. The shared peer secret
grants authority to import accounts, including password hashes: use unique
strong secrets, secure transport, and only hosts that trust one another. Prism
accounts, automatic browser redirects, offline play, multi-hop parent policy,
player-presented credentials, item import, and account or world conflict merging
are not implemented. `MUD_REGION_ALLOWED_SKILLS` is an optional JSON array of
recognized skill IDs; if unset, all built-in skills are allowed. Current world items reset and are not persistent character
inventory, so transferring them needs a separate item-identity and persistence
design.

Run the local two-process check with `node --test runtime/federation.test.mjs`.
