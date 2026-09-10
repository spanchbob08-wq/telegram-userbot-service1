import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');

test('userbot service exposes a batch send endpoint for one-connection broadcasts', () => {
  assert.ok(src.includes("app.post('/send-batch'"));
});
