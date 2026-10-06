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
  const budgets = entries.filter(r => r.kind === 'budget' && r.category === 'Budget');
  const limit = budgets.at(-1)?.amount ?? null;
  const spending = entries.filter(r => ['expense', 'lend', 'repay'].includes(r.kind));
  const used = spending.reduce((n, r) => n + r.amount, 0);
  return { limit, used, remaining: limit === null ? null : limit - used, spending };
}
export function loans(rows, account) {
  const balances = new Map();
  for (const r of rows.filter(r => r.account === account && ['lend', 'borrow', 'collect', 'repay'].includes(r.kind))) {
    const side = ['lend', 'collect'].includes(r.kind) ? 'lent' : 'borrowed';
    const person = r.description.trim();
    const key = `${side}:${person.toLowerCase()}`;
    const old = balances.get(key) || { side, person, amount: 0 };
    old.amount += ['lend', 'borrow'].includes(r.kind) ? r.amount : -r.amount;
    balances.set(key, old);
  }
  return [...balances.values()].filter(r => r.amount !== 0);
}

export function categorySummary(rows, account, month, category, definitions = []) {
  const entries = rows.filter(r => r.account === account && r.month === month);

  const limit = entries.filter(r => r.kind === 'budget' && r.category.toLowerCase() === category.toLowerCase()).at(-1)?.amount ?? null;
  const spending = entries.filter(r => {
    if (!['expense', 'lend', 'repay'].includes(r.kind)) return false;
    const definition = definitions.find(d => d.name.toLowerCase() === r.category.toLowerCase());
    return (definition?.source || r.category).toLowerCase() === category.toLowerCase();
  });
  const used = spending.reduce((n, r) => n + r.amount, 0);
  return { limit, used, remaining: limit === null ? null : limit - used, spending };
}

export function categoryDefinitions(rows, account, config) {
  const definitions = config.categories.map(name => ({ name: name.trim(), source: config.categoryFunding?.[name.trim()] || (Object.values(config.categoryBudgets).includes(name.trim()) ? name.trim() : 'Budget') }));
  for (const row of rows.filter(r => r.kind === 'category')) {
    const definition = JSON.parse(row.description);
    if (row.account !== account && definition.source?.trim().toLowerCase() !== 'household') continue;
    if (typeof definition.source !== 'string' || !definition.source.trim()) throw new Error('Invalid category definition');
    if (config.categoryFunding && definitions.some(d => d.name.toLowerCase() === row.category.toLowerCase())) continue;
    definitions.push({ name: row.category.trim(), source: canonicalBudget(definition.source, config) });
  }
  return config.categoryFunding && account === 'household' ? definitions.filter(d => d.source.toLowerCase() === 'household') : definitions;
}

export function canonicalBudget(name, config) {
  const lower = name.trim().toLowerCase();
  if (['main', 'overall', 'personal', 'individual', 'budget'].includes(lower)) return 'Budget';
  if (lower === 'household') return 'household';
  if (config.categoryFunding) {
    const category = Object.keys(config.categoryFunding).find(c => c.toLowerCase() === lower && config.categoryFunding[c] === 'Shopping & Dine-out');
    if (category) return 'Shopping & Dine-out';
  }
  return Object.hasOwn(config.categoryBudgets, lower) ? config.categoryBudgets[lower] : name.trim();
}

// A transaction belongs to one funding budget; its actor still identifies who paid.
export function fundingOf(row, rows, config) {
  const builtIn = row.kind === 'expense' && config.categoryFunding && Object.entries(config.categoryFunding).find(([category]) => category.toLowerCase() === row.category.toLowerCase());
  if (builtIn) {
    const source = canonicalBudget(builtIn[1], config);
    return source === 'household' ? { account: 'household', name: 'Budget' } : { account: row.actor || row.account, name: source };
  }
  if (row.account === 'household') return { account: 'household', name: 'Budget' };
  const definition = row.kind === 'expense' ? categoryDefinitions(rows, row.account, config).find(d => d.name.toLowerCase() === row.category.toLowerCase()) : null;
  const source = canonicalBudget(definition?.source || 'Budget', config);
  return source.toLowerCase() === 'household' ? { account: 'household', name: 'Budget' } : { account: row.account, name: source };
}
export function fundingSummary(rows, account, month, name, config) {
  name = canonicalBudget(name, config);
  const defaultLimit = ['Budget', ...Object.values(config.categoryBudgets)].includes(name) ? config.defaultMonthlyBudget ?? null : null;
  const limit = rows.filter(r => r.account === account && r.month === month && r.kind === 'budget' && canonicalBudget(r.category, config).toLowerCase() === name.toLowerCase()).at(-1)?.amount ?? defaultLimit;
  const spending = rows.filter(r => {
    if (r.month !== month || !['expense', 'lend', 'repay'].includes(r.kind)) return false;
    const funding = fundingOf(r, rows, config);
    return funding.account === account && funding.name.toLowerCase() === name.toLowerCase();
  });
  const used = spending.reduce((n, r) => n + r.amount, 0);
  return { limit, used, remaining: limit === null ? null : limit - used, spending };
}
