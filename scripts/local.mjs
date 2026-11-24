// Локальный запуск с отдельной базой, без изменения системной службы PostgreSQL.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { once } from 'node:events';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2),
  demo = args.includes('--demo');
const command = args.filter((a) => a !== '--demo');
const port = demo ? 3001 : 3000,
  dbPort = demo ? 55441 : 55440;
const local = resolve('.local', demo ? 'native-demo' : 'native');
const data = join(local, 'postgres');
const env = {
  ...process.env,
  APP_MODE: demo ? 'demo' : 'catalog',
  PUBLIC_BASE_URL: 'http://localhost:' + port,
  NEXT_TELEMETRY_DISABLED: '1',
};
const win = process.platform === 'win32';
const exe = (name) => name + (win ? '.exe' : '');
function pgBin() {
  if (process.env.GDE_POSTGRES_BIN) return process.env.GDE_POSTGRES_BIN;
  const root = join(process.env.ProgramFiles || 'C:/Program Files', 'PostgreSQL');
  if (win && existsSync(root)) {
    const available = readdirSync(root).sort((a, b) => Number(b) - Number(a));
    for (const version of available) {
      const folder = join(root, version, 'bin');
      if (existsSync(join(folder, 'initdb.exe'))) return folder;
    }
  }
  return '';
}
function run(file, params, options = {}) {
  const result = spawnSync(file, params, { env, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error || result.status !== 0)
    throw Error('Не удалось выполнить ' + file + '. Проверьте сообщения выше.');
}
let postgres, app;
function stop() {
  if (app && app.exitCode === null) app.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
async function main() {
  if (!existsSync('node_modules/next/package.json'))
    run(win ? 'npm.cmd' : 'npm', ['ci'], { shell: win });
  const { Client } = await import('pg');
  const bin = pgBin(),
    tool = (name) => (bin ? join(bin, exe(name)) : exe(name));
  if (spawnSync(tool('initdb'), ['--version'], { windowsHide: true }).status !== 0)
    throw Error('Установите PostgreSQL 17 или укажите путь к его папке bin в GDE_POSTGRES_BIN.');
  mkdirSync(local, { recursive: true });
  const pw = join(local, 'password');
  if (!existsSync(pw)) writeFileSync(pw, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const password = readFileSync(pw, 'utf8').trim();
  env.DATABASE_URL =
    'postgresql://guide:' + encodeURIComponent(password) + '@127.0.0.1:' + dbPort + '/postgres';
  if (!existsSync(join(data, 'PG_VERSION')))
    run(tool('initdb'), [
      '-D',
      data,
      '-U',
      'guide',
      '-A',
      'scram-sha-256',
      '--pwfile=' + pw,
      '--locale=C',
      '--encoding=UTF8',
    ]);
  async function ready() {
    const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 400 });
    try {
      await client.connect();
      const expected = readFileSync(join(data, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0];
      const actual = (
        await client.query("SELECT pg_read_file('postmaster.pid',0,$1) AS pid", [expected.length])
      ).rows[0].pid;
      if (actual !== expected) throw Error('Этот порт занимает другая база.');
      return true;
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === '57P03') return false;
      throw e;
    } finally {
      await client.end().catch(() => {});
    }
  }
  if (!(await ready())) {
    postgres = spawn(tool('postgres'), ['-D', data, '-p', String(dbPort), '-h', '127.0.0.1'], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    let ok = false;
    for (let i = 0; i < 80 && postgres.exitCode === null; i++) {
      if (await ready()) {
        ok = true;
        break;
      }
      await pause(200);
    }
    if (!ok) throw Error('Не удалось запустить локальную базу данных.');
  }
  run(process.execPath, ['scripts/manage.mjs', 'setup']);
  if (command[0] === 'test') {
    run(process.execPath, [
      '--test',
      '--test-concurrency=1',
      ...readdirSync('tests')
        .filter((name) => name.endsWith('.test.mjs'))
        .map((name) => join('tests', name)),
    ]);
    return;
  }
  if (command.length) {
    run(process.execPath, ['scripts/manage.mjs', ...command]);
    return;
  }
  if (!existsSync('.next/BUILD_ID'))
    run(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack']);
  console.log('Откройте ' + env.PUBLIC_BASE_URL + '. Для остановки нажмите Ctrl+C.');
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    { env, stdio: 'inherit', windowsHide: true },
  );
  const [exitCode] = await once(app, 'exit');
  if (exitCode) process.exitCode = exitCode;
}
try {
  await main();
} catch (e) {
  console.error('Ошибка локального запуска.', e.message);
  process.exitCode = 1;
} finally {
  if (postgres && postgres.exitCode === null) {
    const bin = pgBin();
    spawnSync(
      bin ? join(bin, exe('pg_ctl')) : exe('pg_ctl'),
      ['-D', data, '-m', 'fast', '-w', 'stop'],
      { windowsHide: true, stdio: 'ignore' },
    );
  }
}
