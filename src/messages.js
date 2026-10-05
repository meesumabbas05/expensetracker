import { createHash } from 'node:crypto';

export function splitReply(text, limit) {
  const chunks = [];
  while (text.length > limit) {
    let end = text.lastIndexOf('\n', limit - 1) + 1 || limit;
    // Keep Unicode characters intact when one long line must be split.
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end);
  }
  if (text) chunks.push(text);
  return chunks;
}

export function createMessageProcessor(bot) {
  let queue = Promise.resolve();
  let accepting = true;
  return {
    enqueue(message) {
      if (!accepting) return Promise.resolve();
      queue = queue.then(async () => {
        try {
          // Preserve existing WhatsApp ledger IDs; namespace Discord IDs.
          const sourceId = message.transport === 'whatsapp' ? message.id : `${message.transport}:${message.id}`;
          const id = createHash('sha256').update(sourceId).digest('hex');
          const reply = await bot.handle(message.actor, message.text, id);
          if (reply === null) return;
          for (const chunk of splitReply(reply, message.limit)) await message.reply(chunk);
        } catch {
          console.error('Message processing failed; details suppressed for privacy.');
          try { await message.reply('Could not complete the request. Retry; pending entries are retained. If a save succeeded, it will not be added twice.'); } catch { /* disconnected */ }
        }
      }).catch(() => console.error('Processing failed.'));
      return queue;
    },
    async close() {
      accepting = false;
      await queue;
    }
  };
}
