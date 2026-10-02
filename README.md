# WhatsApp expense tracker

A private Node.js bot using whatsapp-web.js, Google Sheets, and optional Gemini command translation. Runs as a separate systemd service on an existing Linux VM. No public web server or inbound application port is needed.

## Commands

| Message | Result |
| --- | --- |
| `expense 400` | Asks where/why, then a numbered category |
| `expense 4000 dinner at a restaurant` | Parses locally, asks for category, then confirmation |
| `gemini I spent 4000 on dinner at a restaurant` | Explicitly asks Gemini to translate the remaining text into one supported command |
| `expense 4000 dinner at a restaurant \| Dine-out` | Explicit category; asks for confirmation without Gemini |
| `expense 100 Brownzie` | Directly selects the named category and its funding budget |
| `add Brownzie household` | Links Brownzie to the shared household funding budget |
| `add Brownzie loan` | Links Brownzie to a budget named loan (not a lending transaction) |
| `add Brownzie` | Asks separate budget or another funding budget; then asks the amount/source |
| `add Brownzie NewFund` | Creates/uses NewFund and asks its limit if not set this month |
| `add category Pet supplies` / `add Pet supplies from Pet fund` | Guided creation or explicit multiword names |
| `categories` | Lists categories, menu numbers and funding budgets |
| `set budget 50000` | Updates your personal monthly limit |
| `set household budget 80000` | Updates the shared household monthly limit |
| `set shopping budget 10000` / `set dine-out budget 5000` | Updates separate funding budgets |
| `set <name> budget <amount>` | Creates/updates a named monthly funding budget |
| `budget` | Your personal limit, used and remaining |
| `budget <name>` | One funding budget, e.g. `budget household` or `budget loan` |
| `budget detail` / `budget detail <name>` | Personal/named remaining and totals, plus full expenses grouped by category |
| `budget all` | Each configured user's personal/named budgets and the shared household budget |
| `budget all detail` | Full expense lists grouped by budget, then category, with limits/totals/remaining |
| `total <configured name or ID>` / `total household` | Current-month transactions by sender or household funding |
| `lend 1000 to Alex` / `borrow 1000 from Alex` | Separate lending/borrowing ledger |
| `collect 500 from Alex` / `repay 500 to Alex` | Reduces outstanding balances for that name (case-insensitive) |
| `loans` / `household loans` | Outstanding personal/shared loans across all months |
| `yes` / `cancel` | Save pending entry or discard it |
| `help expense` / `help expenses` | Full command list; pending entries stay intact |

**A category is a label; a budget is its funding source.** Each expense consumes exactly one funding budget. Household is one shared funding budget: use `add Brownzie household`, not `household add Brownzie loan`. Household-funded categories are available to both users; rows still retain who paid. Other category definitions and named budgets belong to their creator. `budget <configured user name or ID>` also queries that person's personal budget. The older `get budget`, `get household budget`, and `get <name> budget detail` syntax remains an alias.

Shopping and dine-out use their own funding budgets and are excluded from the personal budget's used amount. Custom separate budgets behave the same way. A category using `personal` (also `main`/`overall`) consumes your personal budget. `SHOPPING_CATEGORY` and `DINE_OUT_CATEGORY` must match labels in your ten starting categories. Additional categories start at menu item 11, and Gemini receives the expanded category list when command translation is needed.

Months start on the 1st in `TIMEZONE`. Setting a limit mid-month retains all spending; limits do not carry into the next month. Each funding budget's **used = expenses + money lent + borrowed-money repayments assigned to it**. Ordinary `lend`/`repay` commands consume your personal budget; prefix loan commands with `household` for shared funding. Borrowing/collecting do not affect used or refund previous budget expenditure. Repayments cannot exceed the outstanding balance. Reuse the same counterparty spelling; loan balances span months. A budget named loan is only a funding label and does not create a debt record.

Amounts are positive with up to two decimals. Expenses/loans/category creation require `yes`; budget-limit commands update immediately. To correct a translated command, cancel and use the guided expense flow. Budgets can show negative remaining when exceeded. Definitions persist in the Ledger as `category` rows with zero `AmountMinor` and JSON funding descriptions; preserve these rows. Categories are permanent across months; funding cannot currently be reassigned. Deletion/editing and automatic budget renewal are not implemented. Values are trimmed at their beginning/end. All allowlisted users can view all budget reports; other senders and groups are ignored. Bare `help` is ignored for the solar bot.

## Local setup

1. Install Node.js 22+, clone this repo, run `npm ci`, and copy `.env.example` to `.env`.
2. Create a Google Cloud project, enable the **Google Sheets API**, create a service account and JSON key. Create an empty Google spreadsheet, share it with the service-account email as **Editor**, and share it privately with your household. Set its ID and the entire JSON key in `.env`. The JSON can span multiple lines inside single quotes: The bot creates a `Ledger` tab; keep its headers and machine-format rows intact. `AmountMinor` stores cents (400 means 4.00); category-definition rows use zero. Use another tab for custom formulas/views.

   ```dotenv
   GOOGLE_SERVICE_ACCOUNT_JSON='{
     "type": "service_account",
     "client_email": "YOUR_SERVICE_ACCOUNT_EMAIL",
     "private_key": "YOUR_PRIVATE_KEY_WITH_ORIGINAL_ESCAPED_NEWLINES"
   }'
   ```

   Paste the **complete downloaded JSON**, including all its fields, between the single quotes; this abbreviated example only illustrates formatting. Keep the `\n` escapes inside `private_key` exactly as downloaded. The same multiline format works inside GitHub's `ENV_FILE` secret.

3. Set `USERS_JSON` to your users' stable IDs, display names, and WhatsApp identities (`<international digits>@c.us`, no `+`). WhatsApp may use `@lid` identities; include the actual sender's LID as an additional `whatsappIds` entry if needed. Obtain identities privately from your existing bot or WhatsApp tooling; never commit them. IDs/names must be unique; `household` is reserved. Sheet rows store configured account IDs, not phone numbers.
4. Optionally get a Gemini key from [Google AI Studio](https://aistudio.google.com/), set `GEMINI_API_KEY` and an available free-tier `GEMINI_MODEL`. Set `GEMINI_ENABLED=false` for guided-only input. Model availability, free quotas, and billing depend on your account: check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Only messages starting with `gemini` send their remaining text to Gemini (including any personal information you type), along with the exact `help expense` response and available category names. No sender ID, credentials or ledger rows are sent. Other unrecognized input is ignored. Valid commands and active prompt replies stay local. Google's free-tier data terms apply; disabling Gemini avoids this transfer.
5. Run `npm test && npm run check`. Run `SHOW_QR=true npm start` in a private terminal, then scan using WhatsApp → Linked devices. A separate bot number is recommended; use a distinct session/client ID from other bots. Send commands from an allowlisted user to the linked bot number. Turn off `SHOW_QR` after pairing.

WhatsApp session and pending prompts live in `DATA_DIR`; preserve and back them up privately. Never run two copies against the same session/sheet: writes are serialized and deduplicated within one instance, not across multiple instances. Interrupted prompts survive restarts and expire after the configured idle time. Google Sheets is the authoritative ledger; unavailable Sheets means the bot cannot save/report. There is no offline ledger queue. Sheets API appends are not transactional: an unusually delayed write followed by a retry can still duplicate an entry; the normal read-before-retry path deduplicates by message hash.

## Explicit Gemini commands

Only `gemini <request>` invokes Gemini. It receives the complete request after the prefix (trimmed at the edges), the exact command-help response, and existing category names. Unrecognized messages without this prefix are ignored without a reply or API call. `gemini` alone shows usage; finish or cancel a pending entry before using Gemini. A strict JSON schema requests only `{"command":"..."}`; the shared local parser validates the result before dispatch. Extra fields, unknown commands, multiple lines, invalid amounts, unknown explicit categories and fabricated confirmation replies are rejected. There is one initial generation plus **three retries** for invalid output, each with corrective feedback; no invalid attempt writes to Sheets. Authentication/quota/service errors return the local fallback immediately. Generated commands never recursively invoke Gemini. The reply shows `Interpreted as: ...` before the normal command result; expenses still require `yes`, while budget-limit commands update immediately, just like typed commands. If translation fails, use `help expense` and enter a supported command directly. Canonical commands such as `expense 4000 dinner at a restaurant` no longer invoke AI: they ask for a category unless the description is an exact category name or uses `| <category>`.

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

Every deployment transfers `ENV_FILE` over host-verified SSH and installs it with mode `600`. Dependencies/config are checked before stopping the service. The persistent data directory is preserved. The workflow checks service activity, not end-to-end WhatsApp health; after deployment send `help expense` and check a budget report. Updating the same service does not require pairing again. There is brief downtime during file replacement. If replacement/startup fails, the script restores the previous files and environment and restarts the service; keep a private backup of the persistent data separately.

## Privacy and operations

Never commit `.env`, keys, phone numbers, sheet IDs, QR codes, logs, session state or real expense data. `.gitignore` excludes common sensitive files, but review `git diff --cached` before every push. Keep secrets in `ENV_FILE`, restrict repo/VM/Sheet access, and rotate exposed credentials immediately. Authentication state is as sensitive as a password. Application logs omit message bodies, identities and API error payloads; initial configuration/startup errors should still be inspected privately. Ledger descriptions and configured names/IDs are private information stored in your own Sheet.

The bot uses [whatsapp-web.js](https://wwebjs.dev/), an unofficial WhatsApp Web client; account restrictions or upstream changes can interrupt service. Follow WhatsApp's terms. Do not use this for unsolicited messaging. Google Sheets writes use [RAW values](https://developers.google.com/workspace/sheets/api/guides/values) so user descriptions are not evaluated as formulas. README setup and command documentation should be updated with behavior changes.
