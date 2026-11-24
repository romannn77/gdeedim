import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
// Имена создаются здесь. Команды очистки получают только имя только что созданной базы.
export async function temporaryDb(mode = 'catalog') {
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const root = new pg.Pool({ connectionString, max: 1 });
  const name = 'guide_test_' + randomUUID().replaceAll('-', '');
  await root.query('CREATE DATABASE ' + name);
  const env = { ...process.env, APP_MODE: mode, PGDATABASE: name };
  if (connectionString) {
    const url = new URL(connectionString);
    url.pathname = '/' + name;
    env.DATABASE_URL = url.href;
  }
  const run = (...args) =>
    execFileSync(process.execPath, ['scripts/manage.mjs', ...args], { env, encoding: 'utf8' });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      await root.query('DROP DATABASE ' + name + ' WITH (FORCE)');
    } finally {
      await root.end();
    }
  }
  try {
    run('setup');
  } catch (e) {
    await close();
    throw e;
  }
  return { env, run, close };
}
