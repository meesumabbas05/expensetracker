import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../src/extract.js';
const config = { geminiEnabled: true, geminiKey: 'test-only-placeholder', geminiModel: 'test-model', categories: ['Shopping', 'Dine-out', 'Other'] };
test('Gemini receives only description and category instructions; validates suggestions', async () => {
  const original = global.fetch;
  try {
    let sent;
    global.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ description: 'Restaurant', category: 'Dine-out' }) }] } }] }) };
    };
    assert.deepEqual(await extract('dinner at Restaurant', config), { description: 'Restaurant', category: 'Dine-out' });
    assert.equal(sent.contents[0].parts[0].text, 'dinner at Restaurant');
    assert.equal(Object.keys(sent).includes('actor'), false);
    global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"description":"Restaurant","category":"Invalid"}' }] } }] }) });
    assert.equal(await extract('dinner', config), null);
  } finally { global.fetch = original; }
});
test('quota/network failure and disabled Gemini fall back without throwing', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: false });
    assert.equal(await extract('food', config), null);
    global.fetch = async () => { throw new Error('private upstream error'); };
    assert.equal(await extract('food', config), null);
    assert.equal(await extract('food', { ...config, geminiEnabled: false }), null);
  } finally { global.fetch = original; }
});
