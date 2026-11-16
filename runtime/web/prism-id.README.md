# Prism id module

`prism-id.mjs` is copied byte for byte from `UOR-Foundation/foundry`
`identity/prism-id.mjs`, which `identity/stitch-sync.mjs` generates from
`afflom/stitch@68a9222a075ba11473ae804c47b223daa7d162ce` (the source commit,
module list and output hash are in `prism-id.lock.json`). Do not edit it here;
re-sync from stitch and update the lock together.

`prism-auth.mjs` is MUDBench's browser adapter: it keeps the id in IndexedDB
and signs one `prism/session/1` action for the page origin. The server verifier
is `runtime/prism-auth.mjs`; the wire command is `prism <base64url session>`.
