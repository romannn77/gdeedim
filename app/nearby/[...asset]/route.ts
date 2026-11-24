import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Публикуем только файлы исходного гида, включая установку PWA.
const files: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'design.css': 'text/css; charset=utf-8',
  'table.svg': 'image/svg+xml',
  'manifest.webmanifest': 'application/manifest+json',
  'pwa.js': 'text/javascript', 'sw.js': 'text/javascript', 'site-config.js': 'text/javascript',
  'icons/icon.svg': 'image/svg+xml', 'icons/icon-180.png': 'image/png',
  'icons/icon-192.png': 'image/png', 'icons/icon-512.png': 'image/png',
};
export async function GET(_: Request, context: {params: Promise<{asset:string[]}>}) {
  const name = (await context.params).asset.join('/');
  if (!Object.hasOwn(files,name)) return new Response('Страница не найдена',{status:404});
  return new Response(new Uint8Array(await readFile(resolve(process.cwd(),name))),{
    headers:{'Content-Type':files[name]},
  });
}
