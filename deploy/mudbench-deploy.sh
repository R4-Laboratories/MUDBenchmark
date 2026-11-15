#!/usr/bin/env bash
# Pull-based deployment for MUDBench.
#
# wick is behind NAT, so CI cannot reach it. This runs on wick, pulls the newest
# release, proves the artifact replays, flips the holo unit to it, and rolls back
# if the health check fails. Nothing is opened inbound; the box fetches.
#
#   mudbench-deploy            deploy the latest release
#   mudbench-deploy v0.1.0     deploy a named tag
#   mudbench-deploy --status   show the deployed digest and release
#
# Needs a token that can read releases of a private repo, at
# ~/.config/mudbench-github.token (mode 600). A public repo needs none.

set -euo pipefail

REPO="${MUDBENCH_REPO:-R4-Laboratories/MUDBenchmark}"
API="https://api.github.com"
UNIT="$HOME/.config/systemd/user/mudbench-holo.service"
STAGE="$HOME/.mudbench/artifacts"
TOKEN_FILE="$HOME/.config/mudbench-github.token"
RUNTIME="$HOME/mudbenchmark/runtime"
KEEP=3

say() { printf '%s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

auth() {
  if [[ -f "$TOKEN_FILE" ]]; then printf 'Authorization: Bearer %s' "$(cat "$TOKEN_FILE")"; fi
}

api() {
  local path="$1"
  if [[ -f "$TOKEN_FILE" ]]; then
    curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Accept: application/vnd.github+json" "$API$path"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$API$path"
  fi
}

current_build() {
  sed -n 's/^WorkingDirectory=//p' "$UNIT"
}

if [[ "${1:-}" == "--status" ]]; then
  say "unit    $UNIT"
  say "build   $(current_build)"
  say "release $(cat "$HOME/.mudbench/deployed-tag" 2>/dev/null || echo none)"
  exit 0
fi

TAG="${1:-latest}"
# A timer runs this unattended, so "nothing published yet" is not an error.
if [[ "$TAG" == "latest" ]]; then
  RELEASE=$(api "/repos/$REPO/releases/latest") || { say "no release published yet"; exit 0; }
else
  RELEASE=$(api "/repos/$REPO/releases/tags/$TAG") || die "no release $TAG"
fi

TAG_NAME=$(printf '%s' "$RELEASE" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"])')
ASSET_URL=$(printf '%s' "$RELEASE" | python3 -c '
import sys, json
for a in json.load(sys.stdin)["assets"]:
    if a["name"] == "MUDBench.holo":
        print(a["url"]); break
')
[[ -n "$ASSET_URL" ]] || die "release $TAG_NAME has no MUDBench.holo"

PREVIOUS=$(current_build)
say "deploying $TAG_NAME (was $(basename "$PREVIOUS"))"

mkdir -p "$STAGE/$TAG_NAME"
TMP="$STAGE/$TAG_NAME/MUDBench.holo.part"

if [[ -f "$TOKEN_FILE" ]]; then
  curl -fsSL -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H "Accept: application/octet-stream" \
    "$ASSET_URL" -o "$TMP"
else
  curl -fsSL -H "Accept: application/octet-stream" "$ASSET_URL" -o "$TMP"
fi
mv "$TMP" "$STAGE/$TAG_NAME/MUDBench.holo"

# The artifact has to replay before it is allowed to run. A vector failure means
# the release is not the one the gate approved, and it never goes live.
say "replaying acceptance vectors"
( cd "$RUNTIME" && npx -y prism-code@0.5.0 vectors "$STAGE/$TAG_NAME/MUDBench.holo" >/tmp/mudbench-deploy-vectors.log 2>&1 ) \
  || { die "vectors failed — see /tmp/mudbench-deploy-vectors.log"; }

say "flipping the unit"
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$STAGE/$TAG_NAME|" "$UNIT"
systemctl --user daemon-reload
systemctl --user restart mudbench-holo.service mudbench-world.service

sleep 6

# Liveness is not service. A holo can be "activating" forever with the world
# answering /health, so ask the guest for a decision: this exact request is an
# acceptance vector, and anything but `admissible` means the rules are not
# running.
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
  say "deployed $TAG_NAME"
else
  say "health check failed (holo decision: $holo_ok) — rolling back to $(basename "$PREVIOUS")"
  sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$PREVIOUS|" "$UNIT"
  systemctl --user daemon-reload
  systemctl --user restart mudbench-holo.service mudbench-world.service
  die "rolled back"
fi

# Keep the last few artifacts so a rollback target exists.
ls -dt "$STAGE"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
