import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
const waId = '1234567890@c.us';
const discordId = '123456789012345678';
const user = { id: 'one', name: 'Person One', whatsappIds: [waId], discordIds: [discordId] };
const env = { USERS_JSON: JSON.stringify([user]), GOOGLE_SHEET_ID: 'test-sheet', GOOGLE_SERVICE_ACCOUNT_JSON: '{}' };

test('existing environment selects WhatsApp without Discord credentials', () => {
  const config = readConfig(env);
  assert.equal(config.transport, 'whatsapp');
  assert.deepEqual(config.users[0].whatsappIds, [waId]);
  assert.equal(config.clientId, 'expense-tracker');
  assert.equal(readConfig({ ...env, USERS_JSON: JSON.stringify([{ ...user, discordIds: undefined }]) }).transport, 'whatsapp');
});
test('Discord requires its token and identities, but no WhatsApp identities', () => {
  const discordEnv = { ...env, BOT_TRANSPORT: ' discord ', DISCORD_BOT_TOKEN: ' test-token ', USERS_JSON: JSON.stringify([{ id: 'one', name: 'Person One', discordIds: [` ${discordId} `] }]) };
  const config = readConfig(discordEnv);
  assert.equal(config.transport, 'discord');
  assert.equal(config.discordToken, 'test-token');
  assert.equal(config.discordChannelId, null);
  assert.equal(config.users[0].id, 'one');
  assert.deepEqual(config.users[0].discordIds, [discordId]);
  assert.throws(() => readConfig({ ...discordEnv, DISCORD_BOT_TOKEN: '' }), /DISCORD_BOT_TOKEN/);
  for (const discordIds of [undefined, [], ['username'], [123456789012345678]]) assert.throws(() => readConfig({ ...discordEnv, USERS_JSON: JSON.stringify([{ ...user, discordIds }]) }), /discordIds/);
  assert.equal(readConfig({ ...discordEnv, DISCORD_CHANNEL_ID: '234567890123456789' }).discordChannelId, '234567890123456789');
  assert.throws(() => readConfig({ ...discordEnv, DISCORD_CHANNEL_ID: 'general' }), /DISCORD_CHANNEL_ID/);
});
test('invalid selection and ambiguous active identities fail before connecting', () => {
  assert.throws(() => readConfig({ ...env, BOT_TRANSPORT: 'both' }), /BOT_TRANSPORT/);
  const second = { ...user, id: 'two', name: 'Person Two' };
  for (const transport of ['whatsapp', 'discord']) {
    assert.throws(() => readConfig({ ...env, BOT_TRANSPORT: transport, DISCORD_BOT_TOKEN: 'test-token', USERS_JSON: JSON.stringify([user, second]) }), /Duplicate/);
  }
});
test('optional Discord webhooks require a channel, valid string IDs and unique ownership', () => {
  const webhook = '345678901234567890';
  const discordEnv = { ...env, BOT_TRANSPORT: 'discord', DISCORD_BOT_TOKEN: 'test-token', DISCORD_CHANNEL_ID: '234567890123456789' };
  const cfg = value => readConfig({ ...discordEnv, USERS_JSON: JSON.stringify([{ ...user, discordWebhookIds: value }]) });
  assert.deepEqual(cfg([` ${webhook} `]).users[0].discordWebhookIds, [webhook]);
  assert.deepEqual(cfg(undefined).users[0].discordWebhookIds, []);
  for (const value of ['webhook', [345678901234567890], ['bad'], [null]]) assert.throws(() => cfg(value), /discordWebhookIds/);
  assert.throws(() => readConfig({ ...discordEnv, DISCORD_CHANNEL_ID: '', USERS_JSON: JSON.stringify([{ ...user, discordWebhookIds: [webhook] }]) }), /DISCORD_CHANNEL_ID/);
  assert.throws(() => readConfig({ ...discordEnv, USERS_JSON: JSON.stringify([{ ...user, discordWebhookIds: [webhook] }, { ...user, id: 'two', name: 'Two', discordIds: ['456789012345678901'], discordWebhookIds: [webhook] }]) }), /Duplicate Discord webhook/);
});
