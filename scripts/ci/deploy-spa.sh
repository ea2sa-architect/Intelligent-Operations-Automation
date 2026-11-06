#!/bin/sh
# Deploy the built SPA from inside the Jenkins agent container.
#
# The agent is a container: rsync and the deploy directories exist only on the
# host. So this runs the SAME two steps as before (stage dist, then run
# deploy-ioa-spa.sh) inside a short-lived container via the host Docker socket,
# with the host paths mounted at identical locations.
#
# Ownership safeguard: the container runs as PUID:PGID, so everything it writes
# (staged dist, new deployment, backups) stays owned by DEPLOY_USER, not root.
# PUID/PGID are explicit config — set them in the environment to override.
# Left unset, they're resolved by name from the HOST's passwd/group files, so no
# numeric IDs are hard-coded here.
#
# Env (all have defaults except WORKSPACE, which Jenkins sets):
#   DEPLOY_USER    user that must own deploy artifacts   (default deploy)
#   PUID / PGID    explicit uid/gid override             (default: look up DEPLOY_USER)
#   DIST_STAGE     staged dist dir on the host
#   DEPLOY_SCRIPT  existing deploy script on the host
#   DEPLOY_ROOT    root of the served sites + backups
#   WORKSPACE_REL  path of the built dist relative to the workspace (default web/dist)
#   AGENT_ROOT / AGENT_HOST_ROOT  the agent's workspace root as seen in-container / on the host
#   HOST_DIST      full host path of the built dist (skips the AGENT_* mapping; for testing)
#   DRY_RUN=1      resolve IDs, check access, rsync -n; do NOT run the deploy script
set -eu

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DIST_STAGE="${DIST_STAGE:-/srv/ioa/dist}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-/srv/scripts/deploy-ioa-spa.sh}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/mnt/gilbert-spa}"
WORKSPACE_REL="${WORKSPACE_REL:-web/dist}"
AGENT_ROOT="${AGENT_ROOT:-/home/jenkins/agent}"
AGENT_HOST_ROOT="${AGENT_HOST_ROOT:-/mnt/jenkins-agent}"
IMAGE="ioa-deploy-tools:alpine3.20"

# Host path of the built dist (the docker daemon resolves bind mounts on the host).
if [ -z "${HOST_DIST:-}" ]; then
  : "${WORKSPACE:?WORKSPACE (or HOST_DIST) must be set}"
  HOST_DIST="$(printf '%s' "$WORKSPACE/$WORKSPACE_REL" | sed "s|^$AGENT_ROOT|$AGENT_HOST_ROOT|")"
fi

# Resolve uid/gid by name from the host's passwd/group unless given explicitly.
lookup() { docker run --rm -v /etc/passwd:/etc/passwd:ro -v /etc/group:/etc/group:ro alpine:3.20 id "$1" "$DEPLOY_USER"; }
PUID="${PUID:-$(lookup -u)}"
PGID="${PGID:-$(lookup -g)}"
case "$PUID$PGID" in *[!0-9]*|"") echo "ERROR: could not resolve numeric PUID/PGID for $DEPLOY_USER" >&2; exit 1;; esac
[ "$PUID" != 0 ] || { echo "ERROR: refusing to deploy as root (PUID=0)" >&2; exit 1; }
echo "Deploying as ${DEPLOY_USER} (${PUID}:${PGID}); dist from ${HOST_DIST}"

# Tiny tools image (rsync + bash for the existing script). Cached after first build.
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" - <<'DOCKERFILE'
FROM alpine:3.20
RUN apk add --no-cache rsync bash
DOCKERFILE

# Mount parents, not the leaf dirs: deploy-ioa-spa.sh `mv`s the target dir, which
# fails if that dir is itself a mount point.
STAGE_PARENT="$(dirname "$DIST_STAGE")"
SCRIPT_DIR="$(dirname "$DEPLOY_SCRIPT")"

if [ "${DRY_RUN:-0}" = 1 ]; then
  RUN='for p in "$STAGE_PARENT" "$DEPLOY_ROOT"; do test -w "$p" && echo "writable: $p" || { echo "NOT writable: $p"; exit 1; }; done
       test -f "$DEPLOY_SCRIPT" && echo "script present: $DEPLOY_SCRIPT"
       rsync -avn --delete /build-dist/ "$DIST_STAGE/" | tail -5
       echo "DRY RUN: deploy script not executed"'
else
  RUN='rsync -av --delete /build-dist/ "$DIST_STAGE/" && bash "$DEPLOY_SCRIPT"'
fi

exec docker run --rm \
  --user "${PUID}:${PGID}" \
  -e DIST_STAGE="$DIST_STAGE" -e DEPLOY_SCRIPT="$DEPLOY_SCRIPT" -e DEPLOY_ROOT="$DEPLOY_ROOT" -e STAGE_PARENT="$STAGE_PARENT" \
  -v "$HOST_DIST":/build-dist:ro \
  -v "$STAGE_PARENT":"$STAGE_PARENT" \
  -v "$SCRIPT_DIR":"$SCRIPT_DIR":ro \
  -v "$DEPLOY_ROOT":"$DEPLOY_ROOT" \
  "$IMAGE" sh -c "$RUN"
