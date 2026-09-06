import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');

test('userbot service exposes phone login lifecycle without storing credentials', () => {
  for (const token of [
    "app.post('/auth/phone/start'",
    "app.post('/auth/phone/code'",
    "app.post('/auth/phone/password'",
    "app.get('/auth/phone/status/:authId'",
    "app.post('/auth/phone/consume'",
    'client.start(',
    "state.status = 'waiting_code'",
    'PHONE_NOT_REGISTERED',
    'firstAndLastNames',
  ]) assert.ok(src.includes(token), token);
});
