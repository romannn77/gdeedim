// v2: only an offline message, no cached venue or occupancy information.
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url),root=new URL(self.registration.scope);
 if(e.request.method!=='GET'||e.request.mode!=='navigate'||url.origin!==root.origin||![root.pathname,root.pathname+'index.html'].includes(url.pathname))return;
 e.respondWith(fetch(e.request).catch(()=>new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ГдеЕдим?</title><style>body{background:#fbf7ef;color:#382b25;font:18px/1.7 Arial;padding:12vh 8vw}h1{font:48px Georgia}a{color:#973c24}</style><h1>Скоро снова на кофе.</h1><p>Для карты нужен интернет. Подключитесь к сети и откройте приложение снова.</p><a href="./">Попробовать снова</a></html>`,{headers:{'Content-Type':'text/html; charset=utf-8'}})));
});
