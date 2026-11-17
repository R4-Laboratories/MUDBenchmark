# Releases

A release is a tag. wick's deploy timer pulls the newest release every ten
minutes, replays its acceptance vectors, flips both units, and rolls back if
either fails. A release contains the holo (the rules), its manifest, the
identity receipt, the admission receipt, and the runtime tarball. The tag is the
version on the box.

## One action

```sh
gh workflow run release.yml --ref main \
  -f sha=<40-character-commit-sha> \
  -f tag=vX.Y.Z \
  -f notes="what changed"
```

`release.yml` does not build. It:

1. checks out the exact SHA and refuses a different commit;
2. finds a **successful Gate run for that SHA**;
3. downloads that run's artifact — the holo the Gate built, proved and
   replayed, its manifest and the identity receipt;
4. creates the tag;
5. publishes the release with the artifact, the runtime, the identity receipt
   and the admission receipt.

A missing, pending or red Gate run stops the workflow before the tag exists, so
a red commit cannot become a release. The tag push uses `GITHUB_TOKEN`, which
does not trigger a second Gate run; the artifact that is published is the one
the Gate already tested.

## The loop's path

The loop's tick commits the admitted pacing candidate, waits for the main
`Gate` run on that exact SHA, and dispatches this same `release.yml` with a
`v<current>-loop.<n>` tag. The loop's release is therefore the one-action path,
not a second one. `docs/SELF-IMPROVEMENT.md` records the branch decision.

## The older tag path

A manually pushed `v*` tag runs Gate on the tag and its `publish a tagged
release` job publishes after the model job. The self-improvement loop tags
`vX.Y.Z-loop.N` and dispatches Gate on that ref for the same reason: a tag
pushed with `GITHUB_TOKEN` does not start a workflow by itself. Both paths
publish only after the model is proved and every acceptance vector replays.

## Deploy and rollback

```sh
mudbench-deploy            # the newest release
mudbench-deploy vX.Y.Z     # a named release
mudbench-deploy --status   # what is on the box
```

The deploy script proves the artifact before flipping either unit and rolls
back if the world or the holo fails to start. A rollback is the previous tag:
`mudbench-deploy <previous-tag>`. The account/character state is forward
compatible; rolling back the runtime does not rewrite the world state.

The timer asks for the newest release every ten minutes. If that tag is already
on the box it exits without restarting; an explicit `mudbench-deploy vX.Y.Z`
always deploys, which is what makes the rollback rehearsal possible.

## Rehearsal

Rehearsed 2026-11-16:

- v0.34.0 released from `8b6b241` by one dispatch, Gate run 43973358653;
- v0.35.0 (L1) released from `296e467` by the same one-action path;
- v0.36.0 (recovery kit) released from `b48810c` the same way; the deploy
  asset proof now also checks `/recovery-kit.mjs`;
- v0.37.0 (character handoff) released from `57d7638` after rebasing the
  loop's pacing tick;
- v0.38.0 (stream polish) released from `552d805`; the deploy serves
  `/spans`;
- v0.39.0 (admission kernel) released from the L5 commit; the release carries
  both receipts;
- the loop's first real commit `2f0d8ce` was released as `v0.36.0-loop.3.1`
  and pulled by the deploy timer;
- a SHA with no green Gate run (`a78f57e`) refused before the tag was created;
- the timer pulled v0.34.0; v0.33.0 was deployed and verified (101 accounts,
  101 characters), then v0.34.0 restored;
- the timer now exits when the newest release is already on the box.
