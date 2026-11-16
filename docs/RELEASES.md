# Releases

A release is a tag. wick's deploy timer pulls the newest release every ten
minutes, replays its acceptance vectors, flips both units, and rolls back if
either fails. A release contains the holo (the rules), its manifest, the
identity receipt, and the runtime tarball. The tag is the version on the box.

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
5. publishes the release with the artifact, the runtime and the receipt.

A missing, pending or red Gate run stops the workflow before the tag exists, so
a red commit cannot become a release. The tag push uses `GITHUB_TOKEN`, which
does not trigger a second Gate run; the artifact that is published is the one
the Gate already tested.

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

## Rehearsal

- a merged, green commit released by one dispatch, then pulled by the timer;
- a SHA with no green Gate run refused before the tag is created;
- the previous release deployed, verified, and the new release deployed again.
