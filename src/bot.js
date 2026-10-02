import { amount, dateParts, money, summary, loans } from './domain.js';
import { extract } from './extract.js';
export class Bot {
  constructor(config, store, sessions, saveSessions, now = () => new Date()) {
    Object.assign(this, { config, store, sessions, saveSessions, now });
  }
  fmt(n) { return money(n, this.config.currency); }
  menu() { return this.config.categories.map((c, i) => `${i + 1}. ${c}`).join('\n'); }
  help() {
    return `Commands (amounts have up to 2 decimals):\nexpense 400\nexpense 4000 dinner at a restaurant\nhousehold expense 400 groceries\nset budget 50000\nset household budget 80000\nget budget / get budget detail\nget household budget / get household budget detail\ntotal <configured name or ID> / total household\nlend 1000 to Alex / borrow 1000 from Alex\ncollect 500 from Alex / repay 500 to Alex\nhousehold lend 1000 to Alex (also borrow, collect, repay)\nloans / household loans\ncancel / help\nConfirm entries with yes; no or cancel discards them. Calendar months start on the 1st. Loan balances span all months.`;
  }
  async handle(actor, text, messageId) {
    text = text.trim();
    if (!text || text.length > 1000) return 'Send a command under 1,000 characters. Try help.';
    const lower = text.toLowerCase();
    if (lower === 'help') return this.help();
    if (lower === 'cancel' || lower === 'no') { delete this.sessions[actor.id]; await this.saveSessions(); return 'Entry cancelled.'; }
    let pending = this.sessions[actor.id];
    if (pending && this.now().getTime() - pending.updated > this.config.ttl) { delete this.sessions[actor.id]; await this.saveSessions(); pending = null; }
    if (pending) {
      if (pending.lastMessageId === messageId) return this.prompt(pending);
      if (pending.stage === 'confirm') {
        if (lower !== 'yes') return 'Reply yes to save, or cancel to discard.';
        const rows = await this.store.rows();
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
        if (!/^(?:[1-9]|10)$/.test(text)) return `Reply with a category number 1–10:\n${this.menu()}`;
        pending.category = this.config.categories[Number(text) - 1]; pending.stage = 'confirm';
      }
      pending.updated = this.now().getTime(); pending.lastMessageId = messageId; await this.saveSessions();
      return this.prompt(pending);
    }
    const rows = await this.store.rows();
    if (rows.some(r => r.id === messageId)) return 'This entry has already been saved.';
    const month = dateParts(this.now(), this.config.timezone).month;
    const budgetMatch = lower.match(/^get (household )?budget( detail)?$/);
    if (budgetMatch) {
      const account = budgetMatch[1] ? 'household' : actor.id;
      const s = summary(rows, account, month);
      let out = `${account} · ${month}\nBudget: ${s.limit === null ? 'not set' : this.fmt(s.limit)}\nUsed: ${this.fmt(s.used)}\nRemaining: ${s.remaining === null ? 'set a budget first' : this.fmt(s.remaining)}`;
      if (budgetMatch[2]) {
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
      return `${account} · ${month}\nBudget used: ${this.fmt(s.used)}\n${this.details(rows.filter(r => r.account === account && r.month === month && r.kind !== 'budget'))}`;
    }
    if (['loans', 'household loans'].includes(lower)) {
      const account = lower.startsWith('household') ? 'household' : actor.id;
      const balances = loans(rows, account);
      return `${account} · outstanding loans (all months)\n` + (balances.map(l => `${l.person}: ${l.side === 'lent' ? 'owed to you' : 'you owe'} ${this.fmt(l.amount)}`).join('\n') || 'No outstanding loans.');
    }
    const set = text.match(/^set (household )?budget (\S+)$/i);
    if (set) {
      try {
        await this.store.append({ id: messageId, timestamp: this.now().toISOString(), ...dateParts(this.now(), this.config.timezone), account: set[1] ? 'household' : actor.id, actor: actor.id, kind: 'budget', amount: amount(set[2]), description: 'Monthly budget', category: 'Budget' });
        return `Monthly budget updated to ${this.fmt(amount(set[2]))}. Existing spending is retained.`;
      } catch (e) { if (e.message.startsWith('Use a positive') || e.message === 'Amount is out of range.') return e.message; throw e; }
    }
    const entry = text.match(/^(household )?(expense|lend|borrow|collect|repay) (\S+)(?:\s+(.+))?$/i);
    if (!entry) return 'Unknown command. Send help for examples.';
    let value;
    try { value = amount(entry[3]); } catch (e) { return e.message; }
    const kind = entry[2].toLowerCase();
    pending = { id: messageId, account: entry[1] ? 'household' : actor.id, kind, amount: value, description: '', category: kind === 'expense' ? '' : `Loan: ${kind}`, stage: 'description', updated: this.now().getTime(), lastMessageId: messageId };
    if (entry[4]) {
      if (entry[4].length > 200) return 'Use a description under 200 characters.';
      pending.description = kind === 'expense' ? entry[4] : entry[4].replace(/^(to|from)\s+/i, '').trim();
      if (!pending.description) return 'Include the other person’s name.';
      if (kind === 'expense') {
        const parsed = await extract(entry[4], this.config);
        if (parsed) { pending.description = parsed.description.trim(); pending.category = parsed.category; pending.stage = 'confirm'; }
        else pending.stage = 'category';
      } else pending.stage = 'confirm';
    }
    // Loans require a counterparty, not an expense category.
    if (kind !== 'expense' && pending.stage === 'description') return `Use ${kind} <amount> ${['lend', 'repay'].includes(kind) ? 'to' : 'from'} <person>.`;
    this.sessions[actor.id] = pending; await this.saveSessions(); return this.prompt(pending);
  }
  prompt(p) {
    if (p.stage === 'description') return 'Where was it spent, or what was it for?';
    if (p.stage === 'category') return `Choose a category:\n${this.menu()}`;
    return `${p.kind} · ${this.fmt(p.amount)}\nAccount: ${p.account}\nFor: ${p.description}\nCategory: ${p.category}\nReply yes to save, or cancel.`;
  }
  details(rows) {
    return rows.map(r => `${r.date} · ${r.kind} · ${this.fmt(r.amount)} · ${r.description} · ${r.category}${r.account === 'household' ? ` · by ${r.actor}` : ''}`).join('\n') || 'No entries this month.';
  }
}
