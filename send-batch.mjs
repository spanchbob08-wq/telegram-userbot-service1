import { findDialogEntity } from './dialog-select.mjs';
import { classifyTelegramError } from './errors.mjs';

export async function sendBatchWithClient(client, chatIds, text) {
  const dialogs = await client.getDialogs({ limit: 200 });
  const results = [];
  let sent = 0;

  for (const chatId of chatIds) {
    try {
      const entity = findDialogEntity(dialogs, chatId) || await client.getEntity(BigInt(chatId));
      const message = await client.sendMessage(entity, { message: text });
      sent += 1;
      results.push({ chat_id: String(chatId), ok: true, message_id: message.id });
    } catch (error) {
      const classified = classifyTelegramError(error);
      results.push({ chat_id: String(chatId), ok: false, error, code: classified.code, retry_after: classified.retry_after || 0, definitive: classified.definitive });
      if (classified.code === 'FLOOD_WAIT' || classified.definitive) break;
    }
  }

  return { sent, results };
}
