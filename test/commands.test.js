import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, validGeneratedCommand } from '../src/commands.js';
const categories = ['Shopping', 'Dine-out', 'Other'];
test('canonical expense parsing trims fields and resolves explicit categories', () => {
  const parsed = parseCommand('  expense 400  dinner at a restaurant  |  dine-out  ', categories);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.description, 'dinner at a restaurant');
  assert.equal(parsed.category, 'Dine-out');
});
test('generated commands accept supported forms and reject unsafe or malformed output', () => {
  for (const text of ['budget all detail', 'budget detail household', 'set loan budget 500', 'add Brownzie household', 'expense 400', 'lend 50 to Alex', 'help expenses']) assert.equal(validGeneratedCommand(text, categories), true, text);
  for (const text of ['yes', 'no', 'help', 'execute code', 'expense 0', 'set budget NaN', 'expense 10 a | Unknown', 'budget\ncancel', 'expense 10 a | Other | Shopping']) assert.equal(validGeneratedCommand(text, categories), false, text);
});
