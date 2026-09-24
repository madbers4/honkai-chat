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
cd "$RELEASE"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
PREVIOUS=$(readlink -f "$ROOT/current" || true)
ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
rollback() {
  echo 'New release failed verification; restoring the previous application.'
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS/ecosystem.config.cjs" ]; then
    ln -sfn "$PREVIOUS" "$ROOT/current.next"
    mv -Tf "$ROOT/current.next" "$ROOT/current"
    pm2 delete honkai-chat || true
    pm2 start "$ROOT/current/ecosystem.config.cjs" --only honkai-chat
  else
    pm2 delete honkai-chat || true
    pm2 serve "$ROOT/client/dist" 3001 --spa --name honkai-chat
  fi
  pm2 save
}
trap 'rollback' ERR
# Replace the old static-server command; only this application's process changes.
pm2 delete honkai-chat || true
pm2 start "$ROOT/current/ecosystem.config.cjs" --only honkai-chat
curl --fail --retry 8 --retry-connrefused --retry-delay 2 http://127.0.0.1:3001/robots/api/health >/dev/null
node scripts/smoke-host.mjs http://127.0.0.1:3001
pm2 save
trap - ERR
echo "Festival release $REVISION is healthy: / and /robots/ on port 3001."
