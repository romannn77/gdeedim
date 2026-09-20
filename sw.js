const OFFLINE_PAGE = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1d33"><title>Нет подключения</title><style>body{margin:0;padding:10vh 24px;background:#0b1d33;color:#fff;font:18px/1.6 system-ui}main{max-width:520px;margin:auto}h1{font-size:32px}a{display:inline-block;background:#34d17f;color:#0b1d33;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700}</style><main><p>ГдеЕдим?</p><h1>Нужен интернет</h1><p>Подключитесь к сети, чтобы открыть заведения и карту. Ваше приложение останется на главном экране.</p><a href="/">Попробовать снова</a></main></html>`;
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || !['/', '/index.html'].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_PAGE, {status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
