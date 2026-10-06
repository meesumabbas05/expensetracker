import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetStore } from '../src/store.js';
function mocked(rows) {
  const store = Object.create(SheetStore.prototype);
  store.id = 'test-sheet';
  let appended;
  store.api = { spreadsheets: { values: { get: async () => ({ data: { values: rows } }), append: async value => { appended = value; } } } };
  return { store, appended: () => appended };
}
test('ledger accepts zero category definitions while rejecting zero transactions', async () => {
  const row = ['id', '2026-10-02T12:00:00Z', '2026-10-02', '2026-10', 'one', 'one', 'category', '0', '{"source":"loan"}', 'brownzie'];
  assert.equal((await mocked([row]).store.rows())[0].amount, 0);
  await assert.rejects(mocked([[...row.slice(0, 6), 'expense', ...row.slice(7)]]).store.rows(), /Invalid ledger row/);
});
test('append trims strings, uses RAW and deduplicates by ID', async () => {
  const { store, appended } = mocked([]);
  const row = { id: 'id', timestamp: '2026-10-02T12:00:00Z', date: '2026-10-02', month: '2026-10', account: 'one', actor: 'one', kind: 'expense', amount: 100, description: ' =IMPORTXML("example") ', category: ' brownzie ' };
  await store.append(row);
  assert.equal(appended().valueInputOption, 'RAW');
  assert.equal(appended().requestBody.values[0][8], '=IMPORTXML("example")');
  assert.equal(appended().requestBody.values[0][9], 'brownzie');
  const again = mocked([appended().requestBody.values[0]]);
  assert.equal(await again.store.append(row), false);
  assert.equal(again.appended(), undefined);
});
test('undo ledger records have zero amount and retain target IDs', async () => {
  const row = ['undo-id', '2026-10-06T12:00:00Z', '2026-10-06', '2026-10', 'one', 'one', 'undo', '0', '["expense-id"]', 'Undo'];
  assert.equal((await mocked([row]).store.rows())[0].kind, 'undo');
  await assert.rejects(mocked([[...row.slice(0, 7), '1', ...row.slice(8)]]).store.rows(), /Invalid ledger row/);
});
