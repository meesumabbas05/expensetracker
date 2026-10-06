# iPhone Expense Tracker: guided menus and direct sending

This shortcut asks for the action and its details, then sends the command directly to your Discord expense channel. It does not open Discord. Completed entries save without a confirmation message. Undo reverses your latest saved change.

## 1. Create two Discord webhooks

Use Discord on a computer for this setup:

1. Open your private server.
2. Click the server name, then **Server Settings**.
3. Select **Integrations**, then **Webhooks**.
4. Click **New Webhook** or **Create Webhook**.
5. Name it `Expenses - Meesum`.
6. Select the same expense channel configured in `DISCORD_CHANNEL_ID`.
7. Save changes and click **Copy Webhook URL**. Keep this URL privately for your phone.
8. Create another webhook named `Expenses - Wife`, select the same channel, and keep its URL privately for her phone.

These are the channel integrations described in [Discord's webhook guide](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks).

Each copied URL has this shape:

```text
https://discord.com/api/webhooks/WEBHOOK_ID/PRIVATE_TOKEN
```

The long number immediately after `/webhooks/` is the **webhook ID**. It is different from a person, channel or server ID. The full URL contains a private token: anyone with it can send commands as the person mapped to that webhook. Keep each person's URL private; do not commit it or put the bot token on a phone.

## 2. Map each webhook to its person in the environment

Keep each person's existing `id`, `name`, `discordIds`, and any `whatsappIds` unchanged. Add this property inside that person's object in `USERS_JSON`:

```json
"discordWebhookIds": ["THAT_PERSONS_NUMERIC_WEBHOOK_ID"]
```

For example, if an object currently ends like this:

```json
"discordIds": ["EXISTING_DISCORD_USER_ID"]
```

change that ending to:

```json
"discordIds": ["EXISTING_DISCORD_USER_ID"],
"discordWebhookIds": ["THAT_PERSONS_NUMERIC_WEBHOOK_ID"]
```

The comma between properties matters. Replace the placeholders with actual IDs, keeping the quotation marks. Put your webhook ID in your object and your wife's webhook ID in hers. Do not put a full webhook URL here.

Also check these existing settings:

```dotenv
BOT_TRANSPORT=discord
DISCORD_CHANNEL_ID=YOUR_EXPENSE_CHANNEL_ID
```

Keep `DISCORD_BOT_TOKEN` as it is. No additional top-level environment variable is needed.

For GitHub deployment:

1. Open your repository on GitHub.
2. Open **Settings → Secrets and variables → Actions**.
3. Edit the existing **ENV_FILE** secret.
4. Make the `USERS_JSON` additions above and check `DISCORD_CHANNEL_ID`.
5. Save the secret.
6. Open **Actions → Verify and deploy → Run workflow**, select `main`, and run it. Alternatively, rerun the latest deployment after saving the secret.
7. Wait for both the test and deployment jobs to succeed.

If running locally, make the same changes in your local `.env`. Editing only a local `.env` does not update GitHub deployment configuration.

## 3. Create the shortcut

On your iPhone:

1. Open **Shortcuts**.
2. Open the **Shortcuts** tab and tap **+**.
3. Name the new shortcut **Expense Tracker**.

Search for an action by its name to add it. Press and hold an action to drag it into position. For menu branches, place the actions under their option and before the next option. See [Apple's menu guide](https://support.apple.com/guide/shortcuts/use-the-choose-from-menu-action-apdd7bf369da/ios).

**Variables:** after an Ask for Input action, add Set Variable. Give it the specified name and select the preceding Provided Input as its value. When a Text action below contains `[Amount]` or another bracketed name, insert that saved variable using the variable picker. Do not type the brackets or variable name literally: the variable appears as a coloured bubble.

## 4. Create the main menu

Add **Choose from Menu** with prompt `What would you like to do?` and these options:

- Add expense
- Set budget
- Add new budget
- Add category
- View budgets
- Undo last change
- Cancel unfinished input

Shortcuts creates a section for each option, followed by End Menu. Build each section below. Every section ends by setting the same variable, `Message`.

## 5. Add expense

Inside **Add expense**, add these actions in order:

1. **Ask for Input**: prompt `How much did you spend?`, type **Number**.
2. **Set Variable**: `Amount` = preceding Provided Input.
3. **Ask for Input**: prompt `What was this for?`, type **Text**.
4. **Set Variable**: `Description` = preceding Provided Input.
5. **Choose from Menu**: prompt `Which budget?`; options Household, Shopping & Dine-out, Individual, Investments.

Inside each of these four budget branches, add a **List** with its categories. Each category is a separate item:

| Budget | List items |
| --- | --- |
| Household | House expenses; Groceries; Fuel |
| Shopping & Dine-out | Shopping; Dine-out |
| Individual | Sports; Utilities; Health; Travel; Other |
| Investments | Short-term; Long-term |

After each branch's List, add **Set Variable**: `CategoryOptions` = that List. Use the same variable name in all four branches.

After this inner budget menu's **End Menu**, still inside Add expense, add:

6. **Choose from List**: input `CategoryOptions`, prompt `Which category?`, Select Multiple **Off**.
7. **Set Variable**: `Category` = Chosen Item.
8. **Text** containing:

   ```text
   expense [Amount] [Description] | [Category]
   ```

9. **Set Variable**: `Message` = that Text.

The category determines the funding budget. Household, Shopping & Dine-out, and Investments are shared. Individual belongs to the person whose webhook sent the command.

Amounts must be positive, with at most two decimal places and no commas. For example, enter `1500`, not `1,500`.

## 6. Set budget

Inside **Set budget**, add:

1. **List** with four separate items: `household`, `shopping`, `individual`, `investments`.
2. **Choose from List**: input the List, prompt `Which monthly budget?`, Select Multiple Off.
3. **Set Variable**: `BudgetKey` = Chosen Item.
4. **Ask for Input**: prompt `What should the monthly limit be?`, type Number.
5. **Set Variable**: `BudgetAmount` = Provided Input.
6. **Text**:

   ```text
   set [BudgetKey] budget [BudgetAmount]
   ```

7. **Set Variable**: `Message` = that Text.

`shopping` sets one combined Shopping & Dine-out limit. Either person can update shared limits. Individual changes only the sender's limit. Setting a limit retains existing spending for the month.

## 7. Add new budget

Inside **Add new budget**, add:

1. **Ask for Input**: prompt `What is the new budget called?`, type Text.
2. **Set Variable**: `BudgetName` = Provided Input.
3. **Ask for Input**: prompt `What is its monthly limit?`, type Number.
4. **Set Variable**: `BudgetAmount` = Provided Input.
5. **Text**:

   ```text
   set [BudgetName] budget [BudgetAmount]
   ```

6. **Set Variable**: `Message` = that Text.

New custom budgets are personal. For example, `set Holiday budget 20000` creates Holiday for the sender. Add a category funded by Holiday before recording expenses against it.

## 8. Add category

Inside **Add category**, add:

1. **Ask for Input**: prompt `What is the new category called?`, type Text.
2. **Set Variable**: `NewCategory` = Provided Input.
3. **Ask for Input**: prompt `Which budget? Enter household, shopping, individual, investments, or your custom budget name.`, type Text.
4. **Set Variable**: `FundingBudget` = Provided Input.
5. **Text**:

   ```text
   add [NewCategory] from [FundingBudget]
   ```

6. **Set Variable**: `Message` = that Text.

Examples: `add Pet supplies from household`, or `add Flights from Holiday`. Existing built-in budgets already have a default limit, so category creation completes immediately. A new custom funding budget without a monthly limit will ask for the missing amount in Discord. To finish entirely through these menu options, create its limit with Add new budget first.

The shortcut's category lists are static. After creating a category, add its name to the appropriate List in Add expense. For a custom budget, add another branch to the inner budget menu, with a List of its categories and Set Variable `CategoryOptions` to that List.

## 9. View budgets

Inside **View budgets**, add:

1. **List** with separate items: `all`, `household`, `shopping`, `individual`, `investments`.
2. **Choose from List**: input the List, prompt `Which budget?`, Select Multiple Off.
3. **Set Variable**: `ReportBudget` = Chosen Item.
4. **Text**:

   ```text
   budget [ReportBudget]
   ```

5. **Set Variable**: `Message` = that Text.

The bot posts the report in Discord, including who entered shared spending. Add `detail` after `budget` to include full entry lists. For all details, use `budget all detail` (putting detail before all is not that command).

Webhook sending does not return the bot's later reply to Shortcuts. Read reports in the channel when convenient; the shortcut does not automatically open Discord.

## 10. Undo and cancel

Inside **Undo last change**:

1. Add **Text** containing only `undo`.
2. Add **Set Variable**: `Message` = that Text.

Inside **Cancel unfinished input**:

1. Add **Text** containing only `cancel`.
2. Add **Set Variable**: `Message` = that Text.

Undo reverses your latest saved expense, loan, budget update or category creation. Each person undoes their own changes. Viewing reports does not change what undo targets. Budget undo restores the prior applicable limit; category creation and its initial limit undo together. If another saved entry depends on a category or loan principal, those dependent entries must be undone first. Repeated undo commands work backwards through your saved changes.

Cancel discards only unfinished input. There is no Confirm pending entry option and no `yes` step.

## 11. Send directly without opening Discord

Scroll below the main menu's final **End Menu**, outside every branch.

If updating your old shortcut, remove **Copy to Clipboard**, the channel-link **URL**, and **Open URLs** from this position.

Add:

1. **URL**: paste **your full private webhook URL** and append `?wait=true` to its end.
2. **Get Contents of URL**: select the URL above. Expand the action's settings (Show More or its expansion arrow).
3. Set **Method** to **POST**.
4. Set **Request Body** to **JSON**.
5. Add a field with key `content`, type **Text**, and value the saved variable `Message`.

Use the Message variable bubble, not the literal word Message. No Authorization header or Discord bot token is needed. Apple's [API guide](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios) explains configuring POST and a JSON body.

The URL should have this shape:

```text
https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_PRIVATE_TOKEN?wait=true
```

With `wait=true`, Discord returns the posted message after delivery, as described in [Discord's execute webhook reference](https://docs.discord.com/developers/resources/webhook#execute-webhook). This confirms delivery to Discord, not successful saving by the expense bot.

To show a useful delivery notification, add after Get Contents of URL:

6. **Get Dictionary Value**: key `id`, input the result of Get Contents of URL.
7. **If**: Dictionary Value **has any value**.
8. Inside If, **Show Notification**: `Sent to Expense Tracker`.
9. Inside Otherwise, **Show Alert**: `Discord did not accept this message. Check the webhook URL and try again.`

Keep the notification text as “Sent”, not “Saved”: the bot processes the posted command separately. A network failure can stop the shortcut before these actions. Check the Discord channel before resending if delivery is uncertain.

There should be no Open URLs action in this final sending block.

## 12. Try it

1. Run the shortcut and choose Add expense.
2. Enter `100`, description `Shortcut test`, budget Household, category Groceries.
3. Allow the shortcut to contact `discord.com` if iOS asks on first use.
4. The shortcut should send without opening Discord.
5. For this first setup check, open the channel yourself. Look for the command and the bot's **Saved expense** reply showing the right person and budget.
6. Run the shortcut again, choose Undo last change, and check for the bot's **Undid expense** reply. The test expense no longer counts in your totals.

If only the webhook's command appears, check the bot is online, Message Content Intent is enabled, the webhook ID is mapped to its person in deployed USERS_JSON, and its channel matches DISCORD_CHANNEL_ID. A Discord delivery notification alone does not verify these.

## 13. Home Screen and your wife's phone

Open the shortcut's menu beside its name, select **Add to Home Screen**, name the icon Expenses, and tap Add. See [Apple's Home Screen guide](https://support.apple.com/guide/shortcuts/add-a-shortcut-to-the-home-screen-apd735880972/ios).

For your wife, duplicate the shortcut and remove your private webhook URL before sharing the template through AirDrop. On her phone, add the shortcut and paste **her** webhook URL into the final URL action, adding `?wait=true`. Then add it to her Home Screen.

The webhook URL identifies the person independently of which Discord account is logged into the phone. Sharing one URL between both phones would attribute both phones' entries to the same person. Their menus can otherwise be identical.
