import 'dotenv/config';

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.log('❌ Проверь TELEGRAM_API_ID и TELEGRAM_API_HASH в .env');
  process.exit(1);
}

const client = new TelegramClient(
  new StringSession(''),
  apiId,
  apiHash,
  {
    connectionRetries: 5
  }
);

console.log('🔐 Авторизация Telegram...');

await client.start({
  phoneNumber: async () =>
    await input.text('Введите номер телефона: '),

  password: async () =>
    await input.text('Введите пароль 2FA, если есть: '),

  phoneCode: async () =>
    await input.text('Введите код из Telegram: '),

  onError: (err) => {
    console.log('❌ Ошибка:', err.message);
  }
});

const me = await client.getMe();

console.log('');
console.log('✅ АККАУНТ ПОДКЛЮЧЕН');
console.log('ID:', String(me.id));
console.log('Username:', me.username || 'нет');
console.log('Имя:', me.firstName || '');

console.log('');
console.log('SESSION:');
console.log(client.session.save());

await client.disconnect();