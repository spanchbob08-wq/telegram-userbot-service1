import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 10000);
const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = String(process.env.TELEGRAM_API_HASH || '');
const SERVICE_KEY = String(process.env.SERVICE_KEY || '');

if (!API_ID || !API_HASH || !SERVICE_KEY) {
  throw new Error('Проверь TELEGRAM_API_ID, TELEGRAM_API_HASH и SERVICE_KEY');
}

const auths = new Map();

function checkKey(req, res, next) {
  if (req.headers['x-service-key'] !== SERVICE_KEY) {
    return res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED'
    });
  }

  next();
}

function makeClient(session = '') {
  return new TelegramClient(
    new StringSession(session),
    API_ID,
    API_HASH,
    {
      connectionRetries: 5,
      useWSS: true
    }
  );
}

function getError(err) {
  return err?.errorMessage || err?.message || String(err);
}

async function cleanupAuth(authId) {
  const state = auths.get(authId);

  if (!state) return;

  try {
    await state.client?.disconnect();
  } catch {}

  auths.delete(authId);
}


/* =========================
   HEALTH
========================= */

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'telegram-userbot-service'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});


/* =========================
   TELEGRAM CHECK
========================= */

app.get('/telegram-check', checkKey, async (req, res) => {
  const client = makeClient();

  try {
    await client.connect();

    res.json({
      ok: true,
      connected: true
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      connected: false,
      error: getError(err)
    });
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
});


/* =========================
   НАЧАТЬ QR-АВТОРИЗАЦИЮ
========================= */

app.post('/auth/qr/start', checkKey, async (req, res) => {
  const userId = String(req.body.userId || '');

  if (!userId) {
    return res.status(400).json({
      ok: false,
      error: 'USER_ID_REQUIRED'
    });
  }

  const authId = crypto.randomUUID();

  const client = makeClient();

  const state = {
    authId,
    userId,
    client,

    status: 'starting',

    qrPng: null,
    qrLink: null,

    session: null,
    account: null,

    passwordResolve: null,

    createdAt: Date.now(),
    error: null
  };

  auths.set(authId, state);

  try {
    await client.connect();
  } catch (err) {
    await cleanupAuth(authId);

    return res.status(500).json({
      ok: false,
      error: getError(err)
    });
  }


  /*
    Авторизация работает в фоне.
  */
  client.signInUserWithQrCode(
    {
      apiId: API_ID,
      apiHash: API_HASH
    },
    {
      qrCode: async (code) => {
        const link =
          `tg://login?token=${code.token.toString('base64url')}`;

        state.qrLink = link;

        state.qrPng = await QRCode.toBuffer(
          link,
          {
            type: 'png',
            width: 420,
            margin: 2
          }
        );

        state.status = 'waiting_scan';
      },

      password: async () => {
        state.status = 'password_required';

        return new Promise((resolve, reject) => {
          state.passwordResolve = resolve;

          setTimeout(() => {
            reject(new Error('2FA_TIMEOUT'));
          }, 5 * 60 * 1000);
        });
      },

      onError: async (err) => {
        state.error = getError(err);

        console.error(
          'QR auth:',
          state.error
        );

        return true;
      }
    }
  )
  .then(async (user) => {
    state.session =
      client.session.save();

    state.account = {
      id: String(user.id),
      username: user.username || null,
      first_name: user.firstName || ''
    };

    state.status = 'authorized';

    state.passwordResolve = null;
  })
  .catch((err) => {
    state.error = getError(err);
    state.status = 'error';
  });


  /*
    Даём GramJS немного времени
    создать первый QR.
  */
  for (let i = 0; i < 50; i++) {
    if (
      state.qrPng ||
      state.status === 'error'
    ) break;

    await new Promise(
      resolve => setTimeout(resolve, 100)
    );
  }


  if (state.status === 'error') {
    return res.status(500).json({
      ok: false,
      error: state.error
    });
  }


  res.json({
    ok: true,

    auth_id: authId,

    status: state.status,

    qr_url:
      `${req.protocol}://${req.get('host')}/auth/qr/image/${authId}`
  });


  /*
    Через 10 минут незавершённую
    авторизацию удаляем.
  */
  setTimeout(async () => {
    const current = auths.get(authId);

    if (
      current &&
      current.status !== 'authorized'
    ) {
      await cleanupAuth(authId);
    }
  }, 10 * 60 * 1000);
});


/* =========================
   QR-КАРТИНКА
========================= */

app.get('/auth/qr/image/:authId', async (req, res) => {
  const state =
    auths.get(req.params.authId);

  if (!state?.qrPng) {
    return res.status(404).send(
      'QR not found or expired'
    );
  }

  res.setHeader(
    'Content-Type',
    'image/png'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  res.send(state.qrPng);
});


/* =========================
   СТАТУС QR
========================= */

app.get(
  '/auth/qr/status/:authId',
  checkKey,
  async (req, res) => {
    const state =
      auths.get(req.params.authId);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: 'AUTH_NOT_FOUND'
      });
    }

    res.json({
      ok: true,

      status: state.status,

      account: state.account,

      error: state.error
    });
  }
);


/* =========================
   2FA

   Пароль нигде не сохраняется.
   Он только передаётся ожидающему
   GramJS promise.
========================= */

app.post(
  '/auth/qr/password',
  checkKey,
  async (req, res) => {
    const authId =
      String(req.body.authId || '');

    const password =
      String(req.body.password || '');

    const state =
      auths.get(authId);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: 'AUTH_NOT_FOUND'
      });
    }

    if (
      state.status !== 'password_required' ||
      !state.passwordResolve
    ) {
      return res.status(400).json({
        ok: false,
        error: 'PASSWORD_NOT_REQUIRED'
      });
    }

    const resolve =
      state.passwordResolve;

    state.passwordResolve = null;
    state.status = 'authorizing';

    resolve(password);

    res.json({
      ok: true
    });
  }
);


/* =========================
   ЗАБРАТЬ ГОТОВУЮ SESSION

   Позже её будет забирать
   Cloudflare и хранить
   зашифрованно в D1.
========================= */

app.post(
  '/auth/qr/consume',
  checkKey,
  async (req, res) => {
    const authId =
      String(req.body.authId || '');

    const state =
      auths.get(authId);

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: 'AUTH_NOT_FOUND'
      });
    }

    if (
      state.status !== 'authorized' ||
      !state.session
    ) {
      return res.status(400).json({
        ok: false,
        error: 'NOT_AUTHORIZED_YET'
      });
    }

    const result = {
      ok: true,

      session: state.session,

      account: state.account
    };

    await cleanupAuth(authId);

    res.json(result);
  }
);


/* =========================
   ПОЛУЧИТЬ ЧАТЫ
========================= */

app.post(
  '/dialogs',
  checkKey,
  async (req, res) => {
    const session =
      String(req.body.session || '');

    if (!session) {
      return res.status(400).json({
        ok: false,
        error: 'SESSION_REQUIRED'
      });
    }

    const client =
      makeClient(session);

    try {
      await client.connect();

      if (
        !(await client.checkAuthorization())
      ) {
        return res.status(401).json({
          ok: false,
          error: 'SESSION_EXPIRED'
        });
      }

      const dialogs =
        await client.getDialogs({
          limit: 100
        });

      res.json({
        ok: true,

        dialogs:
          dialogs.map(d => ({
            id: String(d.id),

            title:
              d.title ||
              d.name ||
              'Без названия',

            is_group:
              Boolean(d.isGroup),

            is_channel:
              Boolean(d.isChannel),

            is_user:
              Boolean(d.isUser)
          }))
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error: getError(err)
      });

    } finally {
      try {
        await client.disconnect();
      } catch {}
    }
  }
);


/* =========================
   ОТПРАВКА ОТ ЛИЦА
========================= */

app.post(
  '/send',
  checkKey,
  async (req, res) => {
    const session =
      String(req.body.session || '');

    const chatId =
      String(req.body.chatId || '');

    const text =
      String(req.body.text || '');

    if (
      !session ||
      !chatId ||
      !text
    ) {
      return res.status(400).json({
        ok: false,
        error:
          'SESSION_CHAT_TEXT_REQUIRED'
      });
    }

    const client =
      makeClient(session);

    try {
      await client.connect();

      if (
        !(await client.checkAuthorization())
      ) {
        return res.status(401).json({
          ok: false,
          error: 'SESSION_EXPIRED'
        });
      }

      const entity =
        await client.getEntity(
          BigInt(chatId)
        );

      const message =
        await client.sendMessage(
          entity,
          {
            message: text
          }
        );

      res.json({
        ok: true,
        message_id: message.id
      });

    } catch (err) {
      const message =
        getError(err);

      /*
        FLOOD_WAIT не обходим.
      */
      if (
        message.includes('FLOOD_WAIT')
      ) {
        return res.status(429).json({
          ok: false,
          error: message
        });
      }

      res.status(500).json({
        ok: false,
        error: message
      });

    } finally {
      try {
        await client.disconnect();
      } catch {}
    }
  }
);


app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Userbot service started on port ${PORT}`
    );
  }
);