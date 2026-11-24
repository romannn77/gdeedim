import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { temporaryDb } from './temporary-db.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const origin = 'http://127.0.0.1:' + port;
const temp = await temporaryDb('demo');
let server, browser;
try {
  const credentials = temp.run('demo').trim().split(/\s+/).at(-1);
  const env = {
    ...temp.env,
    PORT: String(port),
    PUBLIC_BASE_URL: origin,
    AVAILABILITY_TTL_MINUTES: '0.2',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    { env, stdio: 'ignore' },
  );
  let online = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + '/api/catalog')).ok) {
        online = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  assert.ok(online, 'Сайт должен открыться');
  const protectedPage = await fetch(origin + '/admin', { redirect: 'manual' });
  assert.ok([303, 307, 308].includes(protectedPage.status));
  assert.equal((await fetch(origin + '/api/admin/workspace')).status, 401);
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
  });
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const page = await guest.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(page.getByText('Учебный режим ·', { exact: false })).toBeVisible();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  await expect(page.locator('.venue-card')).toHaveCount(3);
  const search = page.getByRole('textbox', { name: 'Поиск по названию или адресу' });
  await search.fill('кофейня');
  await expect(page.locator('.venue-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Кафе', exact: true }).click();
  await expect(page.getByText('Места не найдены')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click();
  await expect(page.locator('.venue-card')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Добавить в избранное · Учебное бистро', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'Избранное', exact: true }).click();
  await expect(page.locator('.venue-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Карта', exact: true }).click();
  const staff = await browser.newContext({ locale: 'ru-RU' }),
    back = await staff.newPage();
  await back.goto(origin + '/partner');
  await back.getByLabel('Электронная почта').fill('partner@demo.local');
  await back.getByLabel('Пароль', { exact: true }).fill(credentials);
  await back.locator('dialog form').getByRole('button', { name: 'Войти', exact: true }).click();
  await back.waitForURL('**/partner');
  await back.getByRole('button', { name: 'Есть свободные столики', exact: true }).click();
  await expect(page.locator('.venue-card .status.free')).toHaveCount(1, { timeout: 10000 });
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await page.getByLabel('Свежие данные о столиках').check();
  await page.getByLabel('В избранном', { exact: true }).check();
  await page.getByLabel('Есть предложения', { exact: true }).check();
  await expect(page.locator('.venue-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть фильтры' }).click();
  await expect(page.getByText('Места не найдены')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click();
  await expect(page.getByText('Нет свежих данных', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await page.locator('.list-body').evaluate((el) => el.scrollWidth > el.clientWidth));
  await page.getByRole('button', { name: 'Подробнее · Учебное бистро' }).click();
  await expect(page.getByRole('dialog')).toContainText('Учебный десерт к обеду');
  assert.equal((await page.content()).includes('УЧЕБНЫЙ-ДЕСЕРТ'), false);
  await page.getByRole('button', { name: 'Получить промокод' }).click();
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Электронная почта').fill('guest@demo.local');
  await page.getByLabel('Пароль', { exact: true }).fill(randomUUID());
  await page.locator('dialog form button').click();
  await expect(page.getByRole('dialog')).toContainText('Учебное бистро');
  assert.deepEqual((await (await guest.request.get(origin + '/api/me')).json()).favorites, [
    'demo-bistro',
  ]);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Плюс', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Попробовать на 14 дней' }).click();
  await expect(page.getByRole('dialog')).toContainText('Пробный период действует');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Подробнее · Учебное бистро' }).click();
  await page.getByRole('button', { name: 'Получить промокод' }).click();
  const code = page.getByText(/УЧЕБНЫЙ-ДЕСЕРТ · №/);
  await expect(code).toBeVisible();
  const ticket = (await code.innerText()).match(/№ ([A-F0-9]{16})/)[1];
  await back.getByLabel('Номер выдачи у гостя').fill(ticket);
  await back.getByRole('button', { name: 'Погасить код' }).click();
  await expect(back.getByText(/погашено 1/)).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'Браузер: карта, поиск, комбинированные фильтры, перенос избранного в аккаунт, права, обновление столиков без перезагрузки, истечение, мобильная лента, пробный период, выдача и погашение кода — пройдены.',
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
  await temp.close();
}
