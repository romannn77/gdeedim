import * as L from './vendor/leaflet.js';

const baseZoom = 14;
const mapBounds = [
  [55.61, 37.319],
  [55.674, 37.426],
];
const center = [55.643, 37.354];
const statusLabels = {
  free: 'Есть свободные столики',
  few: 'Осталось мало мест',
  full: 'Свободных столиков нет',
};
const svgPaths = {
  locate: '<path d="m20 4-6.6 16-2.6-7-7-2.6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zm6-2v16m6-14v16"/>',
  restaurant: '<path d="M5 3v5c0 3 5 3 5 0V3M7.5 3v17M18 20V3c-3 1-4 5-4 9h4"/>',
  cafe: '<path d="M3.5 10h13v4a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5Zm13 1h2a3 3 0 1 1 0 6h-2M5 22h12M6 7c2-2-1-2 1-4m4 4c2-2-1-2 1-4"/>',
  coffee: '<path d="M5.5 7h13l-1.8 13h-9.4Zm-1-3h15l.5 3H4Zm3 7h9l-.5 4h-8Z"/>',
};
function icon(name, size = 19) {
  return (
    '<svg aria-hidden="true" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    svgPaths[name] +
    '</svg>'
  );
}
function dom(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
function groupNearby(venues, map) {
  const groups = [];
  const view = map.getBounds().pad(0.18);
  for (const venue of venues) {
    if (!Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) continue;
    const location = L.latLng(venue.lat, venue.lon);
    if (!view.contains(location)) continue;
    const point = map.latLngToLayerPoint(location);
    const group = groups.find((g) => point.distanceTo(g.point) < 40);
    if (!group) {
      groups.push({ point, venues: [venue] });
      continue;
    }
    const count = group.venues.push(venue);
    group.point = group.point
      .multiplyBy(count - 1)
      .add(point)
      .divideBy(count);
  }
  return groups;
}

export function createMap(element, onSelect, onMessage = () => {}) {
  element.classList.add('district-map');
  element.setAttribute('aria-label', 'Карта заведений Ново-Переделкино');
  const map = L.map(element, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 13,
    maxZoom: 17,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    maxBounds: mapBounds,
    maxBoundsViscosity: 0.95,
    scrollWheelZoom: false,
  }).setView(center, 14.5);
  L.tileLayer(new URL('./map-assets/', import.meta.url).href + '{x}-{y}.svg', {
    minZoom: 13,
    maxZoom: 17,
    minNativeZoom: baseZoom,
    maxNativeZoom: baseZoom,
    noWrap: true,
    bounds: L.latLngBounds(
      map.unproject([9888 * 256, 5126 * 256], 14),
      map.unproject([9897 * 256, 5135 * 256], 14),
    ),
  }).addTo(map);
  map.createPane('guideLabels');
  const labelPane = map.getPane('guideLabels');
  labelPane.style.zIndex = '415';
  labelPane.style.pointerEvents = 'none';
  const places = L.layerGroup().addTo(map);
  const names = L.layerGroup().addTo(map);
  let destroyed = false;
  fetch(new URL('./map-assets/boundary.geojson', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then((boundary) => {
      if (destroyed) return;
      L.geoJSON(boundary, {
        interactive: false,
        style: {
          color: '#a77e65',
          weight: 1.5,
          dashArray: '5 6',
          opacity: 0.7,
          fill: false,
        },
      }).addTo(map);
    })
    .catch(() => {
      if (!destroyed) onMessage('Граница района не загрузилась. Список заведений доступен.');
    });
  const credit = L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
  credit.addAttribution(
    '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
  );

  let venues = [];
  let labels = [];
  let activeId = null;
  let currentPosition;
  let locating = false;
  let lastInput = '';
  let framed = false;

  function renderLabels() {
    const bounds = map.getBounds().pad(0.1);
    const used = new Set(),
      boxes = [];
    names.clearLayers();
    for (const label of labels) {
      if (!bounds.contains(label.location) || used.has(label.name)) continue;
      if (label.priority >= 7 && map.getZoom() < 14.5) continue;
      const p = map.latLngToContainerPoint(label.location);
      const w = Math.max(32, label.name.length * (label.kind === 'area' ? 5.2 : 3.0));
      const angle = (Number(label.angle || 0) * Math.PI) / 180;
      const dx = Math.abs(Math.cos(angle)) * w + 13,
        dy = Math.abs(Math.sin(angle)) * w + 10;
      if (boxes.some((b) => Math.abs(b.x - p.x) < b.dx + dx && Math.abs(b.y - p.y) < b.dy + dy))
        continue;
      boxes.push({ x: p.x, y: p.y, dx, dy });
      used.add(label.name);
      const span = dom('span', 'district-label district-label-' + label.kind, label.name);
      if (label.kind === 'street')
        span.style.transform += ' translate(-50%,-50%) rotate(' + (label.angle || 0) + 'deg)';
      L.marker(label.location, {
        pane: 'guideLabels',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'district-caption',
          html: span,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      }).addTo(names);
    }
  }

  function showMembers(marker, members) {
    const list = dom('div', 'district-cluster-list');
    const title = dom('strong', '', 'Заведения в этой точке');
    list.append(title);
    for (const venue of members) {
      const button = dom('button', '', venue.name);
      button.type = 'button';
      button.onclick = () => {
        map.closePopup();
        activeId = venue.id;
        renderPlaces();
        onSelect(venue);
      };
      list.append(button);
    }
    marker.bindPopup(list, { closeButton: false, maxWidth: 250 }).openPopup();
  }
  function renderPlaces() {
    places.clearLayers();
    for (const group of groupNearby(venues, map)) {
      const members = group.venues,
        venue = members[0],
        count = members.length;
      const focused = members.some((v) => v.id === activeId);
      const type = Object.hasOwn(svgPaths, venue.type) ? venue.type : 'restaurant';
      const location = count === 1 ? [venue.lat, venue.lon] : map.layerPointToLatLng(group.point);
      const wrapper = dom(
        'span',
        'district-badge' + (count > 1 ? ' is-cluster' : ' is-' + type) + (focused ? ' is-focused' : ''),
      );
      if (count > 1) wrapper.textContent = String(count);
      else wrapper.innerHTML = icon(type, 19);
      if (count === 1 && statusLabels[venue.status])
        wrapper.append(dom('i', 'district-status is-' + venue.status));
      const label =
        count === 1
          ? venue.name +
            ' · ' +
            (statusLabels[venue.status] ||
              venue.statusLabel ||
              (venue.updatedAt ? 'Нет свежих данных' : 'Нет данных'))
          : 'Заведения в группе: ' + count;
      const marker = L.marker(location, {
        title: label,
        alt: label,
        zIndexOffset: focused ? 500 : 0,
        icon: L.divIcon({
          html: wrapper,
          className: 'district-pin',
          iconSize: [36, 40],
          iconAnchor: [18, 35],
        }),
      }).addTo(places);
      marker.getElement()?.setAttribute('aria-label', label);
      marker.on('click', () => {
        if (count === 1) {
          activeId = venue.id;
          renderPlaces();
          onSelect(venue);
        } else if (map.getZoom() < map.getMaxZoom()) {
          const bounds = L.latLngBounds(members.map((v) => [v.lat, v.lon]));
          map.setView(
            bounds.getCenter(),
            Math.max(
              map.getZoom() + 1,
              Math.min(map.getMaxZoom(), map.getBoundsZoom(bounds, false, [70, 70])),
            ),
          );
        } else showMembers(marker, members);
      });
      if (count === 1)
        marker.bindTooltip(dom('span', '', venue.name), {
          direction: 'top',
          offset: [0, -30],
          className: 'district-tooltip',
        });
    }
  }
  function refresh() {
    renderLabels();
    renderPlaces();
  }
  map.on('moveend resize', refresh);
  fetch(new URL('./map-assets/labels.json', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then((rows) => {
      if (destroyed) return;
      labels = rows.map((d) => ({ ...d, location: map.unproject([d.x * 256, d.y * 256], baseZoom) }));
      renderLabels();
    })
    .catch(() => {
      if (!destroyed) onMessage('Уличные подписи не загрузились. Обновите страницу.');
    });

  function addControl(position, className) {
    const control = L.control({ position });
    const group = dom('div', 'district-controls ' + className);
    L.DomEvent.disableClickPropagation(group);
    L.DomEvent.disableScrollPropagation(group);
    control.onAdd = () => group;
    control.addTo(map);
    return group;
  }
  function button(group, glyph, label, action, visibleText = '') {
    const b = dom('button', 'district-control');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(glyph);
    if (visibleText) b.append(dom('span', '', visibleText));
    b.addEventListener('click', action);
    group.append(b);
    return b;
  }
  function resetView() {
    const bounds = L.latLngBounds([
      [55.6147, 37.3298],
      [55.6691, 37.4185],
    ]);
    map.fitBounds(bounds, { padding: [18, 18], maxZoom: 15 });
  }
  button(
    addControl('topleft', 'district-home'),
    'home',
    'Показать весь район',
    resetView,
    'Весь район',
  );
  const zooms = addControl('topright', 'district-zoom');
  const zoomIn = button(zooms, 'plus', 'Приблизить карту', () => map.zoomIn(1));
  const zoomOut = button(zooms, 'minus', 'Отдалить карту', () => map.zoomOut(1));
  function zoomState() {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
  }
  map.on('zoomend', zoomState);
  zoomState();
  const locationButton = button(
    addControl('topright', 'district-locate'),
    'locate',
    'Моё местоположение',
    () => {
      if (!navigator.geolocation) {
        onMessage('Браузер не поддерживает геолокацию. Выберите место на карте или в списке.');
        return;
      }
      if (locating) return;
      locating = true;
      locationButton.disabled = true;
      const done = () => {
        locating = false;
        locationButton.disabled = false;
      };
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (destroyed) return;
          done();
          const location = L.latLng(coords.latitude, coords.longitude);
          if (!L.latLngBounds(mapBounds).contains(location)) {
            onMessage(
              'Вы за пределами карты Ново-Переделкино. Можно выбрать любое заведение в списке.',
            );
            return;
          }
          currentPosition?.remove();
          currentPosition = L.circleMarker(location, {
            radius: 7,
            color: '#fff',
            weight: 3,
            fillColor: '#397fc1',
            fillOpacity: 1,
          }).addTo(map);
          currentPosition.bindTooltip('Вы здесь');
          map.setView(location, 16);
          onMessage('Ваше местоположение отмечено на карте.');
        },
        (error) => {
          if (destroyed) return;
          done();
          onMessage(
            error.code === 1
              ? 'Доступ к геопозиции отключён. Карта и поиск по-прежнему доступны.'
              : 'Не удалось определить местоположение. Выберите заведение на карте или в списке.',
          );
        },
        { timeout: 10000, maximumAge: 60000 },
      );
    },
  );
  const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  observer.observe(element);
  return {
    update(next) {
      venues = Array.isArray(next) ? next : [];
      if (!framed && venues.length && element.clientWidth && element.clientHeight) {
        const locations = venues
          .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
          .map((v) => [v.lat, v.lon]);
        if (locations.length) {
          framed = true;
          map.fitBounds(L.latLngBounds(locations), {
            paddingTopLeft: [35, 58],
            paddingBottomRight: [35, 25],
            maxZoom: 15,
          });
        }
      }
      const key = JSON.stringify(
        venues.map((v) => [v.id, v.lat, v.lon, v.name, v.type, v.status, v.statusLabel]),
      );
      if (key === lastInput) return;
      lastInput = key;
      renderPlaces();
    },
    focus(venue) {
      if (!venue || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return;
      activeId = venue.id;
      map.setView([venue.lat, venue.lon], Math.max(map.getZoom(), 16));
      renderPlaces();
    },
    resize() {
      map.invalidateSize({ pan: false });
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      map.remove();
    },
  };
}
