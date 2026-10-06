import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { readConfig } from '../src/config.js';
import { categoryDefinitions, fundingSummary } from '../src/domain.js';

const users = [
  { id: 'one', name: 'Person One', whatsappIds: ['1234567890@c.us'] },
  { id: 'two', name: 'Person Two', whatsappIds: ['2345678901@c.us'] }
];
const env = { USERS_JSON: JSON.stringify(users), GOOGLE_SHEET_ID: 'test-sheet', GOOGLE_SERVICE_ACCOUNT_JSON: '{}', GEMINI_ENABLED: 'false' };
function setup(existingRows = []) {
  const config = readConfig(env), rows = [...existingRows], sessions = {};
  const store = { rows: async () => rows, append: async row => { if (!rows.some(r => r.id === row.id)) rows.push(row); } };
  const bot = new Bot(config, store, sessions, async () => {}, () => new Date('2026-10-06T12:00:00Z'));
  let sequence = 0;
  const send = (text, actor = users[0]) => bot.handle(actor, text, `policy-${++sequence}`);
  const spend = async (category, value, actor = users[0]) => {
    await send(`expense ${value} purchase-${actor.id}-${category} | ${category}`, actor);
    await send('yes', actor);
  };
  return { config, rows, bot, send, spend };
}

test('default category policy has three household categories, combined shopping/dine-out, individual and investments', async () => {
  const { config, send, rows } = setup();
  const definitions = categoryDefinitions(rows, 'one', config);
  assert.deepEqual(definitions.filter(d => d.source === 'household').map(d => d.name), ['House expenses', 'Groceries', 'Fuel']);
  assert.deepEqual(definitions.filter(d => d.source === 'Shopping & Dine-out').map(d => d.name), ['Dine-out', 'Shopping']);
  assert.deepEqual(definitions.filter(d => d.source === 'Budget').map(d => d.name), ['Sports', 'Utilities', 'Health', 'Travel', 'Other']);
  assert.deepEqual(definitions.filter(d => d.source === 'Investments').map(d => d.name), ['Short-term', 'Long-term']);
  const menu = await send('categories');
  assert.match(menu, /Groceries → household budget/);
  assert.match(menu, /Shopping → Shopping & Dine-out/);
  assert.match(menu, /Sports → individual budget/);
  assert.match(menu, /Short-term → Investments/);
  assert.doesNotMatch(menu, /overall/);
  const report = await send('budget all');
  assert.equal((report.match(/Budget: PKR 25,000.00/g) || []).length, 7);
  assert.equal((report.match(/Person One · Shopping & Dine-out/g) || []).length, 1);
  assert.equal(rows.length, 0, 'defaults do not write synthetic ledger rows');
});

test('household spending is shared while each persons three budgets remain independent', async () => {
  const { send, spend, rows, config } = setup();
  await spend('Groceries', 100);
  await spend('Fuel', 200, users[1]);
  await spend('Shopping', 300);
  await spend('Dine-out', 400);
  await spend('Dine-out', 500, users[1]);
  await spend('Sports', 600);
  await spend('Health', 700, users[1]);
  await spend('Short-term', 800);
  await spend('Long-term', 900);
  const used = (account, name) => fundingSummary(rows, account, '2026-10', name, config).used;
  assert.equal(used('household', 'Budget'), 30000);
  assert.equal(used('one', 'Shopping & Dine-out'), 70000);
  assert.equal(used('two', 'Shopping & Dine-out'), 50000);
  assert.equal(used('one', 'Budget'), 60000);
  assert.equal(used('two', 'Budget'), 70000);
  assert.equal(used('one', 'Investments'), 170000);
  assert.equal(used('two', 'Investments'), 0);
  const all = await send('budget all detail');
  for (const row of rows.filter(r => r.kind === 'expense')) assert.equal(all.split(` · ${row.description} · `).length - 1, 1);
  assert.match(await send('budget household', users[1]), /Used: PKR 300.00/);
  assert.match(await send('total household'), /PKR 300.00/);
});

test('shopping and dine-out updates address one limit, preserve spending and isolate other users and months', async () => {
  const { send, spend, bot } = setup();
  await spend('Shopping', 100);
  await spend('Dine-out', 200);
  await send('set shopping budget 1000');
  assert.match(await send('budget dine-out'), /Budget: PKR 1,000.00\nUsed: PKR 300.00/);
  await send('set dine-out budget 2000');
  assert.match(await send('budget shopping'), /Remaining: PKR 1,700.00/);
  assert.match(await send('budget shopping', users[1]), /Budget: PKR 25,000.00\nUsed: PKR 0.00/);
  await send('set individual budget 3000');
  await send('set investments budget 4000');
  await send('set household budget 5000');
  assert.match(await send('budget'), /Person One · individual.*\nBudget: PKR 3,000.00/);
  assert.match(await send('budget investments'), /Budget: PKR 4,000.00/);
  assert.match(await send('budget investments', users[1]), /Budget: PKR 25,000.00/);
  assert.match(await send('budget household', users[1]), /Budget: PKR 5,000.00/);
  bot.now = () => new Date('2026-11-02T12:00:00Z');
  assert.match(await send('budget shopping'), /Budget: PKR 25,000.00\nUsed: PKR 0.00/);
  assert.match(await send('budget investments'), /Budget: PKR 25,000.00\nUsed: PKR 0.00/);
});

test('existing ledger data is regrouped without rewriting it and latest old combined-budget limit wins', async () => {
  const base = { date: '2026-10-02', month: '2026-10', timestamp: '2026-10-02T12:00:00Z', actor: 'one', account: 'one' };
  const old = [
    { ...base, id: 'old-groceries', kind: 'expense', amount: 10000, description: 'old groceries', category: 'Groceries' },
    { ...base, id: 'old-dinner', kind: 'expense', amount: 20000, description: 'old dinner', category: 'Dine-out' },
    { ...base, id: 'old-shoes', kind: 'expense', amount: 30000, description: 'old shoes', category: 'Shopping' },
    { ...base, id: 'old-shop-limit', kind: 'budget', amount: 100000, description: 'Monthly budget', category: 'Shopping' },
    { ...base, id: 'old-dinner-limit', kind: 'budget', amount: 200000, description: 'Monthly budget', category: 'Dine-out' },
    { ...base, id: 'old-category', kind: 'category', amount: 0, description: '{"source":"Shopping"}', category: 'Gifts' },
    { ...base, id: 'old-gift', kind: 'expense', amount: 40000, description: 'old gift', category: 'Gifts' },
    { ...base, id: 'old-household-dinner', account: 'household', kind: 'expense', amount: 50000, description: 'old household dinner', category: 'Dine-out' }
  ];
  const snapshot = JSON.stringify(old);
  const { config, rows, send } = setup(old);
  assert.equal(fundingSummary(rows, 'household', '2026-10', 'Budget', config).used, 10000);
  const combined = fundingSummary(rows, 'one', '2026-10', 'Shopping & Dine-out', config);
  assert.equal(combined.used, 140000);
  assert.equal(combined.limit, 200000);
  assert.match(await send('categories'), /Gifts → Shopping & Dine-out/);
  const report = await send('budget all detail');
  assert.equal((report.match(/Person One · Shopping & Dine-out/g) || []).length, 1);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('a pending expense restored after deployment shows the corrected budget before confirmation', async () => {
  const { bot, rows, send } = setup();
  bot.sessions.one = { id: 'pending-old', lastMessageId: 'old-delivery', kind: 'expense', account: 'one', amount: 10000, description: 'dinner', category: 'Dine-out', funding: 'Dine-out', stage: 'confirm', updated: bot.now().getTime() };
  assert.match(await bot.handle(users[0], 'expense 100 dinner', 'old-delivery'), /Funding: Shopping & Dine-out/);
  await send('yes');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'pending-old');
});

test('household command cannot charge a personal category and investments remain usable with an old ten-category env', async () => {
  const { send, rows, config } = setup();
  assert.match(await send('household expense 10 dinner | Dine-out'), /not funded by household/);
  assert.equal(rows.length, 0);
  assert.equal((await send('household categories')).split('\n').length, 3);
  assert.match(await send('add Pension from investments'), /Reply yes/);
  await send('yes');
  assert.match(await send('categories'), /Pension → Investments/);
  const oldCategories = config.categories.slice(0, 10);
  const restored = readConfig({ ...env, CATEGORIES_JSON: JSON.stringify(oldCategories) });
  assert.deepEqual(restored.categories.slice(-2), ['Short-term', 'Long-term']);
  for (const invalid of ['0', '-1', 'NaN']) assert.throws(() => readConfig({ ...env, DEFAULT_MONTHLY_BUDGET: invalid }));
  assert.equal(readConfig({ ...env, DEFAULT_MONTHLY_BUDGET: '30000' }).defaultMonthlyBudget, 3000000);
});
