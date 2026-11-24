// Импорт небольшого районного каталога из OpenStreetMap (ODbL).
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const district = 446117;
const osm = 'https://www.openstreetmap.org';
const api = 'https://api.openstreetmap.org/api/0.6';
const idOf = (item) => item.type + '/' + item.id;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const pairs = (ring, fn) => ring.slice(1).forEach((p, i) => fn(ring[i], p));

export function indexElements(elements) {
  const index = new Map();
  for (const item of elements) {
    const id = idOf(item);
    if (!index.has(id) || index.get(id).version < item.version) index.set(id, item);
  }
  return index;
}

function wayPoints(way, index) {
  return way.nodes.map((id) => {
    const node = index.get('node/' + id);
    if (!node) throw Error('Отсутствует узел ' + id + ' у ' + idOf(way));
    return [node.lon, node.lat];
  });
}

function stitch(parts) {
  const pieces = parts.slice(),
    rings = [];
  while (pieces.length) {
    let ring = pieces.pop().slice();
    while (!same(ring[0], ring.at(-1))) {
      const j = pieces.findIndex((p) => same(p[0], ring.at(-1)) || same(p.at(-1), ring.at(-1)));
      if (j < 0) throw Error('Контур объекта разорван.');
      let next = pieces.splice(j, 1)[0];
      if (!same(next[0], ring.at(-1))) next = [...next].reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length < 4) throw Error('В контуре мало точек.');
    rings.push(ring);
  }
  return rings;
}

function inRing([x, y], ring) {
  let inside = false;
  pairs(ring, ([ax, ay], [bx, by]) => {
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  });
  return inside;
}

export function contains(point, polygons) {
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)),
  );
}

function polygonsFor(item, index) {
  if (item.type === 'way') return stitch([wayPoints(item, index)]).map((ring) => [ring]);
  const parts = { outer: [], inner: [] };
  for (const member of item.members) {
    const role = member.role || 'outer';
    if (!Object.hasOwn(parts, role) || member.type !== 'way') continue;
    const way = index.get('way/' + member.ref);
    if (!way) throw Error('Отсутствует линия ' + member.ref);
    parts[role].push(wayPoints(way, index));
  }
  const polygons = stitch(parts.outer).map((ring) => [ring]);
  for (const hole of stitch(parts.inner)) {
    const polygon = polygons.find(([ring]) => inRing(hole[0], ring));
    if (!polygon) throw Error('Некорректный внутренний контур.');
    polygon.push(hole);
  }
  if (!polygons.length) throw Error('Нет внешней границы.');
  return polygons;
}

export function boundaryGeometry(raw) {
  const index = indexElements(raw.elements);
  const item = index.get('relation/' + district);
  const t = item?.tags;
  if (
    t?.boundary !== 'administrative' ||
    t.admin_level !== '8' ||
    t.wikidata !== 'Q2364381' ||
    !/Ново-Переделкино/i.test(t.name)
  )
    throw Error('Источник не подтвердил границу района Ново-Переделкино.');
  const coordinates = polygonsFor(item, index);
  // Контроль внутренней точки в центральной части района и точки в соседнем Солнцеве.
  if (!contains([37.355, 55.646], coordinates) || contains([37.391, 55.65], coordinates))
    throw Error('Проверка расположения границы района не пройдена.');
  return {
    type: 'Feature',
    properties: {
      id: idOf(item),
      name: t.name,
      version: item.version,
      updatedAt: item.timestamp,
      sourceUrl: osm + '/' + idOf(item),
      attribution: '© Участники OpenStreetMap',
    },
    geometry: { type: 'MultiPolygon', coordinates },
  };
}

function bounds(points) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Середина самого широкого внутреннего интервала горизонтального сечения:
// метка остаётся внутри вогнутой геометрии и вне внутренних дворов.
function interiorPoint(polygons) {
  let best,
    width = 0;
  for (const polygon of polygons) {
    const [, y0, , y1] = bounds(polygon[0]);
    for (const factor of [0.5, 0.25, 0.75]) {
      const y = y0 + (y1 - y0) * factor;
      const cuts = [];
      for (const ring of polygon)
        pairs(ring, ([ax, ay], [bx, by]) => {
          if (ay > y !== by > y) cuts.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
        });
      cuts.sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i += 2) {
        const span = cuts[i] - cuts[i - 1];
        if (span > width) {
          width = span;
          best = [(cuts[i] + cuts[i - 1]) / 2, y];
        }
      }
    }
  }
  if (!best) throw Error('Невозможно разместить метку внутри контура.');
  return best;
}

function address(tags) {
  return (
    tags['addr:full'] ||
    [tags['addr:street'] || tags['addr:place'], tags['addr:housenumber']].filter(Boolean).join(', ') ||
    null
  );
}

function kind(tags) {
  if (tags.amenity === 'restaurant') return 'restaurant';
  if (tags.amenity === 'cafe') {
    return /(^|;)(coffee_shop|coffee)(;|$)/.test(tags.cuisine || '') || tags.cafe === 'coffee_shop'
      ? 'coffee'
      : 'cafe';
  }
  if (tags.shop === 'coffee' && (tags['service:coffee'] === 'yes' || tags['drink:coffee'] === 'served'))
    return 'coffee';
  return null;
}

const normalized = (value) =>
  value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\d]+/gu, '');

export function extractVenues(index, boundary, verifiedAt) {
  const buildings = [],
    venues = [],
    review = [],
    candidates = new Map();
  for (const item of index.values()) {
    const t = item.tags || {};
    if (t.building && item.type !== 'node' && address(t)) {
      try {
        const polygons = polygonsFor(item, index),
          bbox = bounds(polygons.flatMap((p) => p[0]));
        buildings.push({
          id: idOf(item),
          address: address(t),
          polygons,
          bbox,
          area: (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]),
        });
      } catch {
        /* Здание на краю выгрузки без полного контура не служит источником адреса. */
      }
    }
    if (kind(t)) candidates.set(idOf(item), item);
  }
  buildings.sort((a, b) => a.area - b.area);
  const districtPolygons = boundary.geometry.coordinates;
  for (const [id, item] of candidates) {
    let point, polygons;
    try {
      if (item.type === 'node') point = [item.lon, item.lat];
      else {
        polygons = polygonsFor(item, index);
        point = interiorPoint(polygons);
      }
    } catch {
      review.push({ issue: 'geometry', ids: [id], note: 'Требуется проверить геометрию объекта.' });
      continue;
    }
    if (!contains(point, districtPolygons)) continue;
    if (polygons?.some(([outer]) => outer.some((vertex) => !contains(vertex, districtPolygons)))) {
      review.push({
        issue: 'boundary',
        ids: [id],
        note: 'Объект пересекает границу района. Требуется проверить расположение заведения.',
      });
      continue;
    }
    const t = item.tags;
    if (
      ['no', 'private'].includes(t.access) ||
      ['yes', 'true'].some((s) => [t.disused, t.abandoned, t.demolished].includes(s))
    ) {
      review.push({
        issue: 'closed',
        ids: [id],
        note: 'Источник указывает на закрытие или ограничение доступа.',
      });
      continue;
    }
    const name = t['name:ru'] || t.name;
    if (!name) {
      review.push({
        issue: 'unnamed',
        ids: [id],
        note: 'Нет названия. Требуется проверить перед публикацией.',
      });
      continue;
    }
    const [lon, lat] = point;
    let addr = address(t),
      addressSourceId = addr ? id : null;
    if (!addr || (!t['addr:housenumber'] && !t['addr:full'])) {
      const building = buildings.find(
        ({ bbox: b, polygons: p }) =>
          lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3] && contains(point, p),
      );
      if (building && (!addr || normalized(building.address).includes(normalized(addr)))) {
        addr = building.address;
        addressSourceId = building.id;
      }
    }
    venues.push({
      id,
      name,
      type: kind(t),
      lat,
      lon,
      address: addr,
      hours: t.opening_hours || null,
      sourceUrl: osm + '/' + id,
      sourceIds: [id],
      verifiedAt,
      osmUpdatedAt: item.timestamp,
      addressSourceId,
      polygons,
    });
  }
  // Одноимённая точка внутри одноимённого контура или совпадающие координаты.
  // Близкие филиалы со схожими именами только ставятся в очередь проверки.
  const unique = [];
  for (const entry of venues.sort((a, b) => a.id.localeCompare(b.id))) {
    const matches = unique.filter((v) => normalized(v.name) === normalized(entry.name));
    const duplicate = matches.find(
      (v) =>
        same([v.lon, v.lat], [entry.lon, entry.lat]) ||
        (v.polygons && contains([entry.lon, entry.lat], v.polygons)) ||
        (entry.polygons && contains([v.lon, v.lat], entry.polygons)),
    );
    if (duplicate) {
      duplicate.sourceIds.push(entry.id);
      if (!duplicate.address && entry.address) {
        duplicate.address = entry.address;
        duplicate.addressSourceId = entry.addressSourceId;
      }
      duplicate.hours ||= entry.hours;
      duplicate.polygons ||= entry.polygons;
      review.push({
        issue: 'merged',
        ids: [duplicate.id, entry.id],
        note: 'Объединены совпадающие объекты OSM.',
      });
    } else {
      for (const v of matches) {
        if (Math.hypot((v.lon - entry.lon) * 62500, (v.lat - entry.lat) * 111320) < 80)
          review.push({
            issue: 'possible_duplicate',
            ids: [v.id, entry.id],
            note: 'Одноимённые заведения ближе 80 м. Проверьте, разные ли это филиалы.',
          });
      }
      unique.push(entry);
    }
  }
  return {
    venues: unique.map(({ polygons, ...v }) => v).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    review,
  };
}

async function getJson(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(api + path, {
      signal: AbortSignal.timeout(90000),
      headers: { 'User-Agent': 'GdeEdim-district-catalog/1.0', Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    if ([429, 502, 503, 504].includes(res.status) && attempt < 2) {
      await new Promise((r) =>
        setTimeout(r, Math.max(5000, Number(res.headers.get('Retry-After') || 5) * 1000)),
      );
      continue;
    }
    throw Error('OSM вернул ошибку HTTP ' + res.status + '. Предыдущий каталог сохранён.');
  }
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 3 && args[0] === '--local'))
    throw Error('Команда: node scripts/osm.mjs [--local граница.json папка_участков]');
  const cached = args.length > 0;
  const raw = cached ? await readJson(args[1]) : await getJson('/relation/' + district + '/full.json');
  const boundary = boundaryGeometry(raw);
  const bbox = bounds(boundary.geometry.coordinates.flatMap((p) => p[0]));
  const index = new Map(),
    tiles = [];
  let checked = Date.now();
  const ingest = (data) => {
    if (!data.bounds || !Array.isArray(data.elements)) throw Error('Ответ OSM неполон.');
    const b = data.bounds;
    tiles.push([b.minlon, b.minlat, b.maxlon, b.maxlat]);
    for (const item of data.elements) {
      const id = idOf(item);
      if (!index.has(id) || item.version > index.get(id).version) index.set(id, item);
    }
  };
  if (cached) {
    checked = Math.min(checked, (await stat(args[1])).mtimeMs);
    for (const file of (await readdir(args[2])).filter((f) => f.endsWith('.json')).sort()) {
      const path = join(args[2], file);
      ingest(await readJson(path));
      checked = Math.min(checked, (await stat(path)).mtimeMs);
    }
  } else {
    // Небольшие последовательные запросы укладываются в ограничения /map.
    const nx = Math.ceil((bbox[2] - bbox[0]) / 0.025),
      ny = Math.ceil((bbox[3] - bbox[1]) / 0.02);
    const edge = (i, n, a, b) => a + ((b - a) * i) / n;
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++) {
        const cell = [
          edge(x, nx, bbox[0], bbox[2]),
          edge(y, ny, bbox[1], bbox[3]),
          edge(x + 1, nx, bbox[0], bbox[2]),
          edge(y + 1, ny, bbox[1], bbox[3]),
        ];
        ingest(await getJson('/map.json?bbox=' + cell.join(',')));
        await new Promise((r) => setTimeout(r, 1000));
      }
  }
  // Проверяется покрытие всего прямоугольника, включая стыки участков.
  const edges = (a, b) =>
    Array.from(
      new Set([
        bbox[a],
        bbox[b],
        ...tiles.flatMap((t) => [t[a], t[b]]).filter((n) => n > bbox[a] && n < bbox[b]),
      ]),
    ).sort((x, y) => x - y);
  const xs = edges(0, 2),
    ys = edges(1, 3);
  for (let i = 1; i < xs.length; i++)
    for (let j = 1; j < ys.length; j++) {
      const x = (xs[i - 1] + xs[i]) / 2,
        y = (ys[j - 1] + ys[j]) / 2;
      if (!tiles.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]))
        throw Error('В выгрузке отсутствует часть района. Предыдущий каталог сохранён.');
    }
  const verifiedAt = new Date(checked).toISOString();
  const { venues, review } = extractVenues(index, boundary, verifiedAt);
  if (!venues.length) throw Error('Пустой результат. Предыдущий каталог сохранён.');
  const path = join(root, 'data', 'catalog.json');
  let previous;
  try {
    previous = await readJson(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const currentIds = new Set(venues.flatMap((v) => v.sourceIds));
  for (const item of previous?.review || [])
    if (item.issue === 'missing' && !item.ids.some((id) => currentIds.has(id))) review.push(item);
  for (const v of previous?.venues || [])
    if (!(v.sourceIds || [v.id]).some((id) => currentIds.has(id)))
      review.push({
        issue: 'missing',
        ids: [v.id],
        note: 'Отсутствует в новой выгрузке. Проверьте переезд, переименование или закрытие.',
      });
  const report = {
    source: 'OpenStreetMap',
    sourceUrl: osm + '/relation/' + district,
    attribution: '© Участники OpenStreetMap',
    license: 'ODbL 1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    importedAt: new Date().toISOString(),
    verifiedAt,
    boundaryId: 'relation/' + district,
    boundaryVersion: boundary.properties.version,
    count: venues.length,
    coverageGaps: [
      'В каталог входят нанесённые на OSM рестораны, кафе и кофейни с названием. Изменения у заведений могут появляться в OSM с задержкой.',
      'Бары, фастфуд и магазины зерна без подтверждённой подачи кофе исключены. У части заведений отсутствуют адрес или часы работы.',
      'Дата проверки фиксирует чтение данных OSM. Подтверждение свободных столиков поступает отдельно от партнёра.',
    ],
    review,
    venues,
  };
  await saveJson(join(root, 'data', 'boundary.geojson'), boundary);
  await saveJson(path, report);
  console.log(
    'Импорт OpenStreetMap завершён. В каталоге: ' +
      venues.length +
      '. Записей для проверки: ' +
      review.length +
      '.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch((error) => {
    console.error(
      'Ошибка импорта. ' +
        (error instanceof TypeError && error.cause
          ? 'Не удалось подключиться к OpenStreetMap.'
          : error.message),
    );
    process.exitCode = 1;
  });
