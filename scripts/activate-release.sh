#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/honkai-chat
REVISION="${1:?release revision is required}"
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 1
RELEASE="$ROOT/releases/$REVISION"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'
command -v pm2 >/dev/null
# Capture only an existing release symlink, before changing it. readlink -f on
# a missing path can return that path itself, which is not a rollback target.
PREVIOUS=''
if [ -L "$ROOT/current" ]; then
  CANDIDATE=$(readlink -e "$ROOT/current" || true)
  if [[ "$CANDIDATE" == "$ROOT/releases/"* ]] && [ -f "$CANDIDATE/.healthy" ] && [ -f "$CANDIDATE/ecosystem.config.cjs" ]; then PREVIOUS="$CANDIDATE"; fi
fi
# Recover the legacy page if a prior migration stopped before a healthy app existed.
if ! curl --silent --fail http://127.0.0.1:3001/ >/dev/null; then
  pm2 delete honkai-chat || true
  pm2 serve "$ROOT/client/dist" 3001 --spa --name honkai-chat
  pm2 save
fi
cd "$RELEASE"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Run the exact CLI through the same release symlink on a free port before
# replacing the live application. This catches entrypoint and packaging failures.
node scripts/preflight-release.mjs
ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
rollback() {
  echo 'New release failed verification; restoring the previous application.'
  pm2 logs honkai-chat --nostream --lines 20 || true
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/ecosystem.config.cjs" ]; then
    ln -sfn "$PREVIOUS" "$ROOT/current.next"
    mv -Tf "$ROOT/current.next" "$ROOT/current"
    pm2 delete honkai-chat || true
    pm2 start "$PREVIOUS/ecosystem.config.cjs" --only honkai-chat || true
  else
    pm2 delete honkai-chat || true
    pm2 serve "$ROOT/client/dist" 3001 --spa --name honkai-chat || true
  fi
  pm2 save
}
trap 'rollback' ERR
# Replace the old static-server command; only this application's process changes.
pm2 delete honkai-chat || true
pm2 start "$RELEASE/ecosystem.config.cjs" --only honkai-chat
curl --fail --retry 8 --retry-connrefused --retry-delay 2 http://127.0.0.1:3001/robots/api/health >/dev/null
node scripts/smoke-host.mjs http://127.0.0.1:3001
pm2 save
touch "$RELEASE/.healthy"
trap - ERR
echo "Festival release $REVISION is healthy: / and /robots/ on port 3001."
