import path from 'node:path';

export async function createWhatsAppTransport(config, onMessage, dependencies) {
  const { whatsapp, qr } = dependencies || await Promise.all([import('whatsapp-web.js'), import('qrcode-terminal')]).then(([wa, code]) => ({ whatsapp: wa.default, qr: code.default }));
  const { Client, LocalAuth } = whatsapp;
  const client = new Client({ authStrategy: new LocalAuth({ clientId: config.clientId, dataPath: path.resolve(config.dataDir, 'whatsapp-auth') }), puppeteer: { headless: true, executablePath: config.chromePath, args: config.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [] } });
  client.on('qr', code => { if (config.showQr) qr.generate(code, { small: true }); else console.log('QR available. Enable SHOW_QR temporarily in a private terminal to link this bot.'); });
  client.on('ready', () => console.log('WhatsApp expense bot ready.'));
  client.on('auth_failure', () => console.error('WhatsApp authentication failed.'));
  client.on('disconnected', () => { console.error('WhatsApp disconnected; restarting.'); process.exit(1); });
  client.on('message', msg => {
    if (msg.fromMe || msg.from.endsWith('@g.us') || msg.type !== 'chat') return;
    const actor = config.users.find(u => u.whatsappIds.includes(msg.from));
    if (!actor) return;
    onMessage({ transport: 'whatsapp', actor, text: msg.body, id: msg.id._serialized, limit: 3000, reply: chunk => msg.reply(chunk) });
  });
  return { start: () => client.initialize(), stop: () => client.destroy() };
}
