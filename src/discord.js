export async function createDiscordTransport(config, onMessage, sdk) {
  const { Client, Events, GatewayIntentBits, Partials, ChannelType } = sdk || await import('discord.js');
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages];
  if (config.discordChannelId) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  const client = new Client({ intents, partials: [Partials.Channel], allowedMentions: { parse: [], repliedUser: false } });
  client.once(Events.ClientReady, () => console.log('Discord expense bot ready.'));
  client.on(Events.Error, () => console.error('Discord client error; details suppressed for privacy.'));
  client.on(Events.MessageCreate, msg => {
    const permittedChat = msg.channel.type === ChannelType.DM || (msg.guildId && config.discordChannelId && msg.channelId === config.discordChannelId);
    if (!permittedChat) return;
    // Webhook identity is mapped by its immutable ID, never its editable name.
    // Require the configured server channel even if a webhook ID is allowlisted.
    const actor = msg.webhookId
      ? msg.guildId && config.discordChannelId && msg.channelId === config.discordChannelId && config.users.find(u => u.discordWebhookIds?.includes(msg.webhookId))
      : !msg.author.bot && config.users.find(u => u.discordIds.includes(msg.author.id));
    if (!actor) return;
    onMessage({ transport: 'discord', actor, text: msg.content, id: msg.id, limit: 2000, reply: content => msg.reply({ content, allowedMentions: { parse: [], repliedUser: false } }) });
  });
  return { start: () => client.login(config.discordToken), stop: () => client.destroy() };
}
