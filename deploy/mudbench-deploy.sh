#!/usr/bin/env bash
# Pull-based deployment for MUDBench.
#
# wick is behind NAT, so CI cannot reach it. This runs on wick, pulls the newest
# release, proves the artifact replays, flips **both** units to it, and rolls
# back if either the guest or the server fails.
#
# A release is the whole world: the holo (the rules) and the runtime (the
# server). Deploying only the holo left the server on a hand-copied directory
# with no git history, so the two could drift and a rollback restored one of
# them.
#
#   mudbench-deploy            deploy the latest release
#   mudbench-deploy v0.1.0     deploy a named tag
#   mudbench-deploy --status   show the deployed release and directories

set -euo pipefail

REPO="${MUDBENCH_REPO:-R4-Laboratories/MUDBenchmark}"
API="https://api.github.com"
UNIT_HOLO="$HOME/.config/systemd/user/mudbench-holo.service"
UNIT_WORLD="$HOME/.config/systemd/user/mudbench-world.service"
STAGE="$HOME/.mudbench/artifacts"
TOKEN_FILE="$HOME/.config/mudbench-github.token"
KEEP=3

say() { printf '%s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

api() {
  local path="$1"
  if [[ -f "$TOKEN_FILE" ]]; then
    curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Accept: application/vnd.github+json" "$API$path"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$API$path"
  fi
}

fetch_asset() {
  local url="$1" out="$2"
  if [[ -f "$TOKEN_FILE" ]]; then
    curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Accept: application/octet-stream" "$url" -o "$out"
  else
    curl -fsSL -H "Accept: application/octet-stream" "$url" -o "$out"
  fi
}

asset_url() {
  printf '%s' "$1" | python3 -c "
import sys, json
name = sys.argv[1]
for a in json.load(sys.stdin)['assets']:
    if a['name'] == name:
        print(a['url']); break
" "$2"
}

current_dir() { sed -n 's/^WorkingDirectory=//p' "$1"; }

if [[ "${1:-}" == "--status" ]]; then
  say "holo    $(current_dir "$UNIT_HOLO")"
  say "world   $(current_dir "$UNIT_WORLD")"
  say "release $(cat "$HOME/.mudbench/deployed-tag" 2>/dev/null || echo none)"
  exit 0
fi

TAG="${1:-latest}"
if [[ "$TAG" == "latest" ]]; then
  RELEASE=$(api "/repos/$REPO/releases/latest") || { say "no release published yet"; exit 0; }
else
  RELEASE=$(api "/repos/$REPO/releases/tags/$TAG") || die "no release $TAG"
fi

TAG_NAME=$(printf '%s' "$RELEASE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"])')
HOLO_URL=$(asset_url "$RELEASE" MUDBench.holo)
RUNTIME_URL=$(asset_url "$RELEASE" runtime.tar.gz)
[[ -n "$HOLO_URL" ]] || die "release $TAG_NAME has no MUDBench.holo"
[[ -n "$RUNTIME_URL" ]] || die "release $TAG_NAME has no runtime.tar.gz — refusing to deploy half a world"

PREV_HOLO=$(current_dir "$UNIT_HOLO")
PREV_WORLD=$(current_dir "$UNIT_WORLD")
say "deploying $TAG_NAME (holo was $(basename "$PREV_HOLO"), runtime was $PREV_WORLD)"

DEST="$STAGE/$TAG_NAME"
mkdir -p "$DEST"
fetch_asset "$HOLO_URL" "$DEST/MUDBench.holo.part"
mv "$DEST/MUDBench.holo.part" "$DEST/MUDBench.holo"
fetch_asset "$RUNTIME_URL" "$DEST/runtime.tar.gz.part"
mv "$DEST/runtime.tar.gz.part" "$DEST/runtime.tar.gz"
tar -xzf "$DEST/runtime.tar.gz" -C "$DEST"

# The runtime needs its dependencies; the tarball deliberately has no node_modules.
if [[ ! -d "$DEST/runtime/node_modules" ]]; then
  say "installing runtime dependencies"
  ( cd "$DEST/runtime" && npm ci --omit=dev --no-audit --no-fund >/tmp/mudbench-deploy-npm.log 2>&1 ) \
    || die "npm ci failed — see /tmp/mudbench-deploy-npm.log"
fi

# The artifact has to replay before it is allowed to run.
say "replaying acceptance vectors"
( cd "$DEST/runtime" && npx -y prism-code@0.5.0 vectors "$DEST/MUDBench.holo" >/tmp/mudbench-deploy-vectors.log 2>&1 ) \
  || { die "vectors failed — see /tmp/mudbench-deploy-vectors.log"; }

say "flipping both units"
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$DEST|" "$UNIT_HOLO"
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$DEST/runtime|" "$UNIT_WORLD"
systemctl --user daemon-reload
systemctl --user restart mudbench-holo.service mudbench-world.service

sleep 6

holo_ok=false
for _ in 1 2 3 4 5 6; do
  if curl -fsS -m 5 -X POST http://127.0.0.1:8082/_hologram/intent \
       -H 'content-type: application/json' \
       -d '{"version":1,"name":"application.invoke","payload":"\u0001\u0005\u0005\u0000\u0000\u0000\u0000"}' \
     2>/dev/null | grep -q admissible; then
    holo_ok=true
    break
  fi
  sleep 2
done

if [[ "$holo_ok" == "true" ]] \
   && systemctl --user is-active --quiet mudbench-holo.service \
   && systemctl --user is-active --quiet mudbench-world.service \
   && curl -fsS -m 5 http://127.0.0.1:8090/health >/dev/null; then
  printf '%s' "$TAG_NAME" > "$HOME/.mudbench/deployed-tag"
  say "deployed $TAG_NAME (holo and runtime)"
else
  say "health check failed (holo: $holo_ok) — rolling back"
  sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$PREV_HOLO|" "$UNIT_HOLO"
  sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$PREV_WORLD|" "$UNIT_WORLD"
  systemctl --user daemon-reload
  systemctl --user restart mudbench-holo.service mudbench-world.service
  die "rolled back to $(basename "$PREV_HOLO")"
fi

ls -dt "$STAGE"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
