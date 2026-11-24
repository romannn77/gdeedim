import { NextRequest, NextResponse } from 'next/server';
import { cookieName, dispatch } from '../../../lib/actions.mjs';
export const dynamic = 'force-dynamic';
const reads = new Set([
  'catalog',
  'me',
  'my-codes',
  'partner/workspace',
  'admin/workspace',
  'billing/summary',
]);
type Context = { params: Promise<{ action: string[] }> };
async function handle(request: NextRequest, { params }: Context) {
  const path = (await params).action.join('/');
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if ((request.method === 'GET') !== reads.has(path))
    return json({ error: 'Метод запроса не поддерживается.' }, 405);
  let body = {};
  if (request.method === 'POST') {
    if (
      !['billing/notify', 'counter'].includes(path) &&
      request.headers.get('origin') !==
        new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').origin
    )
      return json({ error: 'Источник запроса не разрешён.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json({ error: 'Ожидается JSON.' }, 415);
    if (Number(request.headers.get('content-length')) > 32768)
      return json({ error: 'Запрос слишком большой.' }, 413);
    try {
      const raw = await request.text();
      if (raw.length > 32768) return json({ error: 'Запрос слишком большой.' }, 413);
      body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    } catch {
      return json({ error: 'Не удалось прочитать запрос.' }, 400);
    }
  }
  try {
    const result = await dispatch(path, {
      token: request.cookies.get(cookieName)?.value,
      body,
      authorization: request.headers.get('authorization'),
    } as any);
    if (path === 'login' || path === 'register') {
      const response = json({ ok: true });
      response.cookies.set(cookieName, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.PUBLIC_BASE_URL?.startsWith('https://'),
        maxAge: 2592000,
        path: '/',
      });
      return response;
    }
    const response = json(result);
    if (path === 'logout') response.cookies.delete(cookieName);
    return response;
  } catch (error: any) {
    if (!error?.status) console.error('Ошибка обработки запроса', path, error?.code || error?.name);
    return json(
      { error: error?.status ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.' },
      error?.status || 500,
    );
  }
}
export { handle as GET, handle as POST };
