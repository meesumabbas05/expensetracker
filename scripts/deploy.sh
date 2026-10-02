#!/usr/bin/env bash
set -euo pipefail
# Called over SSH; expects a staging path and existing application path.
stage=$1
app=$2
[[ "$stage" =~ ^/[a-zA-Z0-9_./-]+$ && "$app" =~ ^/[a-zA-Z0-9_./-]+$ && "$app" != / ]] || exit 1
mkdir -p "$app"
chmod 700 "$app"
# Install and validate before interrupting the running service.
cd "$stage"
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund
npm run check
node --input-type=module -e 'import { readConfig } from "./src/config.js"; readConfig();'
backup=$(mktemp -d "$app/.rollback.XXXXXX")
rollback() {
  code=$?
  trap - EXIT
  if [[ "$code" != 0 ]]; then
    sudo systemctl stop expense-tracker.service || true
    for item in src node_modules package.json package-lock.json .env; do
      rm -rf "$app/$item"
      if [[ -e "$backup/$item" ]]; then mv "$backup/$item" "$app/$item"; fi
    done
    sudo systemctl start expense-tracker.service || true
  fi
  rm -rf "$backup"
  exit "$code"
}
for item in src node_modules package.json package-lock.json .env; do
  if [[ -e "$app/$item" ]]; then cp -a "$app/$item" "$backup/$item"; fi
 done
trap rollback EXIT
sudo systemctl stop expense-tracker.service
# Copy only release files; data, credentials and WhatsApp state stay private.
rsync -a --delete src/ "$app/src/"
rsync -a --delete node_modules/ "$app/node_modules/"
cp package.json package-lock.json "$app/"
install -m 600 .env "$app/.env"
sudo systemctl start expense-tracker.service
sleep 5
sudo systemctl is-active --quiet expense-tracker.service
