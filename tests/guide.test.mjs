import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { temporaryDb } from './temporary-db.mjs';

test('Каталог, доступ сотрудника, срок статуса, счётчик, модерация и избранное', async (t) => {
  const temp = await temporaryDb();
  Object.assign(process.env, temp.env);
  const { db, close } = await import('../lib/db.mjs');
  t.after(async () => {
    await close();
    await temp.close();
  });
  const { dispatch } = await import('../lib/actions.mjs');
  const { importCatalog } = await import('../lib/catalog.mjs');
  const call = (path, token, body = {}) => dispatch(path, { token, body });
  const source = JSON.parse(await readFile('data/catalog.json', 'utf8'));
  let c = await call('catalog');
  assert.equal(c.venues.length, source.count);
  assert.ok(c.venues.every((v) => !v.partner && !v.status && v.occupancy === null));
  const [a, b] = c.venues;
  const password = randomUUID();
  const employee = (await call('register', null, { email: 'worker@test.local', password })).token;
  const guest = (await call('register', null, { email: 'guest@test.local', password })).token;
  await assert.rejects(call('admin/workspace'), { status: 401 });
  await assert.rejects(call('admin/workspace', guest), { status: 403 });
  await assert.rejects(call('partner/availability', employee, { venueId: a.id, status: 'free' }), {
    status: 403,
  });
  const adminInfo = temp.run('admin', 'admin@test.local');
  const admin = (
    await call('login', null, {
      email: 'admin@test.local',
      password: adminInfo.trim().split(/\s+/).at(-1),
    })
  ).token;
  const { user } = await call('me', employee);
  await call('apply', employee, { venueId: a.id });
  await call('admin/assign', admin, { userId: user.id, venueId: a.id });
  await assert.rejects(call('partner/availability', employee, { venueId: b.id, status: 'free' }), {
    status: 403,
  });
  await call('partner/availability', employee, { venueId: a.id, status: 'few', party: 3 });
  let v = (await call('catalog')).venues.find((v) => v.id === a.id);
  assert.equal(v.status, 'few');
  assert.equal(v.party, 3);
  assert.ok(v.updatedAt);
  await db.query('UPDATE venues SET updated_at=$1 WHERE id=$2', [Date.now() - 31 * 60000, a.id]);
  v = (await call('catalog')).venues.find((v) => v.id === a.id);
  assert.equal(v.status, null);
  assert.equal(v.party, null);
  assert.ok(v.updatedAt);
  const secret = temp.run('counter', a.id, '30').trim().split(/\s+/).at(-1);
  const counter = (body) => dispatch('counter', { body, authorization: 'Bearer ' + secret });
  await counter({ people: 18, timestamp: Date.now() - 2000 });
  await assert.rejects(counter({ people: 31, timestamp: Date.now() }), { status: 400 });
  await assert.rejects(counter({ people: 18, timestamp: Date.now() - 31 * 60000 }), { status: 400 });
  await assert.rejects(counter({ people: 18, timestamp: Date.now() - 3000 }), { status: 409 });
  await assert.rejects(counter({ people: 18, timestamp: Date.now(), extra: 'лишнее' }), {
    status: 400,
  });
  v = (await call('catalog')).venues.find((v) => v.id === a.id);
  assert.equal(v.occupancy, 60);
  assert.equal(v.status, null);
  await call('favorite', guest, { venueId: a.id, saved: true });
  assert.deepEqual((await call('me', guest)).favorites, [a.id]);
  await call('favorite', guest, { venueId: a.id, saved: false });
  assert.deepEqual((await call('me', guest)).favorites, []);
  const offer = {
    venueId: a.id,
    title: 'Учебное предложение',
    terms: 'По предъявлении',
    code: 'КОД-ТЕСТ',
    starts: Date.now() - 1000,
    ends: Date.now() + 86400000,
    maxUses: 1,
  };
  await call('partner/offer', employee, offer);
  const {
    offers: [o],
  } = await call('partner/workspace', employee);
  assert.equal((await call('catalog')).venues.flatMap((v) => v.offers).length, 0);
  await call('admin/moderate', admin, { id: o.id, state: 'approved' });
  c = await call('catalog');
  assert.equal(c.venues.flatMap((v) => v.offers).length, 1);
  assert.equal(JSON.stringify(c).includes(offer.code), false);
  await assert.rejects(call('redeem', guest, { id: o.id }), { status: 403 });
  await call('billing/trial', guest, { consent: true });
  const receipt = await call('redeem', guest, { id: o.id });
  assert.equal(receipt.code, offer.code);
  assert.equal((await call('my-codes', guest)).codes[0].ticket, receipt.ticket);
  await assert.rejects(call('partner/confirm', employee, { venueId: b.id, ticket: receipt.ticket }), {
    status: 403,
  });
  await call('partner/confirm', employee, { ticket: receipt.ticket });
  await assert.rejects(call('partner/confirm', employee, { ticket: receipt.ticket }), { status: 409 });
  assert.equal((await call('partner/workspace', employee)).offers[0].confirmed, '1');
  await call('redeem', guest, { id: o.id });
  assert.equal((await call('partner/workspace', employee)).offers[0].uses, '1');
  await call('billing/trial', employee, { consent: true });
  await assert.rejects(call('redeem', employee, { id: o.id }), { status: 409 });
  await importCatalog({
    ...source,
    review: [{ issue: 'missing', ids: [a.id], note: 'Проверка происхождения' }],
  });
  const queue = (await call('admin/workspace', admin)).reviews;
  assert.equal(queue.length, 1);
  await call('admin/resolve', admin, { key: queue[0].key, resolution: 'Сверено с источником' });
  await call('admin/venue', admin, { id: b.id, visibility: 'duplicate', duplicateOf: a.id });
  await importCatalog(source);
  assert.ok(!(await call('catalog')).venues.some((v) => v.id === b.id));
  await call('admin/assign', admin, { userId: user.id, venueId: null });
  await assert.rejects(call('partner/workspace', employee), { status: 403 });
});
