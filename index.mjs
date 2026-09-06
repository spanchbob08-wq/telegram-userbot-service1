import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { classifyTelegramError } from './errors.mjs';
import { findDialogEntity } from './dialog-select.mjs';

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.PORT || 10000);
const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = String(process.env.TELEGRAM_API_HASH || '');
const SERVICE_KEY = String(process.env.SERVICE_KEY || '');
const AUTH_TTL_MS = 10 * 60 * 1000;

if (!API_ID || !API_HASH || !SERVICE_KEY) throw new Error('Required Telegram/Service environment variables are missing');

const auths = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkKey(req, res, next) {
  if (String(req.headers['x-service-key'] || '') !== SERVICE_KEY) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
  }
  next();
}

function makeClient(session = '') {
  return new TelegramClient(new StringSession(String(session || '')), API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true,
  });
}

function safeAccount(user) {
  return {
    id: String(user?.id || ''),
    username: user?.username || null,
    first_name: user?.firstName || '',
    last_name: user?.lastName || '',
    display_name: [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim(),
  };
}

function errorResponse(res, err, fallbackStatus = 500) {
  const x = classifyTelegramError(err);
  let status = fallbackStatus;
  if (x.code === 'FLOOD_WAIT') status = 429;
  if (x.code === 'DEFINITIVE_AUTH_FAILURE') status = 401;
  console.error('Telegram error:', x.code);
  return res.status(status).json({
    ok: false,
    code: x.code,
    message: x.message,
    ...(x.retry_after ? { retry_after: x.retry_after } : {}),
    definitive: x.definitive,
  });
}

async function cleanupAuth(authId) {
  const state = auths.get(authId);
  if (!state) return;
  try { await state.client?.disconnect(); } catch {}
  auths.delete(authId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, state] of auths) {
    if (now - state.createdAt > AUTH_TTL_MS) cleanupAuth(id).catch(() => {});
  }
}, 60_000).unref?.();

app.get('/', (_req, res) => res.json({ ok: true, service: 'telegram-userbot-service', version: 2 }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/telegram-check', checkKey, async (_req, res) => {
  const client = makeClient();
  try {
    await client.connect();
    return res.json({ ok: true, connected: true });
  } catch (err) {
    return errorResponse(res, err);
  } finally {
    try { await client.disconnect(); } catch {}
  }
});

app.post('/auth/qr/start', checkKey, async (req, res) => {
  const userId = String(req.body?.userId || '');
  if (!userId) return res.status(400).json({ ok: false, code: 'USER_ID_REQUIRED' });

  const authId = crypto.randomUUID();
  const client = makeClient();
  const state = {
    authId,
    userId,
    client,
    status: 'starting',
    qrPng: null,
    qrVersion: 0,
    session: null,
    account: null,
    passwordResolve: null,
    passwordReject: null,
    createdAt: Date.now(),
    error: null,
  };
  auths.set(authId, state);

  try { await client.connect(); }
  catch (err) { await cleanupAuth(authId); return errorResponse(res, err); }

  client.signInUserWithQrCode(
    { apiId: API_ID, apiHash: API_HASH },
    {
      qrCode: async ({ token }) => {
        const link = `tg://login?token=${token.toString('base64url')}`;
        state.qrPng = await QRCode.toBuffer(link, { type: 'png', width: 420, margin: 2 });
        state.qrVersion += 1;
        state.status = 'waiting_scan';
      },
      password: async () => {
        state.status = 'password_required';
        return new Promise((resolve, reject) => {
          state.passwordResolve = resolve;
          state.passwordReject = reject;
          setTimeout(() => reject(new Error('2FA_TIMEOUT')), 5 * 60 * 1000);
        });
      },
      onError: async err => {
        const x = classifyTelegramError(err);
        state.error = { code: x.code, message: x.message };
        return true;
      },
    },
  ).then(user => {
    state.session = client.session.save();
    state.account = safeAccount(user);
    state.status = 'authorized';
    state.passwordResolve = null;
    state.passwordReject = null;
  }).catch(err => {
    const x = classifyTelegramError(err);
    state.error = { code: x.code, message: x.message };
    state.status = 'error';
  });

  for (let i = 0; i < 60; i++) {
    if (state.qrPng || state.status === 'error' || state.status === 'authorized') break;
    await sleep(100);
  }
  if (state.status === 'error') return res.status(500).json({ ok: false, ...state.error });

  return res.json({
    ok: true,
    auth_id: authId,
    status: state.status,
    qr_version: state.qrVersion,
    qr_url: `${req.protocol}://${req.get('host')}/auth/qr/image/${authId}`,
    expires_in: Math.floor(AUTH_TTL_MS / 1000),
  });
});

app.get('/auth/qr/image/:authId', async (req, res) => {
  const state = auths.get(req.params.authId);
  if (!state?.qrPng) return res.status(404).send('QR not found or expired');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  return res.send(state.qrPng);
});

app.get('/auth/qr/status/:authId', checkKey, async (req, res) => {
  const state = auths.get(req.params.authId);
  if (!state) return res.status(404).json({ ok: false, code: 'AUTH_NOT_FOUND' });
  return res.json({
    ok: true,
    status: state.status,
    qr_version: state.qrVersion,
    account: state.account,
    error: state.error,
  });
});

app.post('/auth/qr/password', checkKey, async (req, res) => {
  const authId = String(req.body?.authId || '');
  let password = String(req.body?.password || '');
  const state = auths.get(authId);
  if (!state) return res.status(404).json({ ok: false, code: 'AUTH_NOT_FOUND' });
  if (state.status !== 'password_required' || !state.passwordResolve) {
    password = '';
    return res.status(400).json({ ok: false, code: 'PASSWORD_NOT_REQUIRED' });
  }
  const resolve = state.passwordResolve;
  state.passwordResolve = null;
  state.passwordReject = null;
  state.status = 'authorizing';
  resolve(password);
  password = '';
  return res.json({ ok: true });
});

app.post('/auth/qr/consume', checkKey, async (req, res) => {
  const authId = String(req.body?.authId || '');
  const state = auths.get(authId);
  if (!state) return res.status(404).json({ ok: false, code: 'AUTH_NOT_FOUND' });
  if (state.status !== 'authorized' || !state.session) {
    return res.status(400).json({ ok: false, code: 'NOT_AUTHORIZED_YET', status: state.status });
  }
  const result = { ok: true, session: state.session, account: state.account };
  await cleanupAuth(authId);
  return res.json(result);
});

app.post('/dialogs', checkKey, async (req, res) => {
  const session = String(req.body?.session || '');
  const limit = Math.min(200, Math.max(1, Number(req.body?.limit || 100)));
  if (!session) return res.status(400).json({ ok: false, code: 'SESSION_REQUIRED' });
  const client = makeClient(session);
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      return res.status(401).json({ ok: false, code: 'DEFINITIVE_AUTH_FAILURE', message: 'SESSION_EXPIRED', definitive: true });
    }
    const dialogs = await client.getDialogs({ limit });
    return res.json({
      ok: true,
      dialogs: dialogs.map(d => ({
        id: String(d.id),
        title: d.title || d.name || 'Без названия',
        is_group: Boolean(d.isGroup),
        is_channel: Boolean(d.isChannel),
        is_user: Boolean(d.isUser),
      })),
    });
  } catch (err) {
    return errorResponse(res, err);
  } finally {
    try { await client.disconnect(); } catch {}
  }
});

app.post('/account/check', checkKey, async (req, res) => {
  const session = String(req.body?.session || '');
  if (!session) return res.status(400).json({ ok: false, code: 'SESSION_REQUIRED' });
  const client = makeClient(session);
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      return res.status(401).json({ ok: false, code: 'DEFINITIVE_AUTH_FAILURE', message: 'SESSION_EXPIRED', definitive: true });
    }
    const me = await client.getMe();
    return res.json({ ok: true, account: safeAccount(me) });
  } catch (err) {
    return errorResponse(res, err);
  } finally {
    try { await client.disconnect(); } catch {}
  }
});

app.post('/send', checkKey, async (req, res) => {
  const session = String(req.body?.session || '');
  const chatId = String(req.body?.chatId || '');
  const text = String(req.body?.text || '');
  if (!session || !chatId || !text) return res.status(400).json({ ok: false, code: 'SESSION_CHAT_TEXT_REQUIRED' });

  const client = makeClient(session);
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      return res.status(401).json({ ok: false, code: 'DEFINITIVE_AUTH_FAILURE', message: 'SESSION_EXPIRED', definitive: true });
    }
    const dialogs = await client.getDialogs({ limit: 200 });
    const entity = findDialogEntity(dialogs, chatId) || await client.getEntity(BigInt(chatId));
    const message = await client.sendMessage(entity, { message: text });
    return res.json({ ok: true, message_id: message.id });
  } catch (err) {
    return errorResponse(res, err);
  } finally {
    try { await client.disconnect(); } catch {}
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Userbot service started on port ${PORT}`));
