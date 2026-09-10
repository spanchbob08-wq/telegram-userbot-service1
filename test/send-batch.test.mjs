import test from 'node:test';
import assert from 'node:assert/strict';
import { sendBatchWithClient } from '../send-batch.mjs';

test('sends multiple chats after one dialogs lookup', async () => {
  let dialogsCalls = 0;
  const sentTo = [];
  const entities = new Map([['1', { id: 1n }], ['2', { id: 2n }]]);
  const client = {
    async getDialogs() { dialogsCalls += 1; return [...entities.values()].map(entity => ({ id: entity.id, entity })); },
    async getEntity(id) { return entities.get(String(id)); },
    async sendMessage(entity, { message }) { sentTo.push([String(entity.id), message]); return { id: sentTo.length }; },
  };
  const result = await sendBatchWithClient(client, ['1', '2'], 'hello');
  assert.equal(dialogsCalls, 1);
  assert.equal(result.sent, 2);
  assert.deepEqual(sentTo, [['1', 'hello'], ['2', 'hello']]);
});

test('stops the batch on Telegram FLOOD_WAIT instead of hammering the account', async () => {
  let attempts = 0;
  const client = {
    async getDialogs() { return [{ id: 1n, entity: { id: 1n } }, { id: 2n, entity: { id: 2n } }]; },
    async getEntity(id) { return { id }; },
    async sendMessage() {
      attempts += 1;
      if (attempts === 1) throw new Error('FLOOD_WAIT_30');
      return { id: attempts };
    },
  };
  const result = await sendBatchWithClient(client, ['1', '2'], 'hello');
  assert.equal(attempts, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.results[0].code, 'FLOOD_WAIT');
  assert.equal(result.results.length, 1);
});
