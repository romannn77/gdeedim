import { randomUUID } from 'node:crypto';

const day = 86_400_000;
const amount = { value: '299.00', currency: 'RUB' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const billingMigration = `
CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id TEXT PRIMARY KEY,
  trial_started_at BIGINT,
  trial_until BIGINT,
  paid_until BIGINT,
  test_paid_until BIGINT,
  renewal_canceled_at BIGINT
);
CREATE TABLE IF NOT EXISTS billing_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES billing_accounts(user_id),
  provider_id TEXT UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')),
  shop_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating','pending','succeeded','canceled','failed')),
  consent_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  return_url TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_open_order
  ON billing_payments (user_id, mode, shop_id) WHERE status IN ('creating','pending');
CREATE INDEX IF NOT EXISTS billing_history ON billing_payments (user_id, consent_at DESC);
`;

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function configuration() {
  const mode = process.env.YOOKASSA_MODE || 'test';
  const shopId = process.env.YOOKASSA_SHOP_ID || '';
  const secret = process.env.YOOKASSA_SECRET_KEY || '';
  const demo = process.env.APP_MODE === 'demo';
  let base;
  try {
    base = new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000');
  } catch {}
  const secure = base?.protocol === 'https:';
  const local =
    ['localhost', '127.0.0.1', '[::1]'].includes(base?.hostname) && base.protocol === 'http:';
  const modeAllowed =
    mode === 'test'
      ? demo && (secure || local)
      : mode === 'live' && !demo && secure && process.env.YOOKASSA_ENABLE_LIVE === 'true';
  return {
    mode,
    shopId,
    secret,
    demo,
    base,
    ready: Boolean(modeAllowed && /^\d+$/.test(shopId) && secret && !base.username && !base.password),
  };
}

function requireProvider(config) {
  if (!config.ready)
    throw failure(503, 'Оплата пока недоступна. Владелец сервиса должен настроить магазин ЮKassa.');
}

async function provider(config, path, options = {}) {
  const token = Buffer.from(config.shopId + ':' + config.secret).toString('base64');
  let response;
  try {
    response = await fetch('https://api.yookassa.ru/v3/' + path, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: 'Basic ' + token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (response.ok) return await response.json();
  } catch {
    throw failure(503, 'ЮKassa пока не ответила. Повторите проверку позже.');
  }
  const error = failure(
    502,
    'ЮKassa отклонила запрос. Проверьте настройки магазина или повторите позже.',
  );
  error.providerStatus = response.status;
  throw error;
}

async function one(db, sql, params) {
  return (await db.query(sql, params)).rows[0];
}

async function lockAccount(tx, userId) {
  await tx.query(
    'INSERT INTO billing_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [userId],
  );
  return one(tx, 'SELECT * FROM billing_accounts WHERE user_id=$1 FOR UPDATE', [userId]);
}

function paidUntil(account, config) {
  return Number(account?.[config.demo ? 'test_paid_until' : 'paid_until'] || 0);
}

function access(account, config, now = Date.now()) {
  const trial = Number(account?.trial_until || 0);
  const paid = paidUntil(account, config);
  const end = Math.max(trial, paid);
  return {
    active: end > now,
    expiresAt: end || null,
    trialUsed: account?.trial_started_at != null,
    kind: end <= now ? null : paid > trial ? 'paid' : 'trial',
  };
}

export async function entitled(db, userId) {
  if (!userId) return false;
  const account = await one(db, 'SELECT * FROM billing_accounts WHERE user_id=$1', [userId]);
  return access(account, configuration()).active;
}

async function summary(db, userId, config) {
  const account = await one(db, 'SELECT * FROM billing_accounts WHERE user_id=$1', [userId]);
  const last = await one(
    db,
    'SELECT id,status,consent_at FROM billing_payments WHERE user_id=$1 AND mode=$2 ORDER BY consent_at DESC LIMIT 1',
    [userId, config.mode],
  );
  return {
    ...access(account, config),
    autoRenew: false,
    paymentMode: config.mode,
    paymentsConfigured: config.ready,
    lastPayment: last ? { id: last.id, status: last.status, createdAt: Number(last.consent_at) } : null,
  };
}

// Продление до той же даты следующего месяца, включая короткий февраль.
function addMonth(timestamp) {
  const date = new Date(timestamp);
  const first = new Date(timestamp);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() + 1);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  first.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()));
  return first.getTime();
}

function validatePayment(order, remote) {
  const valid =
    uuid.test(remote?.id) &&
    (!order.provider_id || remote.id === order.provider_id) &&
    remote.metadata?.order_id === order.id &&
    remote.recipient?.account_id === order.shop_id &&
    remote.test === (order.mode === 'test') &&
    remote.amount?.value === amount.value &&
    remote.amount.currency === amount.currency &&
    ['pending', 'succeeded', 'canceled'].includes(remote.status) &&
    (remote.status !== 'succeeded' || remote.paid === true);
  if (!valid) throw failure(502, 'Не удалось подтвердить параметры платежа в ЮKassa.');
}

async function applyVerified(db, order, remote) {
  validatePayment(order, remote);
  return db.transaction(async (tx) => {
    const account = await lockAccount(tx, order.user_id);
    const current = await one(tx, 'SELECT * FROM billing_payments WHERE id=$1 FOR UPDATE', [order.id]);
    validatePayment(current, remote);
    if (['succeeded', 'canceled', 'failed'].includes(current.status)) return current.status;
    const now = Date.now();
    if (remote.status === 'succeeded') {
      const column = order.mode === 'test' ? 'test_paid_until' : 'paid_until';
      const end = addMonth(
        Math.max(Number(account.trial_until || 0), Number(account[column] || 0), now),
      );
      await tx.query('UPDATE billing_accounts SET ' + column + '=$1 WHERE user_id=$2', [
        end,
        order.user_id,
      ]);
    }
    await tx.query('UPDATE billing_payments SET status=$1,provider_id=$2,updated_at=$3 WHERE id=$4', [
      remote.status,
      remote.id,
      now,
      order.id,
    ]);
    return remote.status;
  });
}

async function reserveOrder(db, userId, config) {
  return db.transaction(async (tx) => {
    const account = await lockAccount(tx, userId);
    const now = Date.now();
    if (paidUntil(account, config) > now)
      throw failure(409, 'Этот месяц уже оплачен. Следующая оплата доступна после окончания периода.');
    const existing = await one(
      tx,
      "SELECT * FROM billing_payments WHERE user_id=$1 AND mode=$2 AND shop_id=$3 AND status IN ('creating','pending')",
      [userId, config.mode, config.shopId],
    );
    if (existing) return existing;
    const id = randomUUID();
    const returnUrl = new URL('/?payment=return', config.base).href;
    return one(
      tx,
      `INSERT INTO billing_payments (id,user_id,mode,shop_id,status,consent_at,updated_at,return_url)
      VALUES ($1,$2,$3,$4,'creating',$5,$5,$6) RETURNING *`,
      [id, userId, config.mode, config.shopId, now, returnUrl],
    );
  });
}

async function createPayment(db, userId, config) {
  requireProvider(config);
  const shop = await provider(config, 'me');
  if (
    shop.account_id !== config.shopId ||
    shop.test !== (config.mode === 'test') ||
    shop.status !== 'enabled'
  ) {
    throw failure(503, 'Настройки магазина ЮKassa не соответствуют выбранному режиму оплаты.');
  }
  const order = await reserveOrder(db, userId, config);
  let remote;
  if (order.provider_id) {
    remote = await provider(config, 'payments/' + order.provider_id);
  } else {
    // ЮKassa хранит ключ 24 часа. После этого продолжать старый POST небезопасно.
    if (Date.now() - Number(order.consent_at) > 23.9 * 3_600_000) {
      throw failure(
        409,
        'Предыдущий запрос ожидает сверки с магазином. Сообщите администратору номер заказа ' +
          order.id +
          '.',
      );
    }
    try {
      remote = await provider(config, 'payments', {
        method: 'POST',
        headers: { 'Idempotence-Key': order.id },
        body: JSON.stringify({
          amount,
          capture: true,
          confirmation: { type: 'redirect', return_url: order.return_url },
          description: 'ГдеЕдим? Плюс · один месяц',
          metadata: { order_id: order.id },
        }),
      });
    } catch (error) {
      // HTTP 500 и обрыв сети оставляют результат неизвестным. Храним ключ для повтора.
      if ([400, 403, 422].includes(error.providerStatus)) {
        await db.query(
          "UPDATE billing_payments SET status='failed',updated_at=$1 WHERE id=$2 AND status='creating'",
          [Date.now(), order.id],
        );
      }
      throw error;
    }
    validatePayment(order, remote);
    if (remote.status !== 'pending') {
      remote = await provider(config, 'payments/' + remote.id);
    }
  }
  const status = await applyVerified(db, order, remote);
  let confirmationUrl = null;
  if (status === 'pending') {
    try {
      const url = new URL(remote.confirmation?.confirmation_url);
      if (url.protocol === 'https:') confirmationUrl = url.href;
    } catch {}
    if (!confirmationUrl)
      throw failure(502, 'ЮKassa пока не выдала ссылку для оплаты. Повторите проверку позже.');
  }
  return { id: order.id, status, confirmationUrl };
}

async function notify(db, body, config) {
  if (
    body?.type !== 'notification' ||
    !['payment.succeeded', 'payment.canceled'].includes(body.event) ||
    !uuid.test(body.object?.id)
  ) {
    throw failure(400, 'Неподдерживаемое уведомление ЮKassa.');
  }
  // metadata позволяет восстановиться после сбоя между созданием платежа у провайдера и записью его ID.
  const order = await one(
    db,
    'SELECT * FROM billing_payments WHERE provider_id=$1 OR (provider_id IS NULL AND id=$2)',
    [body.object.id, uuid.test(body.object.metadata?.order_id) ? body.object.metadata.order_id : ''],
  );
  if (!order || order.mode !== config.mode || order.shop_id !== config.shopId) return { ok: true };
  requireProvider(config);
  const remote = await provider(config, 'payments/' + body.object.id);
  if (remote.id !== body.object.id) throw failure(502, 'ЮKassa вернула другой номер платежа.');
  await applyVerified(db, order, remote);
  return { ok: true };
}

export async function billing(db, action, { userId, body = {} } = {}) {
  const config = configuration();
  if (action === 'notify') return notify(db, body, config);
  if (!userId) throw failure(401, 'Войдите в аккаунт, чтобы управлять подпиской.');
  if (action === 'create' || action === 'trial') {
    if (body?.consent !== true) throw failure(400, 'Подтвердите согласие с условиями подписки.');
  }
  switch (action) {
    case 'summary':
      break;
    case 'trial':
      await db.transaction(async (tx) => {
        const account = await lockAccount(tx, userId);
        if (account.trial_started_at != null || paidUntil(account, config) > Date.now()) {
          throw failure(409, 'Пробный период для этого аккаунта уже недоступен.');
        }
        const now = Date.now();
        await tx.query(
          'UPDATE billing_accounts SET trial_started_at=$1, trial_until=$2 WHERE user_id=$3',
          [now, now + 14 * day, userId],
        );
      });
      break;
    case 'create':
      return createPayment(db, userId, config);
    case 'refresh': {
      const order = await one(
        db,
        "SELECT * FROM billing_payments WHERE user_id=$1 AND mode=$2 AND shop_id=$3 AND status IN ('creating','pending') ORDER BY consent_at DESC LIMIT 1",
        [userId, config.mode, config.shopId],
      );
      if (order?.provider_id) {
        requireProvider(config);
        await applyVerified(db, order, await provider(config, 'payments/' + order.provider_id));
      }
      break;
    }
    case 'cancel':
      await db.query(
        `INSERT INTO billing_accounts (user_id,renewal_canceled_at) VALUES ($1,$2)
        ON CONFLICT (user_id) DO UPDATE SET renewal_canceled_at=excluded.renewal_canceled_at`,
        [userId, Date.now()],
      );
      break;
    default:
      throw failure(404, 'Действие с подпиской не найдено.');
  }
  return summary(db, userId, config);
}
