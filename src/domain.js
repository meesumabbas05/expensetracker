export function amount(text) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Use a positive amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1e12) throw new Error('Amount is out of range.');
  return value;
}
export function dateParts(date, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}` };
}
export const money = (minor, currency) => `${currency} ${(minor / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function summary(rows, account, month) {
  const entries = rows.filter(r => r.account === account && r.month === month);
  const budgets = entries.filter(r => r.kind === 'budget');
  const limit = budgets.at(-1)?.amount ?? null;
  const spending = entries.filter(r => ['expense', 'lend', 'repay'].includes(r.kind));
  const used = spending.reduce((n, r) => n + r.amount, 0);
  return { limit, used, remaining: limit === null ? null : limit - used, spending };
}
export function loans(rows, account) {
  const balances = new Map();
  for (const r of rows.filter(r => r.account === account && ['lend', 'borrow', 'collect', 'repay'].includes(r.kind))) {
    const side = ['lend', 'collect'].includes(r.kind) ? 'lent' : 'borrowed';
    const key = `${side}:${r.description.toLowerCase()}`;
    const old = balances.get(key) || { side, person: r.description, amount: 0 };
    old.amount += ['lend', 'borrow'].includes(r.kind) ? r.amount : -r.amount;
    balances.set(key, old);
  }
  return [...balances.values()].filter(r => r.amount !== 0);
}
