import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { readConfig } from '../src/config.js';
import { activeLedgerRows } from '../src/domain.js';

function setup() {
  const config = readConfig({ USERS_JSON: JSON.stringify([{ id: 'one', name: 'One', whatsappIds: ['123@c.us'] }, { id: 'two', name: 'Two', whatsappIds: ['456@c.us'] }]), GOOGLE_SHEET_ID: 'test-sheet', GOOGLE_SERVICE_ACCOUNT_JSON: '{}', GEMINI_ENABLED: 'false' });
  const history = [], sessions = {};
  const store = { rows: async () => history, append: async row => { if (!history.some(r => r.id === row.id)) history.push(row); } };
  const now = () => new Date('2026-10-06T12:00:00Z');
  const bot = new Bot(config, store, sessions, async () => {}, now);
  let sequence = 0;
  const send = (text, person = 0, id = `undo-test-${++sequence}`) => bot.handle(config.users[person], text, id);
  return { bot, config, history, store, now, send };
}

test('complete expenses, guided expenses, categories and loans save without yes', async () => {
  const { send, history, bot } = setup();
  assert.match(await send('expense 100 food | Groceries'), /Saved expense/);
  assert.match(await send('expense 50'), /Where/);
  assert.match(await send('medicine'), /Choose a category/);
  assert.match(await send('8'), /Saved expense/);
  assert.match(await send('add Hobby from individual'), /Added Hobby/);
  assert.match(await send('borrow 20 from Alex'), /Saved borrow/);
  assert.deepEqual(bot.sessions, {});
  assert.deepEqual(history.map(r => r.kind), ['expense', 'expense', 'category', 'borrow']);
  assert.doesNotMatch(bot.help(), /Reply yes|confirm/);
});

test('undo survives restart, restores totals and attribution, and is limited to your own latest change', async () => {
  const { send, bot, config, store, now, history } = setup();
  await send('expense 100 groceries | Groceries');
  await send('expense 200 fuel | Fuel', 1);
  assert.match(await send('undo'), /Undid expense: PKR 100.00/);
  assert.match(await send('budget household'), /Used: PKR 200.00/);
  assert.match(await send('budget household'), /One: PKR 0.00\nTwo: PKR 200.00/);
  const restarted = new Bot(config, store, {}, async () => {}, now);
  assert.match(await restarted.handle(config.users[1], 'undo', 'restart-undo'), /PKR 200.00/);
  assert.match(await send('budget household'), /Used: PKR 0.00/);
  assert.match(await send('undo'), /no saved change/);
  assert.equal(history.filter(r => r.kind === 'expense').length, 2, 'original rows remain for audit');
  assert.deepEqual(activeLedgerRows(history), []);
  assert.deepEqual(bot.sessions, {});
});

test('budget undo restores previous monthly limit or default without resetting spending', async () => {
  const { send } = setup();
  await send('expense 100 groceries | Groceries');
  await send('set household budget 1000');
  await send('set household budget 2000');
  await send('undo');
  assert.match(await send('budget household'), /Budget: PKR 1,000.00\nUsed: PKR 100.00\nRemaining: PKR 900.00/);
  await send('undo');
  assert.match(await send('budget household'), /Budget: PKR 25,000.00\nUsed: PKR 100.00/);
  await send('set individual budget 3000');
  await send('set individual budget 4000', 1);
  await send('undo');
  assert.match(await send('budget individual'), /Budget: PKR 25,000.00/);
  assert.match(await send('budget individual', 1), /Budget: PKR 4,000.00/);
});

test('undo leaves the other persons later shared budget update applicable', async () => {
  const { send } = setup();
  await send('set shopping budget 1000');
  await send('set shopping budget 2000', 1);
  await send('undo');
  assert.match(await send('budget shopping'), /Budget: PKR 2,000.00/);
  await send('undo', 1);
  assert.match(await send('budget shopping'), /Budget: PKR 25,000.00/);
});

test('category and initial budget undo together and reports never expose undo markers', async () => {
  const { send, history } = setup();
  await send('add Hobby'); await send('separate');
  assert.match(await send('1000'), /Added Hobby/);
  assert.equal(history.length, 2);
  assert.match(await send('undo'), /category Hobby and its initial budget/);
  assert.doesNotMatch(await send('categories'), /Hobby/);
  assert.doesNotMatch(await send('budget all detail'), /Hobby|undo-test|Undo/);
  assert.match(await send('budget Hobby'), /Unknown budget/);
});

test('redelivery of undo does not undo twice, and an undone original command cannot return', async () => {
  const { send, history } = setup();
  await send('expense 10 first | Sports', 0, 'first');
  await send('expense 20 second | Sports', 0, 'second');
  await send('undo', 0, 'undo-once');
  assert.match(await send('undo', 0, 'undo-once'), /already been processed/);
  assert.match(await send('expense 20 second | Sports', 0, 'second'), /already been processed/);
  assert.match(await send('budget individual'), /Used: PKR 10.00/);
  assert.equal(history.length, 3);
});

test('a category used by another person cannot be undone until their expense is undone', async () => {
  const { send } = setup();
  await send('add Gifts from shopping');
  await send('expense 10 gift | Gifts', 1);
  assert.match(await send('undo'), /Cannot undo this category/);
  assert.match(await send('budget shopping'), /Used: PKR 10.00/);
  await send('undo', 1);
  assert.match(await send('undo'), /Undid category Gifts/);
});

test('loan undo rejects removing principal needed by another persons repayment', async () => {
  const { send } = setup();
  await send('household borrow 100 from Alex');
  await send('household repay 20 to Alex', 1);
  assert.match(await send('undo'), /later collections or repayments depend/);
  await send('undo', 1);
  assert.match(await send('household loans'), /you owe PKR 100.00/);
  assert.match(await send('undo'), /Undid borrow/);
  assert.match(await send('household loans'), /No outstanding loans/);
});

test('uncertain immediate writes retry the same delivery without leaving stale sessions', async () => {
  const { send, bot, store, history } = setup();
  const append = store.append;
  let fail = true;
  store.append = async row => { await append(row); if (fail) { fail = false; throw new Error('timeout'); } };
  await assert.rejects(send('expense 10 food | Groceries', 0, 'uncertain'), /timeout/);
  assert.match(await send('expense 10 food | Groceries', 0, 'uncertain'), /Saved expense/);
  assert.equal(history.length, 1);
  assert.deepEqual(bot.sessions, {});
  fail = true;
  await assert.rejects(send('undo', 0, 'uncertain-undo'), /timeout/);
  assert.match(await send('undo', 0, 'uncertain-undo'), /already been processed/);
  assert.match(await send('budget household'), /Used: PKR 0.00/);
});

test('partial category writes resume after restart and undo reverses the completed operation', async () => {
  const { send, bot, config, store, history, now } = setup();
  const append = store.append;
  let fail = true;
  store.append = async row => { if (row.kind === 'budget' && fail) { fail = false; throw new Error('timeout'); } await append(row); };
  await send('add Hobby'); await send('separate');
  await assert.rejects(send('1000', 0, 'amount-input'), /timeout/);
  const restarted = new Bot(config, store, structuredClone(bot.sessions), async () => {}, now);
  assert.match(await restarted.handle(config.users[0], '1000', 'amount-input'), /Added Hobby/);
  assert.equal(history.length, 2);
  await send('cancel'); // Discard this test's earlier in-memory session.
  assert.match(await send('undo'), /category Hobby and its initial budget/);
  assert.deepEqual(activeLedgerRows(history), []);
});

test('undo markers must reference saved entries belonging to their author', () => {
  const row = { id: 'one', actor: 'one', kind: 'expense' };
  assert.throws(() => activeLedgerRows([row, { id: 'undo', actor: 'two', kind: 'undo', description: '["one"]' }]), /Invalid undo record/);
  assert.throws(() => activeLedgerRows([row, { id: 'undo', actor: 'one', kind: 'undo', description: '["missing"]' }]), /Invalid undo record/);
});
test('undo after an uncertain expense write clears its retry session even if undo also times out', async () => {
  const { send, bot, store } = setup();
  const append = store.append;
  store.append = async row => { await append(row); throw new Error('timeout'); };
  await assert.rejects(send('expense 10 food | Groceries', 0, 'failed-expense'));
  await assert.rejects(send('undo', 0, 'failed-undo'));
  assert.match(await send('undo', 0, 'failed-undo'), /already been processed/);
  assert.deepEqual(bot.sessions, {});
  assert.match(await send('budget household'), /Used: PKR 0.00/);
});
test('a guided expense cannot use a category undone while it was awaiting input', async () => {
  const { send } = setup();
  await send('add Gifts from shopping');
  await send('expense 10 gift', 1);
  await send('undo');
  assert.match(await send('13', 1), /category is no longer available/);
  assert.match(await send('budget shopping'), /Used: PKR 0.00/);
});
