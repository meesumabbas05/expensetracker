import test from 'node:test';
import assert from 'node:assert/strict';
import { translateCommand } from '../src/extract.js';
import { validGeneratedCommand } from '../src/commands.js';
const config = { geminiEnabled: true, geminiKey: 'test-only-placeholder', geminiModel: 'test-model' };
const categories = ['Shopping', 'Dine-out', 'Other'];
const success = text => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
test('full input, exact help response and strict JSON schema are sent to Gemini', async () => {
  const original = global.fetch;
  try {
    let sent;
    global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return success('{"command":"expense 400 dinner at Restaurant | Dine-out"}'); };
    const input = '  I spent 400 on dinner at Restaurant\nplease record it  ';
    const help = 'expense <amount> <description> | <category>\nbudget all detail';
    assert.equal(await translateCommand(input, config, help, categories, validGeneratedCommand), 'expense 400 dinner at Restaurant | Dine-out');
    assert.equal(sent.contents[0].parts[0].text, input);
    assert.ok(sent.systemInstruction.parts[0].text.includes(help));
    assert.equal(sent.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.deepEqual(sent.generationConfig.responseJsonSchema.required, ['command']);
  } finally { global.fetch = original; }
});
test('invalid responses receive three retries with correction feedback', async () => {
  const original = global.fetch;
  try {
    const outputs = ['not JSON', '{"command":"run shell rm -rf"}', '{"command":"budget","extra":"text"}', '{"command":"budget all detail"}'];
    const requests = [];
    global.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return success(outputs.shift()); };
    assert.equal(await translateCommand('show everything', config, 'budget all detail', categories, validGeneratedCommand), 'budget all detail');
    assert.equal(requests.length, 4);
    assert.equal(requests[3].contents[0].parts[0].text, 'show everything');
    assert.ok(requests[3].contents.at(-1).parts[0].text.includes('Retry'));
  } finally { global.fetch = original; }
});
test('exhausted retries never execute unsupported commands or confirmations', async () => {
  const original = global.fetch;
  try {
    let calls = 0;
    global.fetch = async () => { calls++; return success('{"command":"yes"}'); };
    assert.equal(await translateCommand('save it', config, 'commands', categories, validGeneratedCommand), null);
    assert.equal(calls, 4);
    assert.equal(validGeneratedCommand('expense -2 food', categories), false);
    assert.equal(validGeneratedCommand('expense 20 food | Unknown', categories), false);
    assert.equal(validGeneratedCommand('budget\nset budget 100', categories), false);
    assert.equal(validGeneratedCommand('help', categories), false);
  } finally { global.fetch = original; }
});
test('quota failure and disabled Gemini return a local fallback', async () => {
  const original = global.fetch;
  try {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: false }; };
    assert.equal(await translateCommand('food', config, 'commands', categories, validGeneratedCommand), null);
    assert.equal(calls, 1);
    assert.equal(await translateCommand('food', { ...config, geminiEnabled: false }, 'commands', categories, validGeneratedCommand), null);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
