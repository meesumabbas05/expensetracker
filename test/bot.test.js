import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { amount, summary, dateParts, loans } from '../src/domain.js';
const config = { categories: ['House','Groceries','Fuel','Dine-out','Sports','Utilities','Shopping','Health','Travel','Other'], users: [{ id: 'one', name: 'Person One' }, { id: 'two', name: 'Person Two' }], timezone: 'Asia/Karachi', currency: 'PKR', ttl: 900000, categoryBudgets: { shopping: 'Shopping', 'dine-out': 'Dine-out' }, geminiEnabled: false };
function setup() {
  const rows = []; const sessions = {};
  const store = { rows: async () => rows, append: async r => { if (!rows.some(x => x.id === r.id)) rows.push(r); } };
  const bot = new Bot(config, store, sessions, async () => {}, () => new Date('2026-10-02T12:00:00Z'));
  let n = 0;
  return { bot, rows, sessions, send: (text, user = config.users[0], id = `id-${++n}`) => bot.handle(user, text, id) };
}
test('integer cents and strict amount validation', () => {
  assert.equal(amount('0.29'), 29);
  for (const x of ['0','-2','1.234','NaN','1e3','1,000']) assert.throws(() => amount(x));
});
test('guided entry, accounts, shared totals, confirmation, duplicate delivery', async () => {
  const { send, rows } = setup();
  assert.match(await send('expense 400', undefined, 'origin'), /Where/);
  await send('Restaurant'); await send('4'); await send('yes');
  assert.equal(rows[0].amount, 40000); assert.equal(rows[0].category, 'Dine-out');
  await send('expense 400', undefined, 'origin'); assert.equal(rows.length, 1);
  await send('household expense 100 groceries', config.users[1]); await send('2', config.users[1]); await send('yes', config.users[1]);
  assert.equal(rows[1].account, 'household'); assert.equal(rows[1].actor, 'two');
  assert.match(await send('total Person One', config.users[1]), /Restaurant/);
  assert.match(await send('total household'), /groceries/);
});
test('budget updates retain spending and isolate users and months', async () => {
  const { send, rows } = setup();
  await send('set budget 1000');
  await send('expense 400 food'); await send('2'); await send('yes');
  await send('set budget 2000');
  assert.deepEqual({ ...summary(rows, 'one', '2026-10'), spending: [] }, { limit: 200000, used: 40000, remaining: 160000, spending: [] });
  assert.equal(summary(rows, 'two', '2026-10').used, 0);
  assert.equal(summary(rows, 'one', '2026-11').limit, null);
  assert.equal(summary(rows, 'one', '2026-11').used, 0);
});
test('loan balances and cash outflows; reject excess repayments', async () => {
  const { send, rows } = setup();
  for (const command of ['lend 100 to Alex','borrow 50 from Sam','collect 20 from Alex','repay 10 to Sam']) { await send(command); await send('yes'); }
  assert.equal(summary(rows, 'one', '2026-10').used, 11000);
  assert.deepEqual(loans(rows, 'one').map(l => l.amount), [8000,4000]);
  await send('repay 100 to Sam'); assert.match(await send('yes'), /Outstanding/); assert.equal(rows.length, 4);
});
test('cancel, invalid categories, session expiry and timezone month boundary', async () => {
  const { send, sessions, rows } = setup();
  await send('expense 20'); await send('food'); assert.match(await send('11'), /1–10/);
  await send('cancel'); assert.deepEqual(sessions, {}); assert.equal(rows.length, 0);
  await send('expense 30'); sessions.one.updated = 0;
  assert.match(await send('help expense'), /Commands/);
  assert.equal(await send('yes'), null);
  assert.deepEqual(dateParts(new Date('2026-09-30T20:00:00Z'), 'Asia/Karachi'), { date: '2026-10-01', month: '2026-10' });
});
test('uncertain append succeeds once and retains confirmation for retry', async () => {
  const { bot, send, rows } = setup();
  const original = bot.store.append;
  let fail = true;
  bot.store.append = async r => { await original(r); if (fail) { fail = false; throw new Error('timeout'); } };
  await send('expense 10 food'); await send('2');
  await assert.rejects(send('yes'));
  await send('yes'); assert.equal(rows.length, 1);
});

test('shopping and dine-out limits are independent subsets of main budget', async () => {
  const { send, rows } = setup();
  await send('set budget 1000'); await send('set shopping budget 300'); await send('set dine-out budget 200');
  await send('expense 100 shoes'); await send('7'); await send('yes');
  await send('expense 50 dinner'); await send('4'); await send('yes');
  assert.equal(summary(rows, 'one', '2026-10').limit, 100000);
  assert.equal(summary(rows, 'one', '2026-10').used, 15000);
  assert.match(await send('get shopping budget'), /Remaining: PKR 200.00/);
  assert.match(await send('get dine-out budget detail'), /dinner/);
  await send('set shopping budget 400');
  assert.match(await send('get shopping budget'), /Remaining: PKR 300.00/);
  await send('set household budget 600', config.users[1]);
  assert.match(await send('budget household'), /Budget: PKR 600.00/);
  assert.match(await send('get shopping budget', config.users[1]), /Budget: not set/);
});

test('custom categories share budgets, trim text, and appear beyond menu item ten', async () => {
  const { send, rows } = setup();
  await send('set shopping budget 500');
  assert.match(await send('  add   Brownzie   shopping  '), /Reply yes/);
  await send(' yes ');
  assert.match(await send('categories'), /11. Brownzie/);
  await send('expense 100'); await send('  a gift  '); await send(' 11 '); await send('yes');
  assert.equal(rows.find(r => r.kind === 'expense').description, 'a gift');
  assert.match(await send('get shopping budget'), /Remaining: PKR 400.00/);
  assert.equal(summary(rows, 'one', '2026-10').used, 10000);
  assert.match(await send('add brownzie'), /already exists/);
  assert.doesNotMatch(await send('categories', config.users[1]), /Brownzie/);
});
test('new named funding budget prompts for amount and keeps main budget separate', async () => {
  const { send, rows } = setup();
  await send('set budget 1000');
  assert.match(await send('add Brownzie Gifts'), /monthly budget amount for Gifts/);
  await send('200'); await send('yes');
  await send('expense 50 Brownzie'); await send('yes');
  assert.match(await send('get Gifts budget detail'), /Remaining: PKR 150.00/);
  assert.equal(summary(rows, 'one', '2026-10').limit, 100000);
  await send('set Gifts budget 300');
  assert.match(await send('get gifts budget'), /Remaining: PKR 250.00/);
});
test('guided separate and main funding; household definitions persist in ledger', async () => {
  const { bot, send, sessions, rows } = setup();
  await send('add Pet supplies from household'); await send('400'); await send('yes');
  await send('expense 20 Pet supplies'); await send('yes');
  assert.match(await send('budget household'), /Remaining: PKR 380.00/);
  await send('add Essentials'); await send('shared'); await send('main'); await send('yes');
  assert.match(await send('categories'), /Essentials → individual budget/);
  const restarted = new Bot(config, bot.store, sessions, async () => {}, bot.now);
  assert.match(await restarted.handle(config.users[0], 'categories', 'restart'), /Pet supplies/);
  assert.equal(rows.filter(r => r.kind === 'category').length, 2);
});
test('loan is a funding budget, never a lending transaction', async () => {
  const { send, rows } = setup();
  assert.match(await send('  add brownzie loan  '), /monthly budget amount for loan/);
  await send('500'); await send('yes');
  await send('expense 100 brownzie'); await send('yes');
  assert.equal(rows.at(-1).kind, 'expense');
  assert.equal(rows.at(-1).category, 'brownzie');
  assert.match(await send('get loan budget'), /Remaining: PKR 400.00/);
  assert.match(await send('loans'), /No outstanding loans/);
  assert.equal(summary(rows, 'one', '2026-10').used, 10000);
  assert.match(await send('add coffee loan'), /Reply yes/);
  await send('yes'); await send('expense 20 coffee'); await send('yes');
  assert.match(await send('get loan budget'), /Remaining: PKR 380.00/);
});
test('partially successful category plus budget creation can be retried without duplicates', async () => {
  const { bot, send, rows } = setup();
  const original = bot.store.append; let fail = true;
  bot.store.append = async r => { if (r.kind === 'budget' && fail) { fail = false; throw new Error('timeout'); } await original(r); };
  await send('add Hobby'); await send('separate'); await send('100');
  await assert.rejects(send('yes'));
  await send('yes');
  assert.equal(rows.filter(r => r.kind === 'category').length, 1);
  assert.equal(rows.filter(r => r.kind === 'budget').length, 1);
});

test('new budget setup can be cancelled; source totals and month rollover stay correct', async () => {
  const { bot, send, rows } = setup();
  await send('add Cancelled NewFund'); await send('cancel');
  assert.equal(rows.length, 0);
  await send('set budget 1000');
  await send('add Brownzie loan'); await send('300'); await send('yes');
  await send('expense 20 Brownzie'); await send('yes');
  assert.match(await send('get main budget'), /Used: PKR 0.00/);
  assert.match(await send('get loan budget'), /Remaining: PKR 280.00/);
  bot.now = () => new Date('2026-11-02T12:00:00Z');
  assert.match(await send('categories'), /Brownzie/);
  assert.match(await send('get loan budget'), /Budget: not set/);
  assert.match(await send('get loan budget'), /Used: PKR 0.00/);
});

test('help expense and help expenses show all commands without disrupting pending input', async () => {
  const { send, sessions, rows } = setup();
  await send('expense 10');
  const before = JSON.stringify(sessions);
  assert.equal(await send('help'), null);
  assert.equal(JSON.stringify(sessions), before);
  for (const text of ['  HELP expense  ', 'help   expenses']) {
    const reply = await send(text);
    for (const command of ['expense 400', 'set budget', 'get budget', 'total', 'lend', 'borrow', 'collect', 'repay', 'add <category>', 'categories', 'household', 'cancel']) assert.ok(reply.includes(command));
    assert.equal(JSON.stringify(sessions), before);
  }
  assert.equal(rows.length, 0);
});

test('household funding is shared while budget shows only the senders personal funding', async () => {
  const { send, rows } = setup();
  await send('set budget 1000'); await send('set budget 2000', config.users[1]);
  assert.match(await send('  add brownzie household  '), /monthly budget amount for household/);
  await send('500'); await send('yes');
  assert.match(await send('categories', config.users[1]), /brownzie → household/);
  await send('expense 100 brownzie'); await send('yes');
  await send('expense 50 brownzie', config.users[1]); await send('yes', config.users[1]);
  await send('expense 25'); await send('personal food'); await send('2'); await send('yes');
  assert.match(await send('budget'), /Used: PKR 25.00\nRemaining: PKR 975.00/);
  assert.match(await send('budget', config.users[1]), /Used: PKR 0.00\nRemaining: PKR 2,000.00/);
  assert.match(await send('budget household'), /Used: PKR 150.00\nRemaining: PKR 350.00/);
  const detail = await send('budget detail household');
  assert.match(detail, /Category: brownzie\nTotal: PKR 150.00/);
  assert.match(detail, /by Person One/); assert.match(detail, /by Person Two/);
  assert.doesNotMatch(detail, /personal food/);
  assert.match(await send('total household'), /PKR 150.00/);
  assert.equal(rows.find(r => r.kind === 'category').account, 'one');
  assert.match(await send('household add test'), /Use add <category> household/);
});
test('budget all detail groups every funding budget and category without double counting', async () => {
  const { send } = setup();
  await send('set budget 500'); await send('set shopping budget 200');
  await send('add Brownzie loan'); await send('300'); await send('yes');
  await send('expense 20 Brownzie'); await send('yes');
  await send('expense 30 shoes'); await send('7'); await send('yes');
  await send('expense 10'); await send('fuel stop'); await send('3'); await send('yes');
  assert.match(await send('budget'), /Used: PKR 10.00/);
  assert.match(await send('budget loan'), /Used: PKR 20.00/);
  const detail = await send('budget detail loan');
  assert.match(detail, /Remaining: PKR 280.00/);
  assert.match(detail, /Category: Brownzie\nTotal: PKR 20.00/);
  assert.doesNotMatch(detail, /shoes/);
  const all = await send('budget all detail');
  assert.match(all, /Person One · shopping|Person One · Shopping/);
  assert.match(all, /Person One · loan/); assert.match(all, /Person Two · individual/);
  assert.match(all, /household/);
  assert.equal(all.split(' · shoes · ').length - 1, 1);
  assert.equal(all.split(' · Brownzie · ').length - 1, 1);
  assert.equal(all.split(' · fuel stop · ').length - 1, 1);
  await send('set loan budget 400');
  assert.match(await send('budget detail loan'), /Remaining: PKR 380.00/);
});

test('defined commands and prompt replies never call Gemini', async () => {
  const original = global.fetch;
  const { bot, send, rows } = setup();
  bot.config = { ...config, geminiEnabled: true, geminiKey: 'test-only-placeholder' };
  try {
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('Gemini must not be called'); };
    await send('set budget 1000'); await send('budget');
    await send('expense 400 dinner at Restaurant');
    assert.equal(bot.sessions.one.stage, 'category');
    await send('4'); await send('yes');
    await send('expense 20 fuel stop | Fuel'); await send('yes');
    assert.equal(rows.filter(r => r.kind === 'expense').length, 2);
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});
test('natural language is translated once, validated and dispatched with confirmation', async () => {
  const original = global.fetch;
  const { bot, send, rows } = setup();
  bot.config = { ...config, geminiEnabled: true, geminiKey: 'test-only-placeholder' };
  try {
    let calls = 0; let request;
    global.fetch = async (_url, options) => {
      calls++; request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"command":"expense 400 dinner at Restaurant | Dine-out"}' }] } }] }) };
    };
    const input = '  GEMINI I spent 400 having dinner at Restaurant  ';
    assert.match(await send(input), /Interpreted as: expense 400 dinner at Restaurant \| Dine-out/);
    assert.equal(request.contents[0].parts[0].text, 'I spent 400 having dinner at Restaurant');
    assert.ok(request.systemInstruction.parts[0].text.includes(bot.help()));
    assert.equal(rows.length, 0);
    await send('yes');
    assert.equal(rows[0].category, 'Dine-out'); assert.equal(rows[0].description, 'dinner at Restaurant');
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
test('invalid Gemini output gets exactly three retries, no recursive calls or writes', async () => {
  const original = global.fetch;
  const { bot, send, rows } = setup();
  bot.config = { ...config, geminiEnabled: true, geminiKey: 'test-only-placeholder' };
  try {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"command":"do an unsupported thing"}' }] } }] }) }; };
    assert.match(await send('gemini please do something'), /Could not translate/);
    assert.equal(calls, 4); assert.equal(rows.length, 0); assert.deepEqual(bot.sessions, {});
    assert.equal(await send('help'), null); assert.equal(calls, 4);
  } finally { global.fetch = original; }
});

test('unrecognized text is ignored and only the gemini prefix invokes the API', async () => {
  const original = global.fetch;
  const { bot, send, rows } = setup();
  bot.config = { ...config, geminiEnabled: true, geminiKey: 'test-only-placeholder' };
  try {
    let calls = 0; let input;
    global.fetch = async (_url, options) => {
      calls++; input = JSON.parse(options.body).contents[0].parts[0].text;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"command":"budget"}' }] } }] }) };
    };
    for (const text of ['hello', 'I spent 400 on dinner', 'please use gemini', 'geminix budget', 'help', 'expense 0 food']) assert.equal(await send(text), null);
    assert.equal(calls, 0); assert.equal(rows.length, 0);
    assert.match(await send('gemini'), /Use gemini/); assert.equal(calls, 0);
    assert.match(await send(' GEMINI   show my budget '), /Interpreted as: budget/);
    assert.equal(calls, 1); assert.equal(input, 'show my budget');
    await send('expense 10');
    assert.match(await send('gemini show my budget'), /Finish the pending/);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
