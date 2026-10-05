import path from 'node:path';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { readConfig } from './config.js';
import { SheetStore } from './store.js';
import { Bot } from './bot.js';
import { createMessageProcessor } from './messages.js';

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
  const processor = createMessageProcessor(new Bot(config, store, sessions, save));
  const transport = config.transport === 'discord'
    ? await (await import('./discord.js')).createDiscordTransport(config, message => processor.enqueue(message))
    : await (await import('./whatsapp.js')).createWhatsAppTransport(config, message => processor.enqueue(message));
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await processor.close();
    await transport.stop();
    process.exit(0);
  });
  await transport.start();
}
main().catch(() => { console.error('Startup failed. Check environment configuration, Sheets access and selected transport setup privately.'); process.exit(1); });
