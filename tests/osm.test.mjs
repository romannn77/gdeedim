import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boundaryGeometry, contains, extractVenues, indexElements } from '../scripts/osm.mjs';

const polygon = [
  [
    [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
      [0, 0],
    ],
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
      [1, 1],
    ],
  ],
];
const fixtureBoundary = { geometry: { coordinates: polygon } };
const node = (id, lon, lat, tags) => ({ id, lon, lat, tags, type: 'node', version: 1 });
const stamp = '2026-01-01T00:00:00.000Z';
const readData = async (file) =>
  JSON.parse(await readFile(new URL('../data/' + file, import.meta.url), 'utf8'));

test('Район с анклавом отделён от соседней территории', () => {
  assert.equal(contains([3, 3], polygon), true);
  assert.equal(contains([1.5, 1.5], polygon), false);
  assert.equal(contains([-0.01, 3], polygon), false);
});

test('Импорт проверяет идентичность района', () => {
  assert.throws(
    () =>
      boundaryGeometry({
        elements: [
          {
            id: 446117,
            type: 'relation',
            tags: { boundary: 'administrative', admin_level: '8', name: 'Другой район' },
          },
        ],
      }),
    /не подтвердил/,
  );
});

test('Точки и замкнутые линии объединяются с сохранением источников. Пропуски попадают на проверку', () => {
  const elements = [
    node(1, 3, 3),
    node(2, 4, 3),
    node(3, 4, 4),
    node(4, 3, 4),
    {
      type: 'way',
      id: 20,
      nodes: [1, 2, 3, 4, 1],
      tags: {
        building: 'yes',
        'addr:street': 'Школьная улица',
        'addr:housenumber': '2',
        amenity: 'cafe',
        name: 'Пример',
      },
    },
    node(5, 3.2, 3.2, { amenity: 'cafe', name: 'Пример' }),
    node(6, 1.5, 1.5, { amenity: 'restaurant', name: 'В анклаве' }),
    node(7, 5, 4, { amenity: 'cafe' }),
    node(8, 5, 4, { amenity: 'restaurant', name: 'Закрыт', disused: 'yes' }),
    node(9, 5, 5, { shop: 'coffee', name: 'Магазин зерна' }),
  ];
  const { venues, review } = extractVenues(
    indexElements([...elements, ...elements]),
    fixtureBoundary,
    stamp,
  );
  assert.equal(venues.length, 1);
  assert.deepEqual(venues[0].sourceIds, ['node/5', 'way/20']);
  assert.equal(venues[0].address, 'Школьная улица, 2');
  assert.equal(venues[0].addressSourceId, 'way/20');
  assert.equal(venues[0].hours, null);
  assert.deepEqual(review.map((r) => r.issue).sort(), ['closed', 'merged', 'unnamed']);
});

test('Объект-отношение с обратной линией импортируется по внутренней точке', () => {
  const elements = [
    node(1, 3, 3),
    node(2, 4, 3),
    node(3, 4, 4),
    node(4, 3, 4),
    { type: 'way', id: 20, nodes: [1, 2, 3] },
    { type: 'way', id: 21, nodes: [1, 4, 3] },
    {
      type: 'relation',
      id: 30,
      tags: { type: 'multipolygon', amenity: 'cafe', cuisine: 'coffee_shop', name: 'Пример' },
      members: [
        { type: 'way', role: 'outer', ref: 20 },
        { type: 'way', role: 'outer', ref: 21 },
      ],
    },
  ];
  const { venues, review } = extractVenues(indexElements(elements), fixtureBoundary, stamp);
  assert.equal(venues[0].id, 'relation/30');
  assert.equal(venues[0].type, 'coffee');
  assert.deepEqual([venues[0].lon, venues[0].lat], [3.5, 3.5]);
  assert.equal(review.length, 0);
});

test('Каждая опубликованная точка снимка имеет уникальный источник и находится в районе', async () => {
  const boundary = await readData('boundary.geojson'),
    catalog = await readData('catalog.json');
  assert.equal(boundary.properties.id, catalog.boundaryId);
  assert.equal(catalog.count, catalog.venues.length);
  assert.ok(catalog.count > 0);
  const ids = catalog.venues.flatMap((v) => v.sourceIds);
  assert.equal(new Set(ids).size, ids.length);
  for (const v of catalog.venues) {
    assert.ok(contains([v.lon, v.lat], boundary.geometry.coordinates), v.name);
    assert.equal(v.sourceUrl, 'https://www.openstreetmap.org/' + v.id);
    assert.ok(Date.parse(v.verifiedAt) <= Date.parse(catalog.importedAt));
  }
});
