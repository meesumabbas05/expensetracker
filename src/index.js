import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import whatsapp from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import { readConfig } from './config.js';
import { SheetStore } from './store.js';
import { Bot } from './bot.js';
async function main() {
const config = readConfig();
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
const sessionPath = path.resolve(config.dataDir, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(await readFile(sessionPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read pending sessions'); }
const save = async () => {
  await writeFile(sessionPath + '.tmp', JSON.stringify(sessions), { mode: 0o600 });
  await rename(sessionPath + '.tmp', sessionPath);
};
const store = new SheetStore(config);
await store.init();
const bot = new Bot(config, store, sessions, save);
const { Client, LocalAuth } = whatsapp;
const client = new Client({ authStrategy: new LocalAuth({ clientId: config.clientId, dataPath: path.resolve(config.dataDir, 'whatsapp-auth') }), puppeteer: { headless: true, executablePath: config.chromePath, args: config.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [] } });
client.on('qr', code => { if (config.showQr) qr.generate(code, { small: true }); else console.log('QR available. Enable SHOW_QR temporarily in a private terminal to link this bot.'); });
client.on('ready', () => console.log('Expense bot ready.'));
client.on('auth_failure', () => console.error('WhatsApp authentication failed.'));
client.on('disconnected', () => { console.error('WhatsApp disconnected; restarting.'); process.exit(1); });
let queue = Promise.resolve();
client.on('message', msg => {
  // Only allow configured users in direct chats. Never log chat IDs or message bodies.
  if (msg.fromMe || msg.from.endsWith('@g.us') || msg.type !== 'chat') return;
  const actor = config.users.find(u => u.whatsappIds.includes(msg.from));
  if (!actor) return;
  queue = queue.then(async () => {
    try {
      const id = createHash('sha256').update(msg.id._serialized).digest('hex');
      const reply = await bot.handle(actor, msg.body, id);
      if (reply === null) return;
      // Keep every entry; split long monthly reports at line boundaries.
      let chunk = '';
      for (const line of reply.split('\n')) {
        if (chunk.length + line.length > 3000) { await msg.reply(chunk); chunk = ''; }
        chunk += (chunk ? '\n' : '') + line;
      }
      if (chunk) await msg.reply(chunk);
    } catch {
      console.error('Message processing failed; details suppressed for privacy.');
      try { await msg.reply('Could not complete the request. Retry; pending entries are retained. If a save succeeded, it will not be added twice.'); } catch { /* disconnected */ }
    }
  }).catch(() => console.error('Processing failed.'));
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await queue; await client.destroy(); process.exit(0); });
await client.initialize();

}
main().catch(() => { console.error('Startup failed. Check environment configuration, Sheets access and Chromium installation privately.'); process.exit(1); });
