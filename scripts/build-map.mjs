// Сборка автономной подложки. Установка зависимостей описана в docs/карта.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const out = resolve(process.argv[2] || 'public/map-assets');
const headers = { 'User-Agent': 'GdeEdim-NovoPeredelkino-school-map/1.0' };
const zoom = 14;
const range = { west: 9888, east: 9896, north: 5126, south: 5134 };
const labels = [];

async function read(url) {
  for (let n = 1; n <= 3; n++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
      if (response.ok) return response;
      throw new Error('Код ответа ' + response.status);
    } catch (error) {
      if (n === 3) throw error;
      await new Promise((done) => setTimeout(done, 1500 * n));
    }
  }
}

const roadWidths = {
  motorway: 6.3,
  trunk: 5.6,
  primary: 5.1,
  secondary: 4.4,
  tertiary: 3.9,
  minor: 2.7,
  service: 1.5,
  track: 1.1,
  path: 0.72,
};
const landUses = {
  industrial: '#e5e1df',
  commercial: '#ece4de',
  garages: '#e4e0dc',
  pitch: '#c1d8ab',
  stadium: '#d4e2c1',
  cemetery: '#d2dfc1',
  allotments: '#d8e4cd',
  playground: '#dadfcd',
  school: '#e9e3da',
  kindergarten: '#e9e3da',
};
const vegetation = {
  wood: '#c3dab6',
  grass: '#d4e3c6',
  farmland: '#e0e6cd',
  wetland: '#c8ded2',
  scrub: '#cbdfbb',
};

function svgPath(feature, close) {
  return feature
    .loadGeometry()
    .map((line) => 'M' + line.map((p) => p.x + ',' + p.y).join('L') + (close ? 'Z' : ''))
    .join('');
}
function features(tile, layer, callback) {
  const source = tile.layers[layer];
  for (let i = 0; i < (source?.length || 0); i++) {
    const f = source.feature(i);
    callback(f, f.properties, source.extent);
  }
}
function midPoint(line) {
  const lengths = line.slice(1).map((p, i) => Math.hypot(p.x - line[i].x, p.y - line[i].y));
  const length = lengths.reduce((a, b) => a + b, 0);
  let left = length / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const a = line[i],
        b = line[i + 1],
        t = left / lengths[i];
      let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.round(angle), length };
    }
    left -= lengths[i];
  }
}
function collect(tile, tileX, tileY) {
  for (const layer of ['transportation_name', 'place', 'poi', 'water_name', 'park']) {
    features(tile, layer, (f, tags, extent) => {
      let name = tags['name:ru'] || tags.name;
      if (!name || name.trim().toLowerCase() === 'без названия') return;
      let kind, priority, p;
      if (layer === 'transportation_name') {
        if (!['trunk', 'motorway', 'primary', 'secondary', 'tertiary', 'minor'].includes(tags.class))
          return;
        const candidates = f
          .loadGeometry()
          .map(midPoint)
          .filter(Boolean)
          .sort((a, b) => b.length - a.length);
        p = candidates[0];
        if (!p || p.length < 500) return;
        name = name
          .replace(/улица/gi, 'ул.')
          .replace(/шоссе/gi, 'ш.')
          .replace(/проспект/gi, 'пр-т');
        kind = 'street';
        priority = tags.class === 'minor' ? 7 : tags.class === 'tertiary' ? 5 : 3;
      } else {
        if (f.type !== 1) return;
        p = f.loadGeometry()[0][0];
        if (layer === 'place' && ['suburb', 'village', 'neighbourhood'].includes(tags.class)) {
          kind = 'area';
          priority = tags.class === 'suburb' ? 1 : 5;
        } else if (layer === 'poi' && tags.subclass === 'subway') {
          kind = 'metro';
          priority = 2;
        } else if (layer === 'park' || (layer === 'poi' && tags.class === 'park')) {
          kind = 'park';
          priority = 4;
        } else if (layer === 'water_name') {
          kind = 'water';
          priority = 6;
        } else return;
      }
      if (p.x < 0 || p.y < 0 || p.x >= extent || p.y >= extent) return;
      labels.push({
        x: +(tileX + p.x / extent).toFixed(6),
        y: +(tileY + p.y / extent).toFixed(6),
        name,
        kind,
        priority,
        angle: Number.isFinite(p.angle) ? p.angle : 0,
      });
    });
  }
}
function render(tile) {
  const markup = [];
  function areas(layer, paint) {
    features(tile, layer, (f, tags) => {
      const fill = paint(tags);
      if (f.type === 3 && fill) markup.push('<path fill="' + fill + '" d="' + svgPath(f, true) + '"/>');
    });
  }
  areas('landuse', (t) => landUses[t.class]);
  areas('landcover', (t) => vegetation[t.class]);
  areas('water', () => '#b6d9dd');
  features(tile, 'waterway', (f, t) =>
    markup.push(
      '<path fill="none" stroke="#b0d5da" stroke-width="' +
        (t.class === 'river' ? 40 : 19) +
        '" d="' +
        svgPath(f, false) +
        '"/>',
    ),
  );
  areas('building', () => '#dcd8d1');
  const roads = [];
  features(tile, 'transportation', (f, t) => {
    if (f.type !== 2 || t.brunnel === 'tunnel') return;
    const road = t.class,
      w = roadWidths[road];
    if (w) roads.push({ road, w, d: svgPath(f, false) });
    if (road === 'rail') {
      const d = svgPath(f, false);
      markup.push(
        '<path fill="none" stroke="#bcb8b2" stroke-width="23" d="' +
          d +
          '"/><path fill="none" stroke="#f5f2eb" stroke-width="12" stroke-dasharray="46 46" d="' +
          d +
          '"/>',
      );
    }
  });
  roads.sort((a, b) => a.w - b.w);
  function stroke(d, color, width) {
    return '<path fill="none" stroke="' + color + '" stroke-width="' + width + '" d="' + d + '"/>';
  }
  for (const { road, w, d } of roads) {
    if (w >= 2)
      markup.push(
        stroke(d, ['motorway', 'trunk', 'primary'].includes(road) ? '#d4c5ac' : '#dad5cc', w * 16 + 12),
      );
  }
  for (const { road, w, d } of roads) {
    const color = ['motorway', 'trunk', 'primary'].includes(road)
      ? '#f7e2b5'
      : road === 'path'
        ? '#f4f2e3'
        : '#fffdf7';
    markup.push(stroke(d, color, w * 16));
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 4096 4096"><rect width="4096" height="4096" fill="#eceae3"/><g fill-rule="evenodd" stroke-linejoin="round" stroke-linecap="round">' +
    markup.join('') +
    '</g></svg>'
  );
}

await mkdir(out, { recursive: true });
const { tiles } = await (await read('https://tiles.openfreemap.org/planet')).json();
let bytes = 0;
for (let x = range.west; x <= range.east; x++) {
  for (let y = range.north; y <= range.south; y++) {
    const url = tiles[0].replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
    const data = new Uint8Array(await (await read(url)).arrayBuffer());
    bytes += data.byteLength;
    if (bytes > 50_000_000) throw new Error('Достигнут лимит для автономной области');
    const tile = new VectorTile(new Pbf(data));
    await writeFile(resolve(out, x + '-' + y + '.svg'), render(tile));
    collect(tile, x, y);
  }
}
await writeFile(
  resolve(out, 'labels.json'),
  JSON.stringify(labels.sort((a, b) => a.priority - b.priority)),
);
await writeFile(
  resolve(out, 'source.json'),
  JSON.stringify(
    {
      tiles: tiles[0],
      zoom,
      range,
      bytes,
      retrieved: new Date().toISOString(),
      attribution: 'OpenFreeMap © OpenMapTiles, данные © участников OpenStreetMap, ODbL 1.0',
    },
    null,
    2,
  ),
);
console.log(
  'Подложка готова. Подписей: ' + labels.length + '. Размер исходных данных: ' + bytes + ' Б.',
);
