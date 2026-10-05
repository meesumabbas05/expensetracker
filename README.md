# Expense tracker

A private Node.js bot using either WhatsApp Web (whatsapp-web.js) or Discord (discord.js), Google Sheets, and optional Gemini command translation. Select one transport with `BOT_TRANSPORT`; both use the same commands, account IDs and ledger. Runs as a single PM2 process on a Linux VM. No public web server or inbound application port is needed.

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

Amounts are positive with up to two decimals. Expenses/loans/category creation require `yes`; budget-limit commands update immediately. To correct a translated command, cancel and use the guided expense flow. Budgets can show negative remaining when exceeded. Definitions persist in the Ledger as `category` rows with zero `AmountMinor` and JSON funding descriptions; preserve these rows. Categories are permanent across months; funding cannot currently be reassigned. Deletion/editing and automatic budget renewal are not implemented. Values are trimmed at their beginning/end. All allowlisted users can view all budget reports. WhatsApp accepts direct chats only; Discord accepts DMs and, if configured, one server channel. Other senders and channels are ignored. Bare `help` is ignored for the solar bot.

## Local setup

1. Install Node.js 22+, clone this repo, run `npm ci` (use `PUPPETEER_SKIP_DOWNLOAD=true npm ci` for Discord), then run `cp .env.example .env`. Open `.env` and replace the example user identities and credential placeholders with your own values. The sample includes both transports; select one with `BOT_TRANSPORT`. Keep your populated `.env` private.
2. Create a Google Cloud project, enable the **Google Sheets API**, create a service account and JSON key. Create an empty Google spreadsheet, share it with the service-account email as **Editor**, and share it privately with your household. Set its ID and the entire JSON key in `.env`. The JSON can span multiple lines inside single quotes: The bot creates a `Ledger` tab; keep its headers and machine-format rows intact. `AmountMinor` stores cents (400 means 4.00); category-definition rows use zero. Use another tab for custom formulas/views.

   ```dotenv
   GOOGLE_SERVICE_ACCOUNT_JSON='{
     "type": "service_account",
     "client_email": "YOUR_SERVICE_ACCOUNT_EMAIL",
     "private_key": "YOUR_PRIVATE_KEY_WITH_ORIGINAL_ESCAPED_NEWLINES"
   }'
   ```

   Paste the **complete downloaded JSON**, including all its fields, between the single quotes; this abbreviated example only illustrates formatting. Keep the `\n` escapes inside `private_key` exactly as downloaded. The same multiline format works inside GitHub's `ENV_FILE` secret.

3. Choose the transport and configure identities as described below. For WhatsApp, set `USERS_JSON` to your users' stable IDs, display names, and WhatsApp identities (`<international digits>@c.us`, no `+`). WhatsApp may use `@lid` identities; include the actual sender's LID as an additional `whatsappIds` entry if needed. Obtain identities privately from your existing bot or WhatsApp tooling; never commit them. IDs/names must be unique; `household` is reserved. Sheet rows store configured account IDs, not phone numbers.
4. Optionally get a Gemini key from [Google AI Studio](https://aistudio.google.com/), set `GEMINI_API_KEY` and an available free-tier `GEMINI_MODEL`. Set `GEMINI_ENABLED=false` for guided-only input. Model availability, free quotas, and billing depend on your account: check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Only messages starting with `gemini` send their remaining text to Gemini (including any personal information you type), along with the exact `help expense` response and available category names. No sender ID, credentials or ledger rows are sent. Other unrecognized input is ignored. Valid commands and active prompt replies stay local. Google's free-tier data terms apply; disabling Gemini avoids this transfer.
5. Ensure Bash and rsync are installed for the deployment tests (on Ubuntu: `sudo apt install -y rsync`), then run `npm test && npm run check`. The deployment tests use a simulated PM2 process and do not contact your running bots. For Discord, use the setup below and run `npm start`. For WhatsApp, run `SHOW_QR=true npm start` in a private terminal, then scan using WhatsApp → Linked devices. A separate bot number is recommended; use a distinct session/client ID from other bots. Send commands from an allowlisted user to the linked bot number. Turn off `SHOW_QR` after pairing.

WhatsApp authentication and pending prompts live in `DATA_DIR`; preserve and back them up privately. Never run two copies against the same session/sheet: writes are serialized and deduplicated within one instance, not across multiple instances. Interrupted prompts survive restarts and expire after the configured idle time. Google Sheets is the authoritative ledger; unavailable Sheets means the bot cannot save/report. There is no offline ledger queue. Sheets API appends are not transactional: an unusually delayed write followed by a retry can still duplicate an entry; the normal read-before-retry path deduplicates by message hash.

## Choose WhatsApp or Discord

```dotenv
# Default when omitted; starts exactly one transport.
BOT_TRANSPORT=whatsapp
# Switch to Discord instead:
# BOT_TRANSPORT=discord
```

Keep each user's existing `id` and `name` when switching so their expenses, categories and budgets still belong to the same account. Both sets of identities can live in `USERS_JSON`; only the selected transport's identities are required and validated. Use string IDs, not JSON numbers. Example placeholders:

```dotenv
USERS_JSON='[{"id":"one","name":"Person One","whatsappIds":["1234567890@c.us"],"discordIds":["123456789012345678"]},{"id":"two","name":"Person Two","whatsappIds":["2345678901@c.us"],"discordIds":["234567890123456789"]}]'
```

Change `BOT_TRANSPORT` in the environment and restart the service. For GitHub deployment, update `ENV_FILE` too. Reuse the same Google Sheet, account IDs and `DATA_DIR`. WhatsApp authentication stays available when switching back; pending prompts still belong to their configured user and retain their normal expiry. Send `cancel` if you want to discard an unfinished prompt. Run only one instance against the sheet.

### Discord setup

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Store the bot token privately in `DISCORD_BOT_TOKEN`.
2. In Discord's Settings → Advanced, enable Developer Mode, then copy each person's **user ID** into their `discordIds` array. Keep the existing internal account IDs.
3. Add the bot to your private server using the portal's installation link. For server channel use, grant View Channel, Send Messages and Read Message History in the chosen channel.
4. Configure:

   ```dotenv
   BOT_TRANSPORT=discord
   DISCORD_BOT_TOKEN=YOUR_PRIVATE_BOT_TOKEN
   # Leave empty for DMs only. Optionally copy one private server channel ID:
   DISCORD_CHANNEL_ID=
   ```

   DMs from configured users work in either mode. Setting `DISCORD_CHANNEL_ID` also allows messages from those users in exactly that server channel. Enable **Message Content Intent** on the portal's Bot page for server channel use; DM-only mode does not request this privileged intent. See the [discord.js intents guide](https://discordjs.guide/legacy/popular-topics/intents) and [Discord's message content FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055-Message-Content-Privileged-Intent-FAQ).
5. Install with `PUPPETEER_SKIP_DOWNLOAD=true npm ci`, then run `npm run check && npm test && npm start`. Send `help expense` to the bot in a DM or the configured channel. Use the same plain text commands and numbered/`yes` replies as WhatsApp; slash commands are not implemented.

Discord mode needs no Chromium, QR pairing or public application port. Only its adapter is loaded at runtime. Replies stay in the chat where the command was sent, so choose a private channel for financial reports. Message text never triggers Discord mentions in bot replies. Long reports are split into messages within Discord's 2,000-character limit.

## Explicit Gemini commands

Only `gemini <request>` invokes Gemini. It receives the complete request after the prefix (trimmed at the edges), the exact command-help response, and existing category names. Unrecognized messages without this prefix are ignored without a reply or API call. `gemini` alone shows usage; finish or cancel a pending entry before using Gemini. A strict JSON schema requests only `{"command":"..."}`; the shared local parser validates the result before dispatch. Extra fields, unknown commands, multiple lines, invalid amounts, unknown explicit categories and fabricated confirmation replies are rejected. There is one initial generation plus **three retries** for invalid output, each with corrective feedback; no invalid attempt writes to Sheets. Authentication/quota/service errors return the local fallback immediately. Generated commands never recursively invoke Gemini. The reply shows `Interpreted as: ...` before the normal command result; expenses still require `yes`, while budget-limit commands update immediately, just like typed commands. If translation fails, use `help expense` and enter a supported command directly. Canonical commands such as `expense 4000 dinner at a restaurant` no longer invoke AI: they ask for a category unless the description is an exact category name or uses `| <category>`.

## First deployment on Oracle Ubuntu with PM2

Run these commands in the Ubuntu VM's SSH terminal as the same user that will
run GitHub deployments (usually `ubuntu`). First push the current code to GitHub.

1. Install Node.js 22+ using the [NodeSource Ubuntu instructions](https://github.com/nodesource/distributions/blob/master/DEV_README.md), then install Git, rsync, and PM2:

   ```bash
   sudo apt update
   sudo apt install -y git rsync
   sudo npm install -g pm2
   node -v
   pm2 -v
   ```

   If PM2 is already installed for this user, reuse it. Discord mode needs no
   Chromium installation. WhatsApp mode needs Chromium and one-time QR pairing;
   use distribution Chromium on Oracle ARM VMs and set `CHROME_EXECUTABLE_PATH`.

2. Clone your repository into a dedicated directory. For this repository:

   ```bash
   git clone https://github.com/meesumabbas05/expensetracker.git "$HOME/expensetracker"
   cd "$HOME/expensetracker"
   chmod 700 .
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

   Populate the example with your credentials, user identities and transport.
   In nano, save with Ctrl+O, Enter, then exit with Ctrl+X. Keep account IDs and
   `DATA_DIR` stable; pending prompts and WhatsApp authentication live there.

3. Install dependencies, check the code, and test the bot in the foreground:

   ```bash
   PUPPETEER_SKIP_DOWNLOAD=true npm ci
   npm run check
   npm test
   npm start
   ```

   Send `help expense` and `budget` from each configured user's account. Once the
   bot replies, press Ctrl+C in the SSH terminal to stop the foreground copy.

4. Start the bot with PM2, from the project directory:

   ```bash
   pm2 start ecosystem.config.json --only expense-tracker
   pm2 save
   pm2 startup
   ```

   `pm2 startup` prints a **sudo command**. Copy and run that exact command to
   enable startup after a reboot, then run `pm2 save` again. If this user already
   has a working PM2 startup service, save the updated process list with `pm2 save`.
   See [PM2 startup documentation](https://pm2.keymetrics.io/docs/usage/startup/).

5. Check the process and its logs, then test `budget` again from Discord:

   ```bash
   pm2 status
   pm2 logs expense-tracker --lines 30
   ```

   Press Ctrl+C to exit log viewing; the bot keeps running. To restart after
   changing `.env`, use `pm2 restart expense-tracker --update-env`.

The ecosystem file runs one instance in fork mode and allows up to 60 seconds
for graceful shutdown. Keep other projects under their own PM2 process names.
If you previously installed the optional `expense-tracker.service` systemd unit,
stop and disable it before starting this bot with PM2, so only one instance runs.

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

The SSH user must own `DEPLOY_PATH` and have Node.js, npm, rsync and PM2 available in a non-interactive SSH session. Deployments use that user's PM2 daemon; routine deployment needs no sudo. For example, use `SSH_USER=ubuntu` and `DEPLOY_PATH=/home/ubuntu/expensetracker`. The workflow uploads the code, so the VM does not need GitHub credentials.

Every deployment transfers `ENV_FILE` over host-verified SSH and installs it with mode `600`. Dependencies/config are checked before stopping the service. The persistent data directory is preserved. The workflow checks that the single PM2 process is online, not end-to-end transport health; after deployment send `help expense` and check a budget report. Updating the same PM2 process does not require pairing again. There is brief downtime during file replacement. If replacement/startup fails, the script restores the previous files and environment and restarts an existing PM2 process; on a failed first deployment it removes the unsuccessful new process; keep a private backup of the persistent data separately.

## Privacy and operations

Never commit `.env`, keys, phone numbers, Discord tokens/identities, sheet IDs, QR codes, logs, session state or real expense data. `.gitignore` excludes common sensitive files, but review `git diff --cached` before every push. Keep secrets in `ENV_FILE`, restrict repo/VM/Sheet access, and rotate exposed credentials immediately. Authentication state is as sensitive as a password. Application logs omit message bodies, identities and API error payloads; initial configuration/startup errors should still be inspected privately. Ledger descriptions and configured names/IDs are private information stored in your own Sheet.

The bot uses [whatsapp-web.js](https://wwebjs.dev/), an unofficial WhatsApp Web client; account restrictions or upstream changes can interrupt service. Follow WhatsApp's terms. Do not use this for unsolicited messaging. Google Sheets writes use [RAW values](https://developers.google.com/workspace/sheets/api/guides/values) so user descriptions are not evaluated as formulas. README setup and command documentation should be updated with behavior changes.
