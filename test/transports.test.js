import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import * as discord from 'discord.js';
import { createDiscordTransport } from '../src/discord.js';
import { createWhatsAppTransport } from '../src/whatsapp.js';
import { createMessageProcessor, splitReply } from '../src/messages.js';
import { Bot } from '../src/bot.js';

class FakeClient extends EventEmitter {
  static instance;
  constructor(options) { super(); this.options = options; FakeClient.instance = this; }
  async login(token) { this.token = token; }
  async initialize() { this.initialized = true; }
  async destroy() { this.destroyed = true; }
}
const actor = { id: 'one', name: 'Person One', discordIds: ['123456789012345678'], whatsappIds: ['1234567890@c.us'] };
const config = { users: [actor], discordToken: 'test-token', discordChannelId: null, dataDir: '/private/tmp/test-expense', clientId: 'test', categories: ['House','Groceries','Fuel','Dine-out','Sports','Utilities','Shopping','Health','Travel','Other'], timezone: 'Asia/Karachi', currency: 'PKR', ttl: 900000, categoryBudgets: { shopping: 'Shopping', 'dine-out': 'Dine-out' }, geminiEnabled: false };
function dm(overrides = {}) {
  return { author: { id: actor.discordIds[0], bot: false }, webhookId: null, guildId: null, channel: { type: discord.ChannelType.DM }, channelId: '234567890123456789', id: '345678901234567890', content: 'budget', reply: async () => {}, ...overrides };
}

test('Discord DMs require allowlisted users, ignore bots and webhooks, and suppress mentions', async () => {
  const accepted = [];
  const transport = await createDiscordTransport(config, msg => accepted.push(msg), { ...discord, Client: FakeClient });
  const client = FakeClient.instance;
  await transport.start();
  assert.equal(client.token, config.discordToken);
  assert.ok(client.options.partials.includes(discord.Partials.Channel));
  assert.ok(client.options.intents.includes(discord.GatewayIntentBits.DirectMessages));
  assert.ok(!client.options.intents.includes(discord.GatewayIntentBits.MessageContent));
  for (const msg of [dm({ author: { id: '999999999999999999', bot: false } }), dm({ author: { id: actor.discordIds[0], bot: true } }), dm({ webhookId: 'webhook' }), dm({ channel: { type: discord.ChannelType.GroupDM } }), dm({ guildId: 'guild', channel: { type: discord.ChannelType.GuildText } })]) client.emit(discord.Events.MessageCreate, msg);
  assert.equal(accepted.length, 0);
  let response;
  client.emit(discord.Events.MessageCreate, dm({ reply: async options => { response = options; } }));
  assert.equal(accepted[0].actor.id, 'one');
  assert.equal(accepted[0].limit, 2000);
  await accepted[0].reply('@everyone <@123456789012345678>');
  assert.deepEqual(response.allowedMentions, { parse: [], repliedUser: false });
  await transport.stop();
  assert.equal(client.destroyed, true);
});
test('server messages are accepted only in the explicitly configured channel', async () => {
  const accepted = [];
  await createDiscordTransport({ ...config, discordChannelId: '456789012345678901' }, msg => accepted.push(msg), { ...discord, Client: FakeClient });
  const client = FakeClient.instance;
  assert.ok(client.options.intents.includes(discord.GatewayIntentBits.GuildMessages));
  assert.ok(client.options.intents.includes(discord.GatewayIntentBits.MessageContent));
  client.emit(discord.Events.MessageCreate, dm({ guildId: 'guild', channel: { type: discord.ChannelType.GuildText } }));
  assert.equal(accepted.length, 0);
  client.emit(discord.Events.MessageCreate, dm({ guildId: 'guild', channel: { type: discord.ChannelType.GuildText }, channelId: '456789012345678901' }));
  client.emit(discord.Events.MessageCreate, dm());
  assert.equal(accepted.length, 2);
});
test('only mapped webhooks in the configured server channel identify a trusted actor', async () => {
  const accepted = [];
  const first = { ...actor, discordWebhookIds: ['567890123456789012'] };
  const second = { id: 'two', name: 'Person Two', discordIds: ['678901234567890123'], discordWebhookIds: ['789012345678901234'] };
  const channelId = '456789012345678901';
  await createDiscordTransport({ ...config, users: [first, second], discordChannelId: channelId }, msg => accepted.push(msg), { ...discord, Client: FakeClient });
  const client = FakeClient.instance;
  const hook = dm({ guildId: 'guild', channel: { type: discord.ChannelType.GuildText }, channelId, webhookId: first.discordWebhookIds[0], author: { id: 'webhook-author', username: second.name, bot: true } });
  for (const message of [
    { ...hook, webhookId: '890123456789012345', author: { id: first.discordIds[0], bot: true } },
    { ...hook, channelId: '234567890123456789' },
    { ...hook, guildId: null, channel: { type: discord.ChannelType.DM } },
    { ...hook, webhookId: null, author: { id: first.discordIds[0], bot: true } }
  ]) client.emit(discord.Events.MessageCreate, message);
  assert.equal(accepted.length, 0);
  client.emit(discord.Events.MessageCreate, hook);
  client.emit(discord.Events.MessageCreate, { ...hook, webhookId: second.discordWebhookIds[0] });
  assert.deepEqual(accepted.map(msg => msg.actor.id), ['one', 'two']);
  let response;
  client.emit(discord.Events.MessageCreate, { ...hook, reply: async options => { response = options; } });
  await accepted.at(-1).reply('Saved expense');
  assert.deepEqual(response.allowedMentions, { parse: [], repliedUser: false });
});
test('two iPhone webhooks save and undo under their respective owners without confirmations', async () => {
  const users = [{ ...actor, discordWebhookIds: ['567890123456789012'] }, { id: 'two', name: 'Person Two', discordIds: ['678901234567890123'], discordWebhookIds: ['789012345678901234'] }];
  const rows = [], sessions = {}, replies = [];
  const store = { rows: async () => rows, append: async row => { if (!rows.some(r => r.id === row.id)) rows.push(row); } };
  const channelId = '456789012345678901';
  const cfg = { ...config, users, discordChannelId: channelId };
  const processor = createMessageProcessor(new Bot(cfg, store, sessions, async () => {}, () => new Date('2026-10-06T12:00:00Z')));
  await createDiscordTransport(cfg, msg => processor.enqueue(msg), { ...discord, Client: FakeClient });
  const send = (content, person, id) => FakeClient.instance.emit(discord.Events.MessageCreate, dm({ content, id, guildId: 'guild', channel: { type: discord.ChannelType.GuildText }, channelId, webhookId: users[person].discordWebhookIds[0], author: { id: users[person].discordWebhookIds[0], bot: true }, reply: async options => replies.push(options.content) }));
  send('expense 100 groceries | Groceries', 0, 'first');
  send('expense 200 fuel | Fuel', 1, 'second');
  send('undo', 0, 'undo-first');
  send('undo', 0, 'undo-first');
  await processor.close();
  assert.deepEqual(rows.map(r => [r.actor, r.kind]), [['one', 'expense'], ['two', 'expense'], ['one', 'undo']]);
  assert.ok(replies.some(reply => /Undid expense: PKR 100.00/.test(reply)));
  assert.deepEqual(sessions, {});
});
test('WhatsApp keeps existing direct-chat filtering and original message IDs', async () => {
  const accepted = [];
  class LocalAuth { constructor(options) { this.options = options; } }
  const transport = await createWhatsAppTransport(config, msg => accepted.push(msg), { whatsapp: { Client: FakeClient, LocalAuth }, qr: { generate() {} } });
  const client = FakeClient.instance;
  await transport.start();
  assert.equal(client.initialized, true);
  const message = { from: actor.whatsappIds[0], fromMe: false, type: 'chat', body: 'budget', id: { _serialized: 'existing-wa-id' }, reply: async () => {} };
  for (const msg of [{ ...message, fromMe: true }, { ...message, from: '123@g.us' }, { ...message, type: 'image' }, { ...message, from: '999@c.us' }]) client.emit('message', msg);
  assert.equal(accepted.length, 0);
  client.emit('message', message);
  assert.equal(accepted[0].id, 'existing-wa-id');
  assert.equal(accepted[0].transport, 'whatsapp');
  assert.equal(accepted[0].actor.id, 'one');
  await transport.stop();
  assert.equal(client.destroyed, true);
});
test('long reports retain all content within the transport limit, including Unicode', () => {
  for (const text of ['short', ('report line\n').repeat(500), 'x'.repeat(1999) + '😀' + 'y'.repeat(3000)]) {
    const chunks = splitReply(text, 2000);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => chunk.length > 0 && chunk.length <= 2000));
    assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
  }
});
test('shared processing preserves WhatsApp hashes, namespaces Discord and serializes requests', async () => {
  const calls = []; let active = 0;
  const processor = createMessageProcessor({ async handle(_actor, text, id) {
    assert.equal(active++, 0);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    calls.push({ text, id });
    return text === 'ignored' ? null : 'x'.repeat(4001);
  } });
  const replies = [];
  const message = { actor, id: 'same-id', text: 'budget', limit: 2000, reply: async content => replies.push(content) };
  await Promise.all([processor.enqueue({ ...message, transport: 'whatsapp' }), processor.enqueue({ ...message, transport: 'discord' }), processor.enqueue({ ...message, transport: 'discord', text: 'ignored' })]);
  const hash = text => createHash('sha256').update(text).digest('hex');
  assert.equal(calls[0].id, hash('same-id'));
  assert.equal(calls[1].id, hash('discord:same-id'));
  assert.equal(replies.length, 6);
  assert.ok(replies.every(content => content.length <= 2000));
  await processor.close();
  await processor.enqueue({ ...message, transport: 'discord' });
  assert.equal(calls.length, 3);
});
test('Discord expense flow writes to the same account and deduplicates redelivery', async () => {
  const rows = [], sessions = {};
  const store = { rows: async () => rows, append: async row => { if (!rows.some(r => r.id === row.id)) rows.push(row); } };
  const processor = createMessageProcessor(new Bot(config, store, sessions, async () => {}, () => new Date('2026-10-05T12:00:00Z')));
  await createDiscordTransport(config, message => processor.enqueue(message), { ...discord, Client: FakeClient });
  const client = FakeClient.instance;
  const send = (content, id) => client.emit(discord.Events.MessageCreate, dm({ content, id }));
  send('expense 400 dinner | Dine-out', 'origin');
  send('expense 400 dinner | Dine-out', 'origin');
  await processor.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, 'one');
  assert.equal(rows[0].actor, 'one');
  assert.equal(rows[0].amount, 40000);
  assert.equal(rows[0].id, createHash('sha256').update('discord:origin').digest('hex'));
});

test('a failed request and failed error reply do not block the next queued command', async () => {
  let calls = 0;
  const processor = createMessageProcessor({ async handle() { if (++calls === 1) throw new Error('test failure'); return 'next report'; } });
  const message = { transport: 'discord', actor, id: 'failed', text: 'budget', limit: 2000, reply: async () => { throw new Error('disconnected'); } };
  const replies = [];
  await processor.enqueue(message);
  await processor.enqueue({ ...message, id: 'next', reply: async content => replies.push(content) });
  await processor.close();
  assert.deepEqual(replies, ['next report']);
});
