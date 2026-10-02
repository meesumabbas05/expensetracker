import { amount, dateParts, money, summary, loans, categorySummary, categoryDefinitions } from './domain.js';
import { extract } from './extract.js';
export class Bot {
  constructor(config, store, sessions, saveSessions, now = () => new Date()) {
    Object.assign(this, { config, store, sessions, saveSessions, now });
  }
  fmt(n) { return money(n, this.config.currency); }
  menu(categories = this.config.categories) { return categories.map((c, i) => `${i + 1}. ${c}`).join('\n'); }
  help() {
    return `Commands (amounts have up to 2 decimals):\nexpense 400\nexpense 4000 dinner at a restaurant\nhousehold expense 400 groceries\nset budget 50000\nset household budget 80000\nget budget / get budget detail\nset shopping budget 10000 / set dine-out budget 5000\nget shopping budget / get dine-out budget detail\n(Also: set/get household shopping/dine-out budget)\nget household budget / get household budget detail\ntotal <configured name or ID> / total household\nlend 1000 to Alex / borrow 1000 from Alex\ncollect 500 from Alex / repay 500 to Alex\nhousehold lend 1000 to Alex (also borrow, collect, repay)\nloans / household loans\nadd <category> / add <category> loan / add <category> <budget>\nadd category <multiword category name>\ncategories / household categories\nset <budget name> budget <amount> / get <budget name> budget detail\nPrefix add with household for shared categories.\ncancel / help\nConfirm entries with yes; no or cancel discards them. Calendar months start on the 1st. Loan balances span all months.`;
  }
  async handle(actor, text, messageId) {
    text = text.trim();
    if (!text || text.length > 1000) return 'Send a command under 1,000 characters. Try help.';
    const lower = text.toLowerCase();
    if (lower === 'help') return this.help();
    if (lower === 'cancel' || lower === 'no') { delete this.sessions[actor.id]; await this.saveSessions(); return 'Entry cancelled.'; }
    const rows = await this.store.rows();
    let pending = this.sessions[actor.id];
    if (pending && this.now().getTime() - pending.updated > this.config.ttl) { delete this.sessions[actor.id]; await this.saveSessions(); pending = null; }
    if (pending) {
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
      pending.updated = this.now().getTime(); pending.lastMessageId = messageId; await this.saveSessions();
      return this.prompt(pending);
    }
    if (rows.some(r => r.id === messageId)) return 'This entry has already been saved.';
    const month = dateParts(this.now(), this.config.timezone).month;
    const scope = lower.startsWith('household ') ? 'household' : actor.id;
    const scopedText = text.replace(/^household\s+/i, '').trim();
    if (/^add\s+/i.test(scopedText)) return this.startCategory(actor, scopedText, scope, messageId, rows);
    if (scopedText.toLowerCase() === 'categories') return categoryDefinitions(rows, scope, this.config).map((d, i) => `${i + 1}. ${d.name} → ${d.source === 'Budget' ? 'overall budget' : d.source}`).join('\n');
    const budgetMatch = lower.match(/^get\s+(household\s+)?(?:(.+?)\s+)?budget(\s+detail)?$/);
    if (budgetMatch) {
      const account = budgetMatch[1] ? 'household' : actor.id;
      const definitions = categoryDefinitions(rows, account, this.config);
      const resolved = budgetMatch[2] ? this.resolveBudget(budgetMatch[2], rows, account) : null;
      const category = resolved === 'Budget' ? null : resolved;
      if (budgetMatch[2] && !resolved) return 'Unknown budget. Create it with set <name> budget <amount>, or add a category and choose its funding budget.';
      const s = category ? categorySummary(rows, account, month, category, definitions) : summary(rows, account, month);
      let out = `${account}${category ? ` · ${category}` : ''} · ${month}\nBudget: ${s.limit === null ? 'not set' : this.fmt(s.limit)}\nUsed: ${this.fmt(s.used)}\nRemaining: ${s.remaining === null ? 'set a budget first' : this.fmt(s.remaining)}`;
      if (!category) {
        for (const label of this.budgetNames(rows, account)) {
          const key = label;
          const c = categorySummary(rows, account, month, label, definitions);
          out += `\n${key}: limit ${c.limit === null ? 'not set' : this.fmt(c.limit)}, used ${this.fmt(c.used)}, remaining ${c.remaining === null ? 'not set' : this.fmt(c.remaining)}`;
        }
      }
      if (budgetMatch[3]) {
        const categories = new Map();
        for (const r of s.spending) categories.set(r.category, (categories.get(r.category) || 0) + r.amount);
        out += '\n\nBy category:\n' + ([...categories].map(([c, v]) => `${c}: ${this.fmt(v)}`).join('\n') || 'No spending.');
        out += '\n\n' + this.details(s.spending);
      }
      return out;
    }
    if (lower.startsWith('total ')) {
      const name = lower.slice(6).trim();
      const account = name === 'household' ? 'household' : this.config.users.find(u => [u.id.toLowerCase(), u.name.toLowerCase()].includes(name))?.id;
      if (!account) return 'Unknown account. Use a configured name/ID or household.';
      const s = summary(rows, account, month);
      return `${account} · ${month}\nBudget used: ${this.fmt(s.used)}\n${this.details(rows.filter(r => r.account === account && r.month === month && !['budget', 'category'].includes(r.kind)))}`;
    }
    if (['loans', 'household loans'].includes(lower)) {
      const account = lower.startsWith('household') ? 'household' : actor.id;
      const balances = loans(rows, account);
      return `${account} · outstanding loans (all months)\n` + (balances.map(l => `${l.person}: ${l.side === 'lent' ? 'owed to you' : 'you owe'} ${this.fmt(l.amount)}`).join('\n') || 'No outstanding loans.');
    }
    const set = text.match(/^set\s+(household\s+)?(?:(.+?)\s+)?budget\s+(\S+)$/i);
    if (set) {
      try {
        const budgetName = set[2] ? this.resolveBudget(set[2], rows, set[1] ? 'household' : actor.id) || set[2].trim() : 'Budget';
        if (!this.validName(budgetName)) return 'Use a budget name of 1–60 characters, without reserved command words.';
        await this.store.append({ id: messageId, timestamp: this.now().toISOString(), ...dateParts(this.now(), this.config.timezone), account: set[1] ? 'household' : actor.id, actor: actor.id, kind: 'budget', amount: amount(set[3]), description: 'Monthly budget', category: budgetName });
        return `Monthly budget updated to ${this.fmt(amount(set[3]))}. Existing spending is retained.`;
      } catch (e) { if (e.message.startsWith('Use a positive') || e.message === 'Amount is out of range.') return e.message; throw e; }
    }
    const entry = text.match(/^(household\s+)?(expense|lend|borrow|collect|repay)\s+(\S+)(?:\s+(.+))?$/i);
    if (!entry) return 'Unknown command. Send help for examples.';
    let value;
    try { value = amount(entry[3]); } catch (e) { return e.message; }
    const kind = entry[2].toLowerCase();
    pending = { options: categoryDefinitions(rows, entry[1] ? 'household' : actor.id, this.config).map(d => d.name), id: messageId, account: entry[1] ? 'household' : actor.id, kind, amount: value, description: '', category: kind === 'expense' ? '' : `Loan: ${kind}`, stage: 'description', updated: this.now().getTime(), lastMessageId: messageId };
    if (entry[4]) {
      if (entry[4].length > 200) return 'Use a description under 200 characters.';
      pending.description = kind === 'expense' ? entry[4].trim() : entry[4].replace(/^(to|from)\s+/i, '').trim();
      if (!pending.description) return 'Include the other person’s name.';
      if (kind === 'expense') {
        const direct = pending.options.find(c => c.toLowerCase() === entry[4].trim().toLowerCase());
        const parsed = direct ? { description: entry[4].trim(), category: direct } : await extract(entry[4].trim(), { ...this.config, categories: pending.options });
        if (parsed) { pending.description = parsed.description.trim(); pending.category = parsed.category; pending.stage = 'confirm'; }
        else pending.stage = 'category';
      } else pending.stage = 'confirm';
    }
    // Loans require a counterparty, not an expense category.
    if (kind !== 'expense' && pending.stage === 'description') return `Use ${kind} <amount> ${['lend', 'repay'].includes(kind) ? 'to' : 'from'} <person>.`;
    this.sessions[actor.id] = pending; await this.saveSessions(); return this.prompt(pending);
  }
  validName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60 && !/[\r\n]/.test(name) && !['yes', 'no', 'cancel', 'help', 'household', 'detail', 'budget detail'].includes(name.trim().toLowerCase());
  }
  budgetNames(rows, account) {
    return [...new Set([...Object.values(this.config.categoryBudgets), ...rows.filter(r => r.account === account && r.kind === 'budget' && r.category !== 'Budget').map(r => r.category.trim()), ...categoryDefinitions(rows, account, this.config).map(d => d.source).filter(s => s !== 'Budget')])];
  }
  resolveBudget(name, rows, account) {
    name = name.trim().toLowerCase();
    if (['main', 'overall', 'personal', 'budget'].includes(name)) return 'Budget';
    return this.config.categoryBudgets[name] || this.budgetNames(rows, account).find(n => n.toLowerCase() === name) || null;
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
    if (!this.validName(body) || ['budget', 'main', 'overall', 'personal'].includes(body.toLowerCase())) return 'Use a category name of 1–60 characters. For multiword names use add category <name>.';
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
    const hasBudget = pending.source === 'Budget' || rows.some(r => r.account === pending.account && r.kind === 'budget' && r.month === month && r.category.toLowerCase() === pending.source.toLowerCase());
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
      if (pending.budgetAmount) await this.store.append({ ...base, id: `${pending.id}:budget`, kind: 'budget', amount: pending.budgetAmount, category: pending.source.trim(), description: 'Monthly budget' });
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
    if (p.stage === 'category-source') return 'Which budget should pay for this category? Reply overall, shopping, dine-out, loan, or another budget name. A new name starts budget setup.';
    if (p.stage === 'category-budget-amount') return `Set the monthly budget amount for ${p.source}. Existing spending will be retained.`;
    return `Add category: ${p.category}\nAccount: ${p.account}\nFunding budget: ${p.source === 'Budget' ? 'overall' : p.source}${p.budgetAmount ? `\nMonthly limit: ${this.fmt(p.budgetAmount)}` : ''}\nReply yes to save, or cancel.`;
  }
  prompt(p) {
    if (p.kind === 'category') return this.categoryPrompt(p);
    if (p.stage === 'description') return 'Where was it spent, or what was it for?';
    if (p.stage === 'category') return `Choose a category:\n${this.menu(p.options)}`;
    return `${p.kind} · ${this.fmt(p.amount)}\nAccount: ${p.account}\nFor: ${p.description}\nCategory: ${p.category}\nReply yes to save, or cancel.`;
  }
  details(rows) {
    return rows.map(r => `${r.date} · ${r.kind} · ${this.fmt(r.amount)} · ${r.description} · ${r.category}${r.account === 'household' ? ` · by ${r.actor}` : ''}`).join('\n') || 'No entries this month.';
  }
}
