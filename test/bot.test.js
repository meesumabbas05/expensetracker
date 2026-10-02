import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { amount, summary, dateParts, loans } from '../src/domain.js';
const config = { categories: ['House','Groceries','Fuel','Dine-out','Sports','Utilities','Shopping','Health','Travel','Other'], users: [{ id: 'one', name: 'Person One' }, { id: 'two', name: 'Person Two' }], timezone: 'Asia/Karachi', currency: 'PKR', ttl: 900000, geminiEnabled: false };
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
  assert.match(await send('help'), /Commands/);
  assert.match(await send('yes'), /Unknown command/);
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
