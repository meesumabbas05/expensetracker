#!/usr/bin/env bash
set -euo pipefail
# Called over SSH; expects a staging path and existing application path.
stage=$1
app=$2
[[ "$stage" =~ ^/[a-zA-Z0-9_./-]+$ && "$app" =~ ^/[a-zA-Z0-9_./-]+$ && "$app" != / ]] || exit 1
mkdir -p "$app"
chmod 700 "$app"
app=$(cd "$app" && pwd -P)
command -v pm2 >/dev/null
pm2 ping >/dev/null
# Use the deployment user's PM2 daemon and protect other applications.
previous_process=$(pm2 jlist | node --input-type=module -e '
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const matches = JSON.parse(input).filter(p => p.name === "expense-tracker");
  if (matches.length > 1 || (matches.length && matches[0].pm2_env.pm_cwd !== process.argv[1])) {
    console.error("PM2 process name is already used by another application.");
    process.exit(1);
  }
  console.log(matches.length ? "yes" : "no");
' "$app")
# Install and validate before interrupting the running service.
cd "$stage"
PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund
npm run check
node --input-type=module -e 'import { readConfig } from "./src/config.js"; readConfig();'
node -e 'JSON.parse(require("node:fs").readFileSync("ecosystem.config.json", "utf8"));'
backup=$(mktemp -d "$app/.rollback.XXXXXX")
release_items=(src node_modules package.json package-lock.json .env ecosystem.config.json)
start_app() {
  (cd "$app"; pm2 startOrRestart ecosystem.config.json --only expense-tracker --update-env)
}
rollback() {
  code=$?
  trap - EXIT
  if [[ "$code" != 0 ]]; then
    if [[ "$previous_process" == yes ]]; then
      pm2 stop expense-tracker || true
    else
      pm2 delete expense-tracker || true
    fi
    for item in "${release_items[@]}"; do
      rm -rf "$app/$item"
      if [[ -e "$backup/$item" ]]; then mv "$backup/$item" "$app/$item"; fi
    done
    if [[ "$previous_process" == yes ]]; then start_app || true; fi
    pm2 save --force || true
  fi
  rm -rf "$backup"
  exit "$code"
}
for item in "${release_items[@]}"; do
  if [[ -e "$app/$item" ]]; then cp -a "$app/$item" "$backup/$item"; fi
 done
trap rollback EXIT
if [[ "$previous_process" == yes ]]; then pm2 stop expense-tracker; fi
# Copy only release files; data, credentials and WhatsApp state stay private.
rsync -a --delete src/ "$app/src/"
rsync -a --delete node_modules/ "$app/node_modules/"
cp package.json package-lock.json ecosystem.config.json "$app/"
install -m 600 .env "$app/.env"
start_app
sleep 5
pm2 jlist | node --input-type=module -e '
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const apps = JSON.parse(input).filter(p => p.name === "expense-tracker");
  if (apps.length !== 1 || apps[0].pm2_env.status !== "online") process.exit(1);
'
pm2 save
