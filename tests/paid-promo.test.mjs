import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { temporaryDb } from './temporary-db.mjs';

test('Пробный период → подтверждённый тестовый платёж → защищённый промокод', async (t) => {
  const temp = await temporaryDb('demo');
  Object.assign(process.env, temp.env, {
    YOOKASSA_MODE: 'test',
    YOOKASSA_SHOP_ID: '1234',
    YOOKASSA_SECRET_KEY: 'учебная-подмена',
    PUBLIC_BASE_URL: 'http://localhost:3000',
  });
  temp.run('demo');
  const { db, close } = await import('../lib/db.mjs');
  t.after(async () => {
    await close();
    await temp.close();
  });
  const { dispatch } = await import('../lib/actions.mjs');
  const { token } = await dispatch('register', {
    body: { email: 'reader@test.local', password: randomUUID() },
  });
  const call = (path, body = {}) => dispatch(path, { token, body });
  const { user } = await call('me');
  await call('billing/trial', { consent: true });
  await db.query('UPDATE billing_accounts SET trial_until=$1 WHERE user_id=$2', [
    Date.now() - 1000,
    user.id,
  ]);
  let payment;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(url.startsWith('https://api.yookassa.ru/v3/'));
    if (url.endsWith('/me'))
      return Response.json({ account_id: '1234', test: true, status: 'enabled' });
    if (init.method === 'POST') {
      const input = JSON.parse(init.body);
      payment = {
        id: randomUUID(),
        recipient: { account_id: '1234' },
        metadata: input.metadata,
        amount: input.amount,
        test: true,
        status: 'pending',
        paid: false,
        confirmation: { confirmation_url: 'https://yoomoney.ru/test' },
      };
    }
    return Response.json(payment);
  });
  await call('billing/create', { consent: true });
  await assert.rejects(call('redeem', { id: 'demo-dessert' }), { status: 403 });
  payment.status = 'succeeded';
  payment.paid = true;
  await dispatch('billing/notify', {
    body: { type: 'notification', event: 'payment.succeeded', object: { id: payment.id } },
  });
  assert.equal((await call('billing/summary')).kind, 'paid');
  assert.equal((await call('redeem', { id: 'demo-dessert' })).code, 'УЧЕБНЫЙ-ДЕСЕРТ');
});
