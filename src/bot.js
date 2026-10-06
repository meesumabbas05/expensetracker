import { amount, dateParts, money, loans, categoryDefinitions, fundingOf, fundingSummary, canonicalBudget } from './domain.js';
import { translateCommand } from './extract.js';
import { parseCommand, validGeneratedCommand } from './commands.js';
export class Bot {
  constructor(config, store, sessions, saveSessions, now = () => new Date()) {
    Object.assign(this, { config, store, sessions, saveSessions, now });
  }
  fmt(n) { return money(n, this.config.currency); }
  menu(categories = this.config.categories) { return categories.map((c, i) => `${i + 1}. ${c}`).join('\n'); }
  help() {
    return `Commands (positive amounts, up to 2 decimals):\nexpense 400\ngemini <request> — explicitly translate a request into a command\nexpense 4000 dinner at a restaurant\nexpense 100 Brownzie\nexpense <amount> <description> | <category>\nset budget 25000 / set individual budget 25000\nset household budget 80000\nset shopping budget 25000 — Shopping and Dine-out share this limit\nset investments budget 25000\nset <budget name> budget <amount>\nbudget — your individual budget\nbudget <name> — one funding budget\nbudget detail <name> — remaining, totals and entries by category\nbudget detail — individual details\nbudget all — each budget separately\nbudget all detail — all entries grouped by budget and category\nget budget / get budget detail (legacy aliases)\ntotal <configured name or ID> / total household\nlend 1000 to Alex / borrow 1000 from Alex\ncollect 500 from Alex / repay 500 to Alex\nloans / household loans\nadd <category> — choose separate or existing funding\nadd <category> household / add <category> loan\nadd <category> <budget>\nadd category <multiword category name>\nadd <category> from <multiword budget name>\ncategories\ncancel / help expense / help expenses\nReply yes to save pending entries. Household funding is shared; other budgets belong to the sender. Each expense uses one funding budget. Months start on the 1st; budget updates retain spending.`;
  }
  async handle(actor, text, messageId, translated = false) {
    text = text.trim();
    if (!text || text.length > 1000) return 'Send a command under 1,000 characters. Try help expense.';
    const lower = text.toLowerCase();
    if (lower === 'help') return null;
    if (/^help\s+expenses?$/.test(lower)) return this.help();
    if (lower === 'cancel' || lower === 'no') { delete this.sessions[actor.id]; await this.saveSessions(); return 'Entry cancelled.'; }
    const rows = await this.store.rows();
    let pending = this.sessions[actor.id];
    if (pending && this.now().getTime() - pending.updated > this.config.ttl) { delete this.sessions[actor.id]; await this.saveSessions(); pending = null; }
    const geminiRequest = text.match(/^gemini(?:\s+([\s\S]*))?$/i);
    if (pending && geminiRequest) return 'Finish the pending entry or send cancel before using gemini.';
    if (pending) {
      if (this.config.categoryFunding && pending.kind === 'expense' && pending.category) {
        pending.funding = categoryDefinitions(rows, actor.id, this.config).find(d => d.name === pending.category)?.source || 'Budget';
        if (pending.account === 'household' && pending.funding !== 'household') return 'That category is not funded by household. Send cancel and enter expense without the household prefix.';
      }
      if (pending.lastMessageId === messageId) return this.prompt(pending);
      if (pending.kind === 'category') return this.handleCategory(actor, text, messageId, pending, rows);
      if (pending.stage === 'confirm') {
        if (lower !== 'yes') return 'Reply yes to save, or cancel to discard.';
        // Category funding never converts an expense into lending or borrowing.
        if (['collect', 'repay'].includes(pending.kind) && !rows.some(r => r.id === pending.id)) {
          const side = pending.kind === 'collect' ? 'lent' : 'borrowed';
          const balance = loans(rows, pending.account).find(l => l.side === side && l.person.toLowerCase() === pending.description.toLowerCase())?.amount || 0;
          if (pending.amount > balance) return `Outstanding ${side} balance for this person is ${this.fmt(balance)}. Cancel and enter a smaller amount.`;
        }
        const date = this.now();
        const row = { ...pending, ...dateParts(date, this.config.timezone), timestamp: date.toISOString(), actor: actor.id };
        await this.store.append(row);
        delete this.sessions[actor.id]; await this.saveSessions();
        return `Saved ${row.kind}: ${this.fmt(row.amount)} — ${row.description} (${row.account}).`;
      }
      if (pending.stage === 'description') {
        if (text.length > 200) return 'Use a description under 200 characters.';
        pending.description = text; pending.stage = 'category';
      } else {
        const options = pending.options || categoryDefinitions(rows, pending.account, this.config).map(d => d.name);
        if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > options.length) return `Reply with a category number 1–${options.length}:\n${this.menu(options)}`;
        pending.category = options[Number(text) - 1]; pending.stage = 'confirm';
      }
      if (pending.kind === 'expense' && pending.category) pending.funding = categoryDefinitions(rows, pending.account, this.config).find(d => d.name === pending.category)?.source || 'Budget';
      pending.updated = this.now().getTime(); pending.lastMessageId = messageId; await this.saveSessions();
      return this.prompt(pending);
    }
    if (rows.some(r => r.id === messageId)) return 'This entry has already been saved.';
    const categoryNames = categoryDefinitions(rows, actor.id, this.config).map(d => d.name);
    if (geminiRequest && !translated) {
      const input = (geminiRequest[1] || '').trim();
      if (!input) return 'Use gemini <request>, for example: gemini I spent 400 on dinner.';
      const command = await translateCommand(input, this.config, this.help(), categoryNames, validGeneratedCommand);
      if (!command) return 'Could not translate the Gemini request. Check Gemini configuration or use help expense to enter a command directly.';
      const reply = await this.handle(actor, command, messageId, true);
      return reply === null ? null : `Interpreted as: ${command}\n\n${reply}`;
    }
    const parsedCommand = parseCommand(text, categoryNames);
    if (!parsedCommand?.valid) return null;
    const month = dateParts(this.now(), this.config.timezone).month;
    const scope = lower.startsWith('household ') ? 'household' : actor.id;
    const scopedText = text.replace(/^household\s+/i, '').trim();
    if (/^add\s+/i.test(scopedText)) {
      if (scope === 'household') return 'Use add <category> household to fund a category from the household budget.';
      return this.startCategory(actor, scopedText, actor.id, messageId, rows);
    }
    if (scopedText.toLowerCase() === 'categories') return categoryDefinitions(rows, scope, this.config).map((d, i) => `${i + 1}. ${d.name} → ${d.source === 'Budget' ? 'individual budget' : d.source === 'household' ? 'household budget' : d.source}`).join('\n');
    const budgetQuery = text.match(/^budget(?:\s+(.*))?$/i);
    if (budgetQuery) {
      const query = (budgetQuery[1] || '').trim();
      if (/^all(?:\s+detail)?$/i.test(query)) return this.allBudgets(rows, actor.id, month, /detail$/i.test(query));
      const detail = /^detail(?:\s|$)/i.test(query);
      const name = detail ? query.replace(/^detail/i, '').trim() : query;
      return this.reportBudget(rows, actor.id, month, name || 'personal', detail);
    }
    // Keep older get commands as aliases for the explicit funding-budget reports.
    const legacy = text.match(/^get\s+(?:(.+?)\s+)?budget(\s+detail)?$/i);
    if (legacy) return this.reportBudget(rows, actor.id, month, legacy[1]?.trim() || 'personal', Boolean(legacy[2]));
    if (lower.startsWith('total ')) {
      const name = lower.slice(6).trim();
      const account = name === 'household' ? 'household' : this.config.users.find(u => [u.id.toLowerCase(), u.name.toLowerCase()].includes(name))?.id;
      if (!account) return 'Unknown account. Use a configured name/ID or household.';
      const s = account === 'household' ? fundingSummary(rows, 'household', month, 'Budget', this.config) : { used: rows.filter(r => r.actor === account && r.month === month && ['expense', 'lend', 'repay'].includes(r.kind)).reduce((n, r) => n + r.amount, 0) };
      return `${account} · ${month}\nBudget used: ${this.fmt(s.used)}\n${this.details(rows.filter(r => r.month === month && !['budget', 'category'].includes(r.kind) && (account === 'household' ? fundingOf(r, rows, this.config).account === 'household' : r.actor === account)))}`;
    }
    if (['loans', 'household loans'].includes(lower)) {
      const account = lower.startsWith('household') ? 'household' : actor.id;
      const balances = loans(rows, account);
      return `${account} · outstanding loans (all months)\n` + (balances.map(l => `${l.person}: ${l.side === 'lent' ? 'owed to you' : 'you owe'} ${this.fmt(l.amount)}`).join('\n') || 'No outstanding loans.');
    }
    const set = text.match(/^set\s+(household\s+)?(?:(.+?)\s+)?budget\s+(\S+)$/i);
    if (set) {
      try {
        if (set[1] && set[2]) return 'Household is one shared funding budget. Use set household budget <amount>.';
        const budgetName = set[2] ? this.resolveBudget(set[2], rows, set[1] ? 'household' : actor.id) || set[2].trim() : 'Budget';
        if (!this.validName(budgetName)) return 'Use a budget name of 1–60 characters, without reserved command words.';
        await this.store.append({ id: messageId, timestamp: this.now().toISOString(), ...dateParts(this.now(), this.config.timezone), account: set[1] || budgetName === 'household' ? 'household' : actor.id, actor: actor.id, kind: 'budget', amount: amount(set[3]), description: 'Monthly budget', category: budgetName === 'household' ? 'Budget' : budgetName });
        return `Monthly budget updated to ${this.fmt(amount(set[3]))}. Existing spending is retained.`;
      } catch (e) { if (e.message.startsWith('Use a positive') || e.message === 'Amount is out of range.') return e.message; throw e; }
    }
    const entry = text.match(/^(household\s+)?(expense|lend|borrow|collect|repay)\s+(\S+)(?:\s+(.+))?$/i);
    if (!entry) return null;
    let value;
    try { value = amount(entry[3]); } catch (e) { return e.message; }
    const kind = entry[2].toLowerCase();
    pending = { options: categoryDefinitions(rows, entry[1] ? 'household' : actor.id, this.config).map(d => d.name), id: messageId, account: entry[1] ? 'household' : actor.id, kind, amount: value, description: '', category: kind === 'expense' ? '' : `Loan: ${kind}`, stage: 'description', updated: this.now().getTime(), lastMessageId: messageId };
    if (entry[4]) {
      pending.description = kind === 'expense' ? entry[4].trim() : entry[4].replace(/^(to|from)\s+/i, '').trim();
      if (!pending.description) return 'Include the other person’s name.';
      if (kind === 'expense') {
        const direct = pending.options.find(c => c.toLowerCase() === entry[4].trim().toLowerCase());
        if (parsedCommand.category || direct) {
          if (parsedCommand.category && !pending.options.includes(parsedCommand.category)) return 'That category is not funded by household. Use expense without the household prefix.';
          pending.description = parsedCommand.description;
          pending.category = parsedCommand.category || direct;
          pending.stage = 'confirm';
        } else pending.stage = 'category';
      } else pending.stage = 'confirm';
    }
    // Loans require a counterparty, not an expense category.
    if (kind !== 'expense' && pending.stage === 'description') return `Use ${kind} <amount> ${['lend', 'repay'].includes(kind) ? 'to' : 'from'} <person>.`;
    if (pending.kind === 'expense' && pending.category) pending.funding = categoryDefinitions(rows, pending.account, this.config).find(d => d.name === pending.category)?.source || 'Budget';
    this.sessions[actor.id] = pending; await this.saveSessions(); return this.prompt(pending);
  }
  reportBudget(rows, actorId, month, requested, detail = false) {
    const user = this.config.users.find(u => [u.id.toLowerCase(), u.name.toLowerCase()].includes(requested.trim().toLowerCase()));
    const name = user ? 'Budget' : this.resolveBudget(requested, rows, actorId);
    if (!name) return 'Unknown budget. Use set <name> budget <amount> to create it.';
    const account = name === 'household' ? 'household' : user?.id || actorId;
    return this.budgetSection(rows, account, month, name === 'household' ? 'Budget' : name, detail);
  }
  budgetSection(rows, account, month, name, detail) {
    const s = fundingSummary(rows, account, month, name, this.config);
    const owner = this.config.users.find(u => u.id === account)?.name || account;
    const title = account === 'household' ? 'household' : `${owner} · ${name === 'Budget' ? 'individual' : name}`;
    let out = `${title} · ${month}\nBudget: ${s.limit === null ? 'not set' : this.fmt(s.limit)}\nUsed: ${this.fmt(s.used)}\nRemaining: ${s.remaining === null ? 'set a budget first' : this.fmt(s.remaining)}`;
    if (detail) {
      const grouped = new Map();
      for (const row of s.spending) {
        if (!grouped.has(row.category)) grouped.set(row.category, []);
        grouped.get(row.category).push(row);
      }
      for (const [category, entries] of grouped) {
        out += `\n\nCategory: ${category}\nTotal: ${this.fmt(entries.reduce((n, r) => n + r.amount, 0))}\n`;
        out += entries.map(r => `${r.date} · ${r.kind} · ${this.fmt(r.amount)} · ${r.description} · by ${this.config.users.find(u => u.id === r.actor)?.name || r.actor}`).join('\n');
      }
      if (!grouped.size) out += '\nNo spending this month.';
    }
    return out;
  }
  allBudgets(rows, actorId, month, detail) {
    const sections = [];
    const users = [...this.config.users].sort((a, b) => Number(b.id === actorId) - Number(a.id === actorId));
    for (const user of users) {
      for (const name of ['Budget', ...this.budgetNames(rows, user.id).filter(n => n !== 'household')]) sections.push(this.budgetSection(rows, user.id, month, name, detail));
    }
    sections.push(this.budgetSection(rows, 'household', month, 'Budget', detail));
    return sections.join('\n\n────────\n\n');
  }
  validName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60 && !/[\r\n]/.test(name) && !['yes', 'no', 'cancel', 'help', 'detail', 'all', 'budget detail'].includes(name.trim().toLowerCase());
  }
  budgetNames(rows, account) {
    return [...new Set([...Object.values(this.config.categoryBudgets), ...rows.filter(r => r.account === account && r.kind === 'budget').map(r => canonicalBudget(r.category, this.config)), ...categoryDefinitions(rows, account, this.config).map(d => d.source)].filter(s => s !== 'Budget'))];
  }
  resolveBudget(name, rows, account) {
    name = name.trim().toLowerCase();
    if (name === 'household') return 'household';
    if (['main', 'overall', 'personal', 'individual', 'budget'].includes(name)) return 'Budget';
    const canonical = canonicalBudget(name, this.config);
    return this.budgetNames(rows, account).find(n => n.toLowerCase() === canonical.toLowerCase()) || null;
  }
  async startCategory(actor, text, account, id, rows) {
    let body = text.replace(/^add\s+/i, '').trim();
    let source = null;
    if (/^category\s+/i.test(body)) body = body.replace(/^category\s+/i, '').trim();
    else {
      const explicit = body.match(/^(.+?)\s+from\s+(.+)$/i);
      if (explicit) { body = explicit[1].trim(); source = explicit[2].trim(); }
      else {
        const suffix = body.match(/^(.+)\s+(\S+)$/);
        if (suffix && (suffix[2].toLowerCase() === 'loan' || this.resolveBudget(suffix[2], rows, account) || !suffix[1].includes(' '))) {
          body = suffix[1].trim(); source = suffix[2].trim();
        }
      }
    }
    if (!this.validName(body) || ['budget', 'main', 'overall', 'personal', 'individual', 'household', 'all'].includes(body.toLowerCase())) return 'Use a category name of 1–60 characters. For multiword names use add category <name>.';
    if (categoryDefinitions(rows, account, this.config).some(d => d.name.toLowerCase() === body.toLowerCase())) return 'That category already exists in this account.';
    if (source && !this.validName(source)) return 'Use a valid budget name of 1–60 characters.';
    const pending = { id, kind: 'category', account, category: body, source, stage: source ? 'confirm' : 'category-mode', updated: this.now().getTime(), lastMessageId: id };
    if (source) this.chooseSource(pending, source, rows);
    this.sessions[actor.id] = pending;
    await this.saveSessions();
    return this.categoryPrompt(pending);
  }
  chooseSource(pending, source, rows) {
    pending.source = this.resolveBudget(source, rows, pending.account) || source.trim();
    const month = dateParts(this.now(), this.config.timezone).month;
    const hasBudget = pending.source === 'Budget' || fundingSummary(rows, pending.source === 'household' ? 'household' : pending.account, month, pending.source === 'household' ? 'Budget' : pending.source, this.config).limit !== null;
    pending.stage = hasBudget ? 'confirm' : 'category-budget-amount';
  }
  async handleCategory(actor, text, id, pending, rows) {
    const lower = text.toLowerCase();
    if (pending.stage === 'confirm') {
      if (lower !== 'yes') return 'Reply yes to save, or cancel to discard.';
      if (categoryDefinitions(rows, pending.account, this.config).some(d => d.name.toLowerCase() === pending.category.toLowerCase()) && !rows.some(r => r.id === pending.id)) return 'That category was already added. Cancel this entry.';
      const date = this.now();
      const base = { timestamp: date.toISOString(), ...dateParts(date, this.config.timezone), account: pending.account, actor: actor.id };
      await this.store.append({ ...base, id: pending.id, kind: 'category', amount: 0, category: pending.category.trim(), description: JSON.stringify({ source: pending.source.trim() }) });
      if (pending.budgetAmount) await this.store.append({ ...base, id: `${pending.id}:budget`, account: pending.source === 'household' ? 'household' : pending.account, kind: 'budget', amount: pending.budgetAmount, category: pending.source === 'household' ? 'Budget' : pending.source.trim(), description: 'Monthly budget' });
      delete this.sessions[actor.id]; await this.saveSessions();
      return `Added ${pending.category} to ${pending.account}. Uses ${pending.source === 'Budget' ? 'overall' : pending.source} budget.`;
    }
    if (pending.stage === 'category-mode') {
      if (['separate', 'new', '1'].includes(lower)) this.chooseSource(pending, pending.category, rows);
      else if (['shared', 'existing', '2'].includes(lower)) pending.stage = 'category-source';
      else return this.categoryPrompt(pending);
    } else if (pending.stage === 'category-source') {
      if (!this.validName(text)) return 'Use a budget name of 1–60 characters.';
      this.chooseSource(pending, text, rows);
    } else if (pending.stage === 'category-budget-amount') {
      try { pending.budgetAmount = amount(text); } catch (e) { return e.message; }
      pending.stage = 'confirm';
    }
    pending.updated = this.now().getTime(); pending.lastMessageId = id;
    await this.saveSessions(); return this.categoryPrompt(pending);
  }
  categoryPrompt(p) {
    if (p.stage === 'category-mode') return `How should ${p.category} be tracked?\n1. Separate budget (reply separate)\n2. Use another budget (reply shared)\nOr cancel.`;
    if (p.stage === 'category-source') return 'Which budget should pay for this category? Reply individual, household, shopping, investments, loan, or another budget name. A new name starts budget setup.';
    if (p.stage === 'category-budget-amount') return `Set the monthly budget amount for ${p.source}. Existing spending will be retained.`;
    return `Add category: ${p.category}\nAccount: ${p.account}\nFunding budget: ${p.source === 'Budget' ? 'individual' : p.source}${p.budgetAmount ? `\nMonthly limit: ${this.fmt(p.budgetAmount)}` : ''}\nReply yes to save, or cancel.`;
  }
  prompt(p) {
    if (p.kind === 'category') return this.categoryPrompt(p);
    if (p.stage === 'description') return 'Where was it spent, or what was it for?';
    if (p.stage === 'category') return `Choose a category:\n${this.menu(p.options)}`;
    const funding = p.account === 'household' ? 'household' : p.kind === 'expense' ? p.funding === 'Budget' ? 'individual' : p.funding || 'individual' : 'individual';
    return `${p.kind} · ${this.fmt(p.amount)}\nFunding: ${funding}\nAccount: ${p.account}\nFor: ${p.description}\nCategory: ${p.category}\nReply yes to save, or cancel.`;
  }
  details(rows) {
    return rows.map(r => `${r.date} · ${r.kind} · ${this.fmt(r.amount)} · ${r.description} · ${r.category}${r.account === 'household' ? ` · by ${r.actor}` : ''}`).join('\n') || 'No entries this month.';
  }
}
