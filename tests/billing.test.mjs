import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { billing, billingMigration, entitled } from '../lib/billing.mjs';

test('Подписка требует входа и явного согласия', async () => {
  await assert.rejects(billing(null, 'trial', {}), { status: 401 });
  await assert.rejects(billing(null, 'create', { userId: 'гость', body: { consent: 'true' } }), {
    status: 400,
  });
});

const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
test(
  'ЮKassa: пробный период, конкурирующие запросы, проверка статуса, истечение и изоляция тестового магазина',
  {
    skip:
      !connectionString &&
      !process.env.PGHOST &&
      'Нужна отдельная тестовая база PostgreSQL в переменной TEST_DATABASE_URL.',
  },
  async (t) => {
    const schema = 'billing_test_' + randomUUID().replaceAll('-', '');
    const root = new Pool({ connectionString, max: 1 });
    await root.query('CREATE SCHEMA ' + schema);
    const pool = new Pool({ connectionString, options: '-c search_path=' + schema });
    t.after(async () => {
      await pool.end();
      await root.query('DROP SCHEMA ' + schema + ' CASCADE');
      await root.end();
    });
    const db = {
      query: (...args) => pool.query(...args),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
    await db.query(billingMigration);

    const settings = {
      APP_MODE: 'demo',
      PUBLIC_BASE_URL: 'http://localhost:3000',
      YOOKASSA_SHOP_ID: '1234',
      YOOKASSA_SECRET_KEY: 'условный-ключ-для-автотеста',
      YOOKASSA_MODE: 'test',
      YOOKASSA_ENABLE_LIVE: 'false',
    };
    const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
    Object.assign(process.env, settings);
    t.after(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });

    const operations = new Map();
    const byId = new Map();
    let storeTest = true;
    let createCount = 0;
    let createError = false;
    let reads = 0;
    t.mock.method(globalThis, 'fetch', async (address, init) => {
      assert.ok(address.startsWith('https://api.yookassa.ru/v3/'));
      assert.ok(init.headers.Authorization.startsWith('Basic '));
      const path = new URL(address).pathname;
      if (path === '/v3/me')
        return Response.json({ account_id: '1234', status: 'enabled', test: storeTest });
      if (init.method === 'POST') {
        createCount++;
        if (createError) return Response.json({ type: 'error' }, { status: 400 });
        const key = init.headers['Idempotence-Key'];
        const request = JSON.parse(init.body);
        assert.equal(request.metadata.order_id, key);
        assert.deepEqual(request.amount, { value: '299.00', currency: 'RUB' });
        assert.ok(!('save_payment_method' in request));
        assert.ok(!('payment_method_id' in request));
        if (!operations.has(key)) {
          const id = randomUUID();
          const remote = {
            id,
            status: 'pending',
            paid: false,
            test: true,
            recipient: { account_id: '1234' },
            amount: request.amount,
            metadata: request.metadata,
            confirmation: { confirmation_url: 'https://yoomoney.ru/' + id },
          };
          operations.set(key, remote);
          byId.set(id, remote);
        }
        return Response.json(operations.get(key));
      }
      reads++;
      return Response.json(byId.get(path.split('/').pop()));
    });
    const call = (userId, action, body = {}) => billing(db, action, { userId, body });
    const notice = (remote) =>
      billing(db, 'notify', {
        body: {
          type: 'notification',
          event: 'payment.succeeded',
          object: { id: remote.id, status: 'succeeded', metadata: remote.metadata },
        },
      });
    const user = randomUUID();
    assert.equal(await entitled(db, user), false);
    const trials = await Promise.allSettled([
      call(user, 'trial', { consent: true }),
      call(user, 'trial', { consent: true }),
    ]);
    assert.equal(trials.filter((v) => v.status === 'fulfilled').length, 1);
    assert.equal(trials.find((v) => v.status === 'rejected').reason.status, 409);
    const trial = await call(user, 'summary');
    assert.equal(trial.kind, 'trial');
    assert.ok(Math.abs(trial.expiresAt - Date.now() - 14 * 86400000) < 60000);
    assert.equal(await entitled(db, user), true);
    await db.query('UPDATE billing_accounts SET trial_until=$1 WHERE user_id=$2', [
      Date.now() - 1,
      user,
    ]);
    assert.equal(await entitled(db, user), false);

    storeTest = false;
    await assert.rejects(call(user, 'create', { consent: true }), { status: 503 });
    assert.equal(createCount, 0);
    storeTest = true;
    const [order, retry] = await Promise.all([
      call(user, 'create', { consent: true }),
      call(user, 'create', { consent: true }),
    ]);
    assert.equal(order.id, retry.id);
    assert.equal(operations.size, 1);
    assert.ok(order.confirmationUrl.startsWith('https://'));
    const remote = operations.get(order.id);
    await notice(remote); // Тело входящего уведомления утверждает, что платёж завершён.
    assert.equal((await call(user, 'refresh')).active, false);
    assert.equal((await call('посторонний', 'summary')).lastPayment, null);
    remote.status = 'succeeded';
    remote.paid = true;
    remote.amount.value = '2.00';
    await assert.rejects(notice(remote), { status: 502 });
    assert.equal(await entitled(db, user), false);
    remote.amount.value = '299.00';
    await Promise.all([notice(remote), notice(remote), call(user, 'refresh')]);
    const paid = await call(user, 'summary');
    assert.equal(paid.kind, 'paid');
    assert.ok(paid.expiresAt - Date.now() <= 31 * 86400000);
    assert.ok(paid.expiresAt - Date.now() >= 27 * 86400000);
    await notice(remote);
    assert.equal((await call(user, 'cancel')).expiresAt, paid.expiresAt);
    assert.equal((await call(user, 'summary')).autoRenew, false);
    assert.equal(await entitled(db, user), true);
    assert.ok(reads >= 3);
    await assert.rejects(call(user, 'create', { consent: true }), { status: 409 });
    process.env.APP_MODE = 'production';
    assert.equal(await entitled(db, user), false);
    await assert.rejects(call('посторонний', 'create', { consent: true }), { status: 503 });
    process.env.APP_MODE = 'demo';

    createError = true;
    const other = randomUUID();
    await assert.rejects(call(other, 'create', { consent: true }), { status: 502 });
    assert.equal((await call(other, 'summary')).lastPayment.status, 'failed');
    createError = false;
    const later = await call(other, 'create', { consent: true });
    const canceled = operations.get(later.id);
    canceled.status = 'canceled';
    assert.equal((await call(other, 'refresh')).lastPayment.status, 'canceled');
    assert.equal(await entitled(db, other), false);
    await db.query('UPDATE billing_accounts SET test_paid_until=$1 WHERE user_id=$2', [
      Date.now() - 1,
      user,
    ]);
    assert.equal(await entitled(db, user), false);
  },
);
