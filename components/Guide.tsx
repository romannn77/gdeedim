'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  MapPin,
  Heart,
  Clock3,
  ChevronRight,
  Layers,
  Store,
  Navigation,
  ExternalLink,
  Tag,
  Info,
  PinOff,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  api,
  ago,
  Catalog,
  date,
  Header,
  hours,
  Modal,
  statusName,
  TypeIcon,
  types,
  User,
  Venue,
} from './shared';
import Account from './Account';
type MapController = {
  update: (v: Venue[]) => void;
  focus: (v: Venue) => void;
  resize: () => void;
  destroy?: () => void;
};
function localRead(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function localWrite(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}
export default function Guide({ initial }: { initial: Catalog }) {
  const [data, setData] = useState(initial),
    [user, setUser] = useState<User | null>(null),
    [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [tab, setTab] = useState('map');
  const [fresh, setFresh] = useState(false),
    [onlySaved, setOnlySaved] = useState(false),
    [offers, setOffers] = useState(false);
  const [filters, setFilters] = useState(false),
    [modal, setModal] = useState(''),
    [selected, setSelected] = useState(''),
    [toast, setToast] = useState(''),
    [offline, setOffline] = useState(false);
  const key = data.demo ? 'gde-edim-demo-favorites' : 'gde-edim-favorites';
  const [mapReady, setMapReady] = useState(0),
    map = useRef<MapController | null>(null),
    mapEl = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(''),
    [report, setReport] = useState(false),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(''),
    [afterLogin, setAfterLogin] = useState('');
  const [clock, setClock] = useState(0);
  function choose(v: Venue) {
    setCode('');
    setReport(false);
    setSelected(v.id);
    setModal('venue');
  }
  async function identity(merge = false) {
    const me = await api('me');
    let ids: string[] = me.user ? me.favorites : localRead(key);
    if (merge && me.user) {
      for (const id of localRead(key).filter(
        (id) => !ids.includes(id) && data.venues.some((v) => v.id === id),
      ))
        await api('favorite', { venueId: id, saved: true });
      ids = [...new Set([...ids, ...localRead(key)])];
      localWrite(key, []);
    }
    setUser(me.user);
    setSaved(ids);
    return me.user;
  }
  useEffect(() => {
    const p = new URLSearchParams(location.search),
      a = p.get('access');
    if (a) {
      setAccess(a);
      setModal('account');
    } else if (p.has('payment')) setModal('plus');
    identity().catch((e) => setToast(e.message));
    let active = true;
    async function refresh() {
      try {
        const c = await api('catalog');
        if (active) {
          setData(c);
          setOffline(false);
        }
      } catch {
        if (active) setOffline(true);
      }
    }
    const timer = setInterval(refresh, 4000);
    const tick = setInterval(() => setClock(Date.now()), 2000);
    return () => {
      active = false;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const url = '/map.js';
    import(/* webpackIgnore: true */ url)
      .then((m) => {
        if (active && mapEl.current) {
          map.current = m.createMap(mapEl.current, choose, setToast);
          setMapReady((n) => n + 1);
        }
      })
      .catch(() => setToast('Карта временно недоступна. Список заведений доступен.'));
    return () => {
      active = false;
      map.current?.destroy?.();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const currentVenues = useMemo(
    () =>
      data.venues
        .map((v) => {
          const stale = v.updatedAt && Date.now() - v.updatedAt >= data.ttl;
          return {
            ...v,
            status: stale ? null : v.status,
            party: stale ? null : v.party,
            occupancy: v.measuredAt && Date.now() - v.measuredAt >= data.ttl ? null : v.occupancy,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [data, clock],
  );
  const detail = currentVenues.find((v) => v.id === selected);
  const filtered = useMemo(
    () =>
      currentVenues.filter(
        (v) =>
          (!category || v.type === category) &&
          (!(tab === 'favorites' || onlySaved) || saved.includes(v.id)) &&
          (!(tab === 'offers' || offers) || v.offers.length > 0) &&
          (!fresh || !!v.status) &&
          (v.name + ' ' + (v.address || ''))
            .toLocaleLowerCase('ru')
            .replaceAll('ё', 'е')
            .includes(query.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')),
      ),
    [currentVenues, category, tab, onlySaved, saved, offers, fresh, query],
  );
  useEffect(() => {
    map.current?.update(filtered);
  }, [filtered, mapReady]);
  const favoriteBusy = useRef(new Set<string>());
  async function favorite(id: string) {
    if (favoriteBusy.current.has(id)) return;
    favoriteBusy.current.add(id);
    const add = !saved.includes(id);
    try {
      if (user) await api('favorite', { venueId: id, saved: add });
      setSaved((current) => {
        const next = add ? [...new Set([...current, id])] : current.filter((x) => x !== id);
        if (!user) localWrite(key, next);
        return next;
      });
    } catch (e: any) {
      setToast(e.message);
    } finally {
      favoriteBusy.current.delete(id);
    }
  }
  function reset() {
    setQuery('');
    setCategory('');
    setFresh(false);
    setOnlySaved(false);
    setOffers(false);
    setTab('map');
    setFilters(false);
  }
  function close() {
    setModal('');
    setAccess('');
    setAfterLogin('');
  }
  const count = Number(fresh) + Number(onlySaved) + Number(offers),
    hasFilters = count || category || query || tab !== 'map';
  const favBtn = (v: Venue) => (
    <button
      className={'heart icon-btn ' + (saved.includes(v.id) ? 'saved' : '')}
      aria-label={
        (saved.includes(v.id) ? 'Удалить из избранного' : 'Добавить в избранное') + ' · ' + v.name
      }
      aria-pressed={saved.includes(v.id)}
      onClick={() => favorite(v.id)}
    >
      <Heart size={18} fill={saved.includes(v.id) ? 'currentColor' : 'none'} />
    </button>
  );
  const status = (v: Venue) => (
    <span className={'status ' + (v.status || 'unknown')}>
      <i />
      {statusName(v)}
    </span>
  );
  return (
    <>
      <Header
        tab={tab}
        user={user}
        onTab={(s) => {
          setTab(s);
          setFilters(false);
        }}
        onAccount={() => setModal('account')}
        onPlus={() => setModal('plus')}
      />
      <main className="shell guide">
        <section className="hero">
          <div className="hero-art" />
          <div className="hero-copy">
            <div className="hero-location">
              <MapPin size={14} /> Москва · Ново-Переделкино
            </div>
            <h1>Где поесть сегодня?</h1>
            <p>Кафе, рестораны и свободные столики на карте района.</p>
          </div>
        </section>
        {data.demo && (
          <p className="notice">Учебный режим · вымышленные заведения и отдельная база для показа.</p>
        )}
        <div className="controls">
          <label className="search">
            <Search size={19} />
            <input
              aria-label="Поиск по названию или адресу"
              placeholder="Название или адрес"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="icon-btn" onClick={() => setQuery('')} aria-label="Очистить поиск">
                <X size={16} />
              </button>
            )}
          </label>
          <div className="categories" role="group" aria-label="Тип заведения">
            {[
              ['', 'Все места'],
              ['restaurant', 'Рестораны'],
              ['cafe', 'Кафе'],
              ['coffee', 'Кофейни'],
            ].map(([id, title]) => (
              <button
                key={id}
                aria-pressed={category === id}
                className={category === id ? 'chosen' : ''}
                onClick={() => setCategory(id)}
              >
                {id ? <TypeIcon type={id as Venue['type']} size={16} /> : <Layers size={16} />} {title}
              </button>
            ))}
          </div>
          <div className="filter-wrap">
            <button
              className={'filter-btn ' + (count ? 'applied' : '')}
              onClick={() => setFilters(!filters)}
              aria-expanded={filters}
            >
              <SlidersHorizontal size={17} /> Фильтры {count > 0 && <b>{count}</b>}
            </button>
            {filters && (
              <div className="filter-menu">
                <div className="row">
                  <strong>Показать места</strong>
                  <button
                    className="icon-btn"
                    aria-label="Закрыть фильтры"
                    onClick={() => setFilters(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                {(
                  [
                    ['Свежие данные о столиках', fresh, setFresh],
                    ['В избранном', onlySaved, setOnlySaved],
                    ['Есть предложения', offers, setOffers],
                  ] as const
                ).map(([title, val, change]) => (
                  <label key={title}>
                    <input type="checkbox" checked={val} onChange={(e) => change(e.target.checked)} />
                    {title}
                  </label>
                ))}
                <button className="text-btn" onClick={reset}>
                  Сбросить фильтры
                </button>
              </div>
            )}
          </div>
        </div>
        {offline && (
          <p className="notice" role="status">
            Связь с сервером прервана. Повторяем запрос.
          </p>
        )}
        <section className="explorer">
          <aside className="list-panel">
            <div className="list-heading">
              <div>
                <Store size={18} />
                <h2>
                  {tab === 'favorites'
                    ? 'Избранное'
                    : tab === 'offers'
                      ? 'С предложениями'
                      : 'Заведения района'}
                </h2>
              </div>
              <span>{filtered.length}</span>
            </div>
            <div className="list-body">
              {filtered.map((v) => (
                <article className="venue-card" key={v.id}>
                  <div className="card-head">
                    <span className={'type-icon ' + v.type}>
                      <TypeIcon type={v.type} />
                    </span>
                    <div className="card-title">
                      <span className="kind">{types[v.type]}</span>
                      <button
                        onClick={() => {
                          map.current?.focus(v);
                          choose(v);
                        }}
                      >
                        <h3>{v.name}</h3>
                      </button>
                    </div>
                    {favBtn(v)}
                  </div>
                  <div className="card-info">
                    <div>
                      <MapPin size={15} />
                      {v.address || 'Адрес не указан'}
                    </div>
                    {v.hours && (
                      <div>
                        <Clock3 size={15} />
                        {hours(v.hours)}
                      </div>
                    )}
                  </div>
                  <div className="card-foot">
                    {status(v)}
                    <button
                      onClick={() => {
                        map.current?.focus(v);
                        choose(v);
                      }}
                      aria-label={'Подробнее · ' + v.name}
                    >
                      Подробнее <ChevronRight size={14} />
                    </button>
                  </div>
                  {v.updatedAt && <small>Подтверждено сотрудником · {ago(v.updatedAt)}</small>}
                  {v.measuredAt && <small>
                    {v.occupancy === null ? 'Нет свежих данных счётчика' : 'Оценка заполненности: ' + v.occupancy + '%'}
                    {' · Счётчик · ' + ago(v.measuredAt)}
                  </small>}
                  {v.offers.length > 0 && (
                    <small>
                      <Tag size={13} /> Есть предложение
                    </small>
                  )}
                </article>
              ))}
              {!filtered.length && (
                <div className="empty">
                  <PinOff />
                  <h3>
                    {tab === 'offers'
                      ? 'Предложений пока нет'
                      : tab === 'favorites' && !saved.length
                        ? 'Здесь будет избранное'
                        : 'Места не найдены'}
                  </h3>
                  <p>
                    {tab === 'offers'
                      ? 'Здесь появятся предложения после публикации партнёрами.'
                      : tab === 'favorites' && !saved.length
                        ? 'Нажмите на сердечко в карточке заведения.'
                        : 'Измените запрос или сбросьте фильтры.'}
                  </p>
                  <button onClick={reset}>Сбросить фильтры</button>
                </div>
              )}
            </div>
          </aside>
          <div className="map-panel">
            <div className="map-canvas" ref={mapEl} aria-label="Интерактивная карта заведений" />
            <div className="map-legend">
              <span>
                <i className="legend-dot green" />
                Есть столики
              </span>
              <span>
                <i className="legend-dot ochre" />
                Мало мест
              </span>
              <span>
                <i className="legend-dot red" />
                Нет столиков
              </span>
              <span>
                <i className="legend-dot gray" />
                Нет данных
              </span>
            </div>
          </div>
        </section>
        <div className="source-line">
          <span>
            <Info size={14} />
            {data.demo ? (
              'Учебный каталог'
            ) : (
              <>
                Каталог OpenStreetMap · {data.last?.count ?? 0} заведений · проверено{' '}
                {date(data.last?.verified)}
              </>
            )}
          </span>
          {hasFilters ? (
            <button onClick={reset}>
              <RotateCcw size={14} /> Сбросить фильтры
            </button>
          ) : (
            <button onClick={() => setModal('about')}>О данных</button>
          )}
        </div>
      </main>
      <footer className="footer">
        <div className="shell">
          <strong>ГдеЕдим?</strong>
          <a href="/nearby/index.html">Кофейни и коворкинги рядом</a>
          <button
            onClick={() => {
              setAccess('partner');
              setModal('account');
            }}
          >
            Для заведений
          </button>
        </div>
      </footer>
      {(modal === 'account' || modal === 'plus') && (
        <Account
          mode={modal}
          user={user}
          venues={currentVenues}
          access={access}
          onClose={close}
          onMode={setModal}
          identity={async (merge) => {
            const u = await identity(merge);
            if (merge && afterLogin) {
              setModal(afterLogin);
              setAfterLogin('');
            }
            return u;
          }}
        />
      )}
      {modal === 'about' && (
        <Modal title="О каталоге" onClose={close}>
          <p>
            Источник — участники OpenStreetMap. В справочник включены отмеченные на карте рестораны,
            кафе и кофейни в административной границе Ново-Переделкина.
          </p>
          <p>
            Проверено {date(data.last?.verified)}. Заведения без названия, недавно открывшиеся и места
            без подходящей отметки могут отсутствовать. Сведения о столиках поступают от утверждённых
            сотрудников.
          </p>
          <a href="https://www.openstreetmap.org/relation/446117" target="_blank" rel="noreferrer">
            Граница района в OpenStreetMap
          </a>{' '}
          ·{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            Лицензия ODbL
          </a>
        </Modal>
      )}
      {modal === 'venue' && detail && (
        <Modal title={detail.name} onClose={close}>
          <div className="detail-top">
            <span className="type-inline">
              <TypeIcon type={detail.type} size={17} />
              {types[detail.type]}
            </span>
            {favBtn(detail)}
          </div>
          <div className="detail-info">
            <p>
              <MapPin />
              {detail.address || 'Адрес в источнике не указан'}
            </p>
            <p>
              <Clock3 />
              {detail.hours ? hours(detail.hours) : 'Часы работы не указаны'}
            </p>
          </div>
          <div className="soft-block">
            {status(detail)}
            <p>
              {detail.updatedAt
                ? 'Подтверждено сотрудником · ' + ago(detail.updatedAt)
                : 'Сотрудник пока не передавал сведения о столиках.'}
            </p>
            {detail.party && <p>Столик для компании до {detail.party} чел.</p>}
            {detail.occupancy !== null && (
              <p>
                Оценка заполненности: {detail.occupancy}% · счётчик, {ago(detail.measuredAt!)}
              </p>
            )}
            {detail.occupancy === null && detail.measuredAt && (
              <p>Нет свежих данных счётчика · последнее измерение {ago(detail.measuredAt)}</p>
            )}
          </div>
          <a
            className="primary block-link"
            href={'https://yandex.ru/maps/?rtext=~' + detail.lat + ',' + detail.lon}
            target="_blank"
            rel="noreferrer"
          >
            <Navigation size={17} />
            Построить маршрут
          </a>
          <h3>Предложения заведения</h3>
          {!detail.offers.length ? (
            <p className="muted">Активных предложений пока нет.</p>
          ) : (
            detail.offers.map((o) => (
              <div className="soft-block" key={o.id}>
                <strong>{o.title}</strong>
                <p>{o.terms}</p>
                <small>До {date(o.ends)}</small>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!user) {
                      setAfterLogin('venue');
                      setModal('account');
                      return;
                    }
                    try {
                      setBusy(true);
                      const r = await api('redeem', { id: o.id });
                      setCode(r.code + ' · № ' + r.ticket);
                    } catch (e: any) {
                      setToast(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Получить промокод
                </button>
              </div>
            ))
          )}
          {code && (
            <p className="notice" role="status">
              Ваш промокод <b>{code}</b>
            </p>
          )}
          {toast && (
            <p role="status" className="notice">
              {toast}
            </p>
          )}
          {detail.sourceUrl && (
            <p className="detail-source">
              <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
                Запись OpenStreetMap <ExternalLink size={13} />
              </a>{' '}
              · {date(detail.verifiedAt)}
            </p>
          )}
          <button
            className="text-btn"
            onClick={() => {
              if (!user) {
                setAfterLogin('venue');
                setModal('account');
              } else setReport(!report);
            }}
          >
            Сообщить об ошибке
          </button>
          {report && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api('report', { venueId: detail.id, note });
                  setNote('');
                  setReport(false);
                  setToast('Замечание отправлено администратору.');
                } catch (err: any) {
                  setToast(err.message);
                }
              }}
            >
              <label>
                Что нужно проверить?
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  minLength={3}
                  maxLength={300}
                  required
                />
              </label>
              <button>Отправить</button>
            </form>
          )}
        </Modal>
      )}
      {toast && !modal && (
        <div role="status" className="toast">
          {toast}
          <button aria-label="Закрыть сообщение" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
