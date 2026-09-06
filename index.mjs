import 'dotenv/config';
import express from 'express';

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 10000);
const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = String(process.env.TELEGRAM_API_HASH || '');
const SERVICE_KEY = String(process.env.SERVICE_KEY || '');

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-userbot-service'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/telegram-check', async (req, res) => {
  if (req.headers['x-service-key'] !== SERVICE_KEY) {
    return res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED'
    });
  }

  if (!API_ID || !API_HASH) {
    return res.status(500).json({
      ok: false,
      error: 'API_ID_OR_HASH_MISSING'
    });
  }

  const client = new TelegramClient(
    new StringSession(''),
    API_ID,
    API_HASH,
    {
      connectionRetries: 3,
      useWSS: true
    }
  );

  try {
    await client.connect();

    res.json({
      ok: true,
      connected: true
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      connected: false,
      error: error.message
    });
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Userbot service started on port ${PORT}`);
});