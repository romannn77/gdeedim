import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, initSchema, demo, close } from '../lib/db.mjs';
import { billingMigration } from '../lib/billing.mjs';
import { hashPassword, digest, audit } from '../lib/security.mjs';
import { importCatalog } from '../lib/catalog.mjs';
async function migrate() {
  await initSchema();
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7012400)');
    await tx.query('CREATE TABLE IF NOT EXISTS migrations(version text PRIMARY KEY)');
    const folder = new URL('../migrations/', import.meta.url);
    const steps = [
      ...(await readdir(folder)).filter((name) => name.endsWith('.sql')),
      '002-billing',
    ].sort();
    for (const file of steps) {
      const version = file.replace(/\.sql$/, '');
      if (!(await tx.query('SELECT 1 FROM migrations WHERE version=$1', [version])).rowCount) {
        const sql =
          file === '002-billing' ? billingMigration : await readFile(new URL(file, folder), 'utf8');
        await tx.query(sql);
        await tx.query('INSERT INTO migrations VALUES($1)', [version]);
      }
    }
  });
}
const [cmd, arg, capacity] = process.argv.slice(2);
async function credentials(email, role, venue = null) {
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw Error('Укажите почту пользователя.');
  const password = randomBytes(18).toString('base64url');
  await db.transaction(async (tx) => {
    if (role === 'admin') {
      await tx.query('SELECT pg_advisory_xact_lock(7012402)');
      if ((await tx.query("SELECT 1 FROM users WHERE role='admin'")).rowCount)
        throw Error('Первый администратор уже создан.');
    }
    if (
      !(
        await tx.query(
          'INSERT INTO users(id,email,password,role,venue_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [randomUUID(), email.toLowerCase(), await hashPassword(password), role, venue],
        )
      ).rowCount
    )
      throw Error('Этот адрес уже занят.');
    await audit(tx, 'Локальная консоль', 'Создан аккаунт ' + role, email);
  });
  console.log('Почта:', email, '\nСлучайный пароль (сохраните сейчас):', password);
}
async function main() {
  await migrate();
  const file = demo ? 'demo.json' : 'catalog.json';
  if (cmd === 'import' || cmd === 'setup') {
    if (cmd === 'setup' && (await db.query('SELECT 1 FROM imports LIMIT 1')).rowCount) return;
    console.log(
      'Загружено заведений:',
      await importCatalog(
        JSON.parse(await readFile(new URL('../data/' + file, import.meta.url), 'utf8')),
      ),
    );
  } else if (cmd === 'admin') await credentials(arg, 'admin');
  else if (cmd === 'demo') {
    if (!demo) throw Error('Учебный сотрудник доступен только при APP_MODE=demo.');
    await credentials(arg || 'partner@demo.local', 'partner', 'demo-bistro');
    await db.query(
      `INSERT INTO offers(id,venue_id,title,terms,code,starts,ends,max_uses,state)
     VALUES ('demo-dessert','demo-bistro','Учебный десерт к обеду','Пример для школьного показа. Один код на аккаунт.','УЧЕБНЫЙ-ДЕСЕРТ',$1,$2,1000,'approved')
     ON CONFLICT DO NOTHING`,
      [Date.now(), Date.now() + 30 * 86400000],
    );
  } else if (cmd === 'counter') {
    if (
      !arg ||
      !Number.isSafeInteger(Number(capacity)) ||
      Number(capacity) < 1 ||
      Number(capacity) > 100000
    )
      throw Error('Укажите ID заведения и подтверждённую вместимость.');
    const secret = randomBytes(32).toString('hex');
    await db.transaction(async (tx) => {
      const r = await tx.query(
        "UPDATE venues SET capacity=$1,counter_hash=$2,people=NULL,measured_at=NULL WHERE id=$3 AND visibility='visible' AND EXISTS(SELECT 1 FROM users WHERE venue_id=$3 AND role='partner')",
        [Number(capacity), digest(secret), arg],
      );
      if (!r.rowCount) throw Error('Нет активного заведения с утверждённым сотрудником.');
      await audit(tx, 'Локальная консоль', 'Настроен счётчик', arg);
    });
    console.log('Одноразовый вывод ключа для авторизованного устройства:', secret);
  } else if (cmd === 'revoke-counter') {
    await db.transaction(async (tx) => {
      await tx.query(
        'UPDATE venues SET capacity=NULL,counter_hash=NULL,people=NULL,measured_at=NULL WHERE id=$1',
        [arg],
      );
      await audit(tx, 'Локальная консоль', 'Отключён счётчик', arg);
    });
  } else throw Error('Неизвестная команда.');
}
try {
  await main();
} catch (error) {
  console.error(error.code ? 'Ошибка базы данных. Проверьте настройки и доступ.' : error.message);
  process.exitCode = 1;
} finally {
  await close();
}
