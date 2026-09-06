import test from 'node:test';
import assert from 'node:assert/strict';
import { findDialogEntity } from '../dialog-select.mjs';

test('finds an existing dialog entity by Telegram dialog id', () => {
  const entity = { id: 99n, accessHash: 123n };
  const dialogs = [{ id: -1001234567890n, entity }, { id: 42n, entity: { id: 42n } }];
  assert.equal(findDialogEntity(dialogs, '-1001234567890'), entity);
});

test('returns null when the target is not in fetched dialogs', () => {
  assert.equal(findDialogEntity([{ id: 1n, entity: {} }], '2'), null);
});
