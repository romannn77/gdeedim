'use client';
import { useState, useEffect } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { api, Brand, date, time, states } from './shared';
const decisions: Record<string, string> = {
  approved: 'Одобрено',
  rejected: 'Отклонено',
  pending: 'На проверке',
  visible: 'В каталоге',
  closed: 'Закрыто',
  duplicate: 'Дубль',
  succeeded: 'Успешно',
  failed: 'Ошибка',
  canceled: 'Отменено',
  creating: 'Создаётся',
  user: 'Гость с аккаунтом',
  partner: 'Сотрудник',
  admin: 'Администратор',
};
const describe = (v: string) => decisions[v] || v;
const iso = (at: number) => new Date(at + 3 * 3600000).toISOString().slice(0, 16);
const blank = () => ({
  id: '',
  title: '',
  terms: '',
  code: '',
  starts: iso(Date.now()),
  ends: iso(Date.now() + 7 * 86400000),
  maxUses: 25,
});
export default function Workspace({ kind }: { kind: 'partner' | 'admin' }) {
  const [s, set] = useState<any>(null),
    [msg, setMsg] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState('Каталог'),
    [party, setParty] = useState(''),
    [form, setForm] = useState(blank),
    [editor, setEditor] = useState(false);
  const [ticket, setTicket] = useState('');
  const [targets, setTargets] = useState<Record<string, string>>({});
  async function reload() {
    set(await api(kind + '/workspace'));
  }
  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
  }, []);
  async function act(action: string, b: any, success: string) {
    setBusy(true);
    try {
      await api(kind + '/' + action, b);
      await reload();
      setMsg(success);
      return true;
    } catch (e: any) {
      setMsg(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string) => s?.venues?.find((v: any) => v.id === id)?.name || id;
  return (
    <>
      <header className="header">
        <div className="shell header-inner">
          <Brand />
          <a className="back" href="/">
            <ArrowLeft size={16} />К карте района
          </a>
        </div>
      </header>
      <main className="shell work">
        <p className="kicker">{kind === 'partner' ? 'Кабинет сотрудника' : 'Управление платформой'}</p>
        <h1>{kind === 'partner' ? s?.venue.name || 'Ваше заведение' : 'Администрирование'}</h1>
        {msg && (
          <p className="notice" role="status">
            {msg}
          </p>
        )}
        {!s ? (
          <p>Загрузка кабинета…</p>
        ) : kind === 'partner' ? (
          <div className="work-grid">
            <section className="panel">
              <h2>Свободные столики</h2>
              <p>
                {s.venue.updatedAt
                  ? 'Последнее обновление · ' +
                    date(s.venue.updatedAt) +
                    ' в ' +
                    time(s.venue.updatedAt)
                  : 'Обновлений пока нет.'}
              </p>
              <p>
                <b>
                  {s.venue.updatedAt && Date.now() - Number(s.venue.updatedAt) < s.ttl
                    ? states[s.venue.status]
                    : s.venue.updatedAt
                      ? 'Нет свежих данных'
                      : 'Нет данных'}
                </b>
              </p>
              <label>
                Размер компании, которую можно посадить
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={party}
                  placeholder="Необязательно"
                  onChange={(e) => setParty(e.target.value)}
                />
              </label>
              <div className="status-buttons">
                {Object.entries(states).map(([k, v]) => (
                  <button
                    key={k}
                    disabled={busy}
                    onClick={() =>
                      act(
                        'availability',
                        { venueId: s.venue.id, status: k, party: party ? Number(party) : null },
                        'Статус опубликован на карте.',
                      )
                    }
                  >
                    <span className={'status ' + k}>
                      <i />
                      {v}
                    </span>
                  </button>
                ))}
              </div>
              <small>
                Статус действует {s.ttl / 60000} мин. Обновите его, если ситуация изменится.
              </small>
            </section>
            <section className="panel">
              <div className="row">
                <h2>Предложения</h2>
                <button
                  onClick={() => {
                    setForm(blank());
                    setEditor(true);
                  }}
                >
                  <Plus size={16} /> Создать
                </button>
              </div>
              {!s.offers.length && <p>Вы ещё не публиковали предложения.</p>}
              {s.offers.map((o: any) => (
                <div key={o.id} className="admin-item">
                  <strong>{o.title}</strong>
                  <p>
                    {describe(o.state)} · Выдано {o.uses} из {o.max_uses} · погашено {o.confirmed}
                  </p>
                  <button
                    onClick={() => {
                      setForm({
                        ...o,
                        starts: iso(Number(o.starts)),
                        ends: iso(Number(o.ends)),
                        maxUses: o.max_uses,
                      });
                      setEditor(true);
                    }}
                  >
                    Редактировать
                  </button>
                </div>
              ))}
              {s.offers.length > 0 && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act('confirm', { ticket, venueId: s.venue.id }, 'Код погашен.'))
                      setTicket('');
                  }}
                >
                  <label>
                    Номер выдачи у гостя
                    <input
                      required
                      minLength={16}
                      maxLength={16}
                      value={ticket}
                      onChange={(e) => setTicket(e.target.value.trim().toUpperCase())}
                    />
                  </label>
                  <button disabled={busy}>Погасить код</button>
                </form>
              )}
              {editor && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act(
                        'offer',
                        {
                          ...form,
                          venueId: s.venue.id,
                          starts: Date.parse(form.starts + ':00+03:00'),
                          ends: Date.parse(form.ends + ':00+03:00'),
                        },
                        'Предложение отправлено на модерацию.',
                      )
                    )
                      setEditor(false);
                  }}
                >
                  {(
                    [
                      ['title', 'Название'],
                      ['terms', 'Условия для гостей'],
                      ['code', 'Промокод'],
                      ['starts', 'Начало (Москва)'],
                      ['ends', 'Окончание (Москва)'],
                      ['maxUses', 'Лимит выдачи'],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        required
                        type={
                          k === 'maxUses'
                            ? 'number'
                            : k === 'starts' || k === 'ends'
                              ? 'datetime-local'
                              : 'text'
                        }
                        min={k === 'maxUses' ? 1 : undefined}
                        value={form[k]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            [k]: k === 'maxUses' ? Number(e.target.value) : e.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                  <button className="primary" disabled={busy}>
                    Отправить на проверку
                  </button>
                </form>
              )}
            </section>
          </div>
        ) : (
          <>
            <div className="admin-tabs">
              {['Каталог', 'Сотрудники', 'Предложения', 'Оплаты', 'Журнал'].map((t) => (
                <button key={t} className={tab === t ? 'chosen' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <section className="panel">
              <h2>{tab}</h2>
              {tab === 'Каталог' && (
                <>
                  <details>
                    <summary>История импорта</summary>
                    {s.imports.map((i: any) => (
                      <p key={i.id}>
                        {date(i.at)} · {i.source} · {i.count} записей ·{' '}
                        {i.boundary || 'учебный каталог'}
                      </p>
                    ))}
                  </details>
                  {s.reviews.map((r: any) => (
                    <div className="soft-block" key={r.key}>
                      <strong>Требуется проверка источника</strong>
                      <p>{r.note}</p>
                      {r.source_ids.map((id: string) => (
                        <a
                          key={id}
                          href={'https://www.openstreetmap.org/' + id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {id}{' '}
                        </a>
                      ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          act(
                            'resolve',
                            { key: r.key, resolution: targets[r.key] },
                            'Решение сохранено в журнале.',
                          );
                        }}
                      >
                        <label>
                          Результат проверки
                          <input
                            required
                            minLength={3}
                            value={targets[r.key] || ''}
                            onChange={(e) => setTargets({ ...targets, [r.key]: e.target.value })}
                          />
                        </label>
                        <button disabled={busy}>Завершить проверку</button>
                      </form>
                    </div>
                  ))}
                  {s.venues.map((v: any) => (
                    <div className="admin-item" key={v.id}>
                      <strong>{v.name}</strong> · {v.address || v.id}
                      <p>
                        {describe(v.visibility)} ·{' '}
                        {v.updated_at
                          ? Date.now() - Number(v.updated_at) > s.ttl
                            ? 'Нет свежих данных'
                            : states[v.status]
                          : 'Нет данных'}
                        {v.review ? ' · Требует проверки: ' + v.review : ''}
                      </p>
                      <div className="inline-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              'venue',
                              { id: v.id, visibility: 'visible' },
                              'Запись проверена и опубликована.',
                            )
                          }
                        >
                          Подтвердить запись
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              'venue',
                              { id: v.id, visibility: 'closed' },
                              'Заведение скрыто из каталога.',
                            )
                          }
                        >
                          Отметить закрытым
                        </button>
                        <select
                          aria-label={'Основная запись для ' + v.name}
                          value={targets[v.id] || ''}
                          onChange={(e) => setTargets({ ...targets, [v.id]: e.target.value })}
                        >
                          <option value="">Дубликат заведения…</option>
                          {s.venues
                            .filter((x: any) => x.id !== v.id && x.visibility === 'visible')
                            .map((x: any) => (
                              <option key={x.id} value={x.id}>
                                {x.name} · {x.address || x.id}
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={busy || !targets[v.id]}
                          onClick={() =>
                            act(
                              'venue',
                              { id: v.id, visibility: 'duplicate', duplicateOf: targets[v.id] },
                              'Дубль связан с основной записью и скрыт.',
                            )
                          }
                        >
                          Связать дубль
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {tab === 'Сотрудники' &&
                s.users.map((u: any) => (
                  <div className="admin-item" key={u.id}>
                    <strong>{u.email}</strong>
                    <p>
                      {describe(u.role)} {u.venue_id && '· ' + name(u.venue_id)}{' '}
                      {u.requested && '· Заявка: ' + name(u.requested)}
                    </p>
                    {u.role !== 'admin' && (
                      <div className="inline-actions">
                        <select
                          aria-label={'Назначить заведение для ' + u.email}
                          value={targets[u.id] ?? u.requested ?? u.venue_id ?? ''}
                          onChange={(e) => setTargets({ ...targets, [u.id]: e.target.value })}
                        >
                          <option value="">Без доступа сотрудника</option>
                          {s.venues
                            .filter((x: any) => x.visibility === 'visible')
                            .map((x: any) => (
                              <option key={x.id} value={x.id}>
                                {x.name} · {x.address || x.id}
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(
                              'assign',
                              {
                                userId: u.id,
                                venueId: targets[u.id] ?? u.requested ?? u.venue_id ?? null,
                              },
                              'Права сотрудника обновлены.',
                            )
                          }
                        >
                          Сохранить назначение
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              {tab === 'Предложения' &&
                (!s.offers.length ? (
                  <p>Предложений для проверки пока нет.</p>
                ) : (
                  s.offers.map((o: any) => (
                    <div className="admin-item" key={o.id}>
                      <strong>{o.title}</strong> · {name(o.venue_id)}
                      <p>{o.terms}</p>
                      <p>
                        {describe(o.state)} · {date(o.starts)} — {date(o.ends)} · лимит {o.max_uses}
                      </p>
                      <div className="inline-actions">
                        {[
                          ['approved', 'Одобрить'],
                          ['rejected', 'Снять с публикации'],
                        ].map(([state, t]) => (
                          <button
                            key={state}
                            disabled={busy}
                            onClick={() => act('moderate', { id: o.id, state }, 'Решение сохранено.')}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ))}
              {tab === 'Оплаты' && (
                <>
                  <h3>Периоды доступа</h3>
                  {!s.subscriptions.length && <p>Подписок пока нет.</p>}
                  {s.subscriptions.map((a: any) => (
                    <p key={a.user_id}>
                      {a.email} · пробный до {date(a.trial_until)} · платный до {date(a.paid_until)} ·
                      тестовый до {date(a.test_paid_until)}
                    </p>
                  ))}
                  <h3>Платежи</h3>
                  {!s.payments.length && <p>Платежей пока нет.</p>}
                  {s.payments.map((p: any) => (
                    <p key={p.id}>
                      {p.email} · {p.mode === 'test' ? 'Тест' : 'Боевой'} ·{' '}
                      {p.status === 'pending' ? 'Ожидает оплаты' : describe(p.status)} ·{' '}
                      {date(p.updated_at)}
                    </p>
                  ))}
                </>
              )}
              {tab === 'Журнал' &&
                s.audit.map((a: any) => (
                  <div className="admin-item" key={a.id}>
                    <b>{a.action}</b>
                    <p>
                      {date(a.at)}, {time(a.at)} · {a.actor} · {a.target}
                    </p>
                  </div>
                ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
