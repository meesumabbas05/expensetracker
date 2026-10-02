# WhatsApp expense tracker

A private Node.js bot using whatsapp-web.js, Google Sheets, and optional Gemini extraction. Runs as a separate systemd service on an existing Linux VM. No public web server or inbound application port is needed.

## Commands

| Message | Result |
| --- | --- |
| `expense 400` | Asks where/why, then a category number (1–10) |
| `expense 4000 dinner at a restaurant` | Gemini suggests place and category; asks for confirmation |
| `household expense 400 groceries` | Uses the shared household account |
| `set budget 50000` | Sets/updates your current month's limit |
| `set household budget 80000` | Sets/updates the shared limit |
| `set shopping budget 10000` / `set dine-out budget 5000` | Sets separate monthly category limits |
| `get shopping budget` / `get dine-out budget detail` | Category limit, used, remaining, and optional entries |
| `get budget` / `get budget detail` | Limit, used, remaining; detail adds category totals and entries |
| `get household budget` / `get household budget detail` | Shared budget reports |
| `total <name or ID>` / `total household` | All current-month transactions for that account |
| `lend 1000 to Alex` / `borrow 1000 from Alex` | Records lending/borrowing separately |
| `collect 500 from Alex` / `repay 500 to Alex` | Reduces outstanding loans for that exact name (case-insensitive) |
| `loans` / `household loans` | Outstanding balances across all months |
| `yes` / `cancel` / `help` | Save pending entry, discard, or show commands |

Use `set household shopping budget 10000` and `get household dine-out budget detail` for shared category limits. The main budget report also shows both category budgets. Shopping/dine-out expenses count in their category limit **and** the main limit; setting category limits does not change the main limit. `SHOPPING_CATEGORY` and `DINE_OUT_CATEGORY` must match the labels in your ten categories.

Prefix loan commands with `household` for shared loans. Amounts are positive, with up to two decimal places; currency comes from configuration. Expenses and loans require `yes` before saving. To correct a suggestion, cancel and use the guided `expense <amount>` flow. Gemini failures fall back to the numbered menu.

Each allowlisted sender can write their own account and the household account; both can view every configured account's totals. Groups and other senders are ignored. Ten configurable categories default to house expenses, groceries, fuel, dine-out, sports, utilities, shopping, health, travel, and other.

Months start on the 1st in `TIMEZONE`. Budget updates never erase spending and do not carry into the next month. **Used = expenses + money lent + borrowed-money repayments.** Borrowing and collecting lent money do not affect used; collections do not refund the original budget expenditure. Personal and household accounts are separate. Repayments cannot exceed the outstanding balance. Reuse the same counterparty spelling; balances span months. Budgets may go negative when exceeded. Transactions are dated when confirmed. Deletion/editing and automatic monthly budget renewal are not implemented.

## Local setup

1. Install Node.js 22+, clone this repo, run `npm ci`, and copy `.env.example` to `.env`.
2. Create a Google Cloud project, enable the **Google Sheets API**, create a service account and JSON key. Create an empty Google spreadsheet, share it with the service-account email as **Editor**, and share it privately with your household. Set its ID and the entire JSON key in `.env` as shown in the example. The bot creates a `Ledger` tab; keep its headers and machine-format rows intact. `AmountMinor` stores cents (400 means 4.00). Use another tab for custom formulas/views.
3. Set `USERS_JSON` to your users' stable IDs, display names, and WhatsApp identities (`<international digits>@c.us`, no `+`). WhatsApp may use `@lid` identities; include the actual sender's LID as an additional `whatsappIds` entry if needed. Obtain identities privately from your existing bot or WhatsApp tooling; never commit them. IDs/names must be unique; `household` is reserved. Sheet rows store configured account IDs, not phone numbers.
4. Optionally get a Gemini key from [Google AI Studio](https://aistudio.google.com/), set `GEMINI_API_KEY` and an available free-tier `GEMINI_MODEL`. Set `GEMINI_ENABLED=false` for guided-only input. Model availability, free quotas, and billing depend on your account: check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Only the free-text expense description is sent to Gemini; it may contain personal information you type. No sender ID is sent. Google's free-tier data terms apply; disabling Gemini avoids this transfer.
5. Run `npm test && npm run check`. Run `SHOW_QR=true npm start` in a private terminal, then scan using WhatsApp → Linked devices. A separate bot number is recommended; use a distinct session/client ID from other bots. Send commands from an allowlisted user to the linked bot number. Turn off `SHOW_QR` after pairing.

WhatsApp session and pending prompts live in `DATA_DIR`; preserve and back them up privately. Never run two copies against the same session/sheet: writes are serialized and deduplicated within one instance, not across multiple instances. Interrupted prompts survive restarts and expire after the configured idle time. Google Sheets is the authoritative ledger; unavailable Sheets means the bot cannot save/report. There is no offline ledger queue. Sheets API appends are not transactional: an unusually delayed write followed by a retry can still duplicate an entry; the normal read-before-retry path deduplicates by message hash.

## Oracle/Linux VM setup (one time)

Use a dedicated app directory and the SSH user's own Node.js 22+ and Chromium installation. On Ubuntu/Debian, install `rsync` and Chromium (`chromium` or `chromium-browser`, depending on the distribution); set `CHROME_EXECUTABLE_PATH` to its absolute path. Oracle ARM instances should use distribution Chromium, not Puppeteer's downloaded x86 browser. Installation differs by OS; see the [headless Linux guide](https://wwebjs.dev/guide/installation). Keep `CHROME_NO_SANDBOX=false` unless your environment requires otherwise.

1. Put the repo in your chosen `DEPLOY_PATH`, install dependencies with `PUPPETEER_SKIP_DOWNLOAD=true npm ci`, and create a private `.env`. Use an absolute `DATA_DIR` outside release staging paths, or the default `./data` inside the app directory.
2. Pair WhatsApp once with the local setup command on the VM; never capture the QR in GitHub Actions logs. Stop the foreground bot after pairing.
3. Copy `scripts/expense-tracker.service.example` to `/etc/systemd/system/expense-tracker.service`, replace its user, working directory and Node executable path. Run `sudo systemctl daemon-reload` and `sudo systemctl enable --now expense-tracker.service`. Use `sudo systemctl status expense-tracker.service` to check readiness. A service being active does not prove WhatsApp is linked or Sheets is reachable.
4. Give the deploy SSH user ownership of the app directory and narrowly scoped passwordless sudo for **only** `systemctl stop/start/is-active expense-tracker.service` (use the actual systemctl path from `command -v systemctl`). The workflow requires these commands; do not grant unrestricted sudo. Keep the existing chatbot in its own directory/service/session. Monitor memory when running two Chromium instances.

## Automatic GitHub deployment

Add these **GitHub Actions secrets** (Settings → Secrets and variables → Actions), then pushes to `main` test and deploy automatically. You can also use workflow dispatch. Fork PR tests never receive deployment secrets.

| Secret | Value |
| --- | --- |
| `ENV_FILE` | Complete populated `.env` contents, including Google service-account JSON, Gemini key, user identities and all settings |
| `SSH_HOST` | VM address/hostname |
| `SSH_USER` | Dedicated deployment OS user |
| `SSH_PORT` | Optional, defaults to `22` |
| `SSH_PRIVATE_KEY` | Dedicated SSH private key; install its public key on the VM |
| `SSH_KNOWN_HOSTS` | Verified host-key line(s), including `[host]:port` for nonstandard ports; verify fingerprint independently before trusting `ssh-keyscan` output |
| `DEPLOY_PATH` | Absolute app path using letters, digits, `/`, `.`, `_`, `-`; no spaces; use a dedicated directory |

Create a GitHub environment named `production` if using environment-scoped secrets. Set approvals there only if desired. Permit SSH from your deployment runner through the VM firewall/security list; GitHub-hosted runner IPs vary. Prefer a controlled runner/network if you need fixed IP allowlisting.

Every deployment transfers `ENV_FILE` over host-verified SSH and installs it with mode `600`. Dependencies/config are checked before stopping the service. The persistent data directory is preserved. The workflow checks service activity, not end-to-end WhatsApp health; after deployment send `help` and check a budget report. Updating the same service does not require pairing again. There is brief downtime during file replacement. If replacement/startup fails, the script restores the previous files and environment and restarts the service; keep a private backup of the persistent data separately.

## Privacy and operations

Never commit `.env`, keys, phone numbers, sheet IDs, QR codes, logs, session state or real expense data. `.gitignore` excludes common sensitive files, but review `git diff --cached` before every push. Keep secrets in `ENV_FILE`, restrict repo/VM/Sheet access, and rotate exposed credentials immediately. Authentication state is as sensitive as a password. Application logs omit message bodies, identities and API error payloads; initial configuration/startup errors should still be inspected privately. Ledger descriptions and configured names/IDs are private information stored in your own Sheet.

The bot uses [whatsapp-web.js](https://wwebjs.dev/), an unofficial WhatsApp Web client; account restrictions or upstream changes can interrupt service. Follow WhatsApp's terms. Do not use this for unsolicited messaging. Google Sheets writes use [RAW values](https://developers.google.com/workspace/sheets/api/guides/values) so user descriptions are not evaluated as formulas. README setup and command documentation should be updated with behavior changes.
