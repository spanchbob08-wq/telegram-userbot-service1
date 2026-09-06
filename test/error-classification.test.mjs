import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTelegramError } from '../errors.mjs';

test('classifies flood wait with seconds', () => {
  const x = classifyTelegramError(new Error('A wait of 42 seconds is required (caused by messages.SendMessage) FLOOD_WAIT_42'));
  assert.equal(x.code, 'FLOOD_WAIT');
  assert.equal(x.retry_after, 42);
  assert.equal(x.definitive, false);
});

test('classifies revoked/deactivated authorization as definitive', () => {
  for (const msg of ['AUTH_KEY_UNREGISTERED', 'USER_DEACTIVATED', 'USER_DEACTIVATED_BAN', 'SESSION_REVOKED']) {
    const x = classifyTelegramError(new Error(msg));
    assert.equal(x.code, 'DEFINITIVE_AUTH_FAILURE', msg);
    assert.equal(x.definitive, true, msg);
  }
});

test('network timeout stays temporary', () => {
  const x = classifyTelegramError(new Error('ETIMEDOUT 149.154.167.91:443'));
  assert.equal(x.code, 'TEMPORARY');
  assert.equal(x.definitive, false);
});
