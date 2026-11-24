'use client';
import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { api, date, Modal, User, Venue } from './shared';
type Props = {
  mode: string;
  user: User | null;
  venues: Venue[];
  access: string;
  onClose: () => void;
  onMode: (s: string) => void;
  identity: (merge?: boolean) => Promise<User | null>;
};
export default function Account({ mode, user, venues, access, onClose, onMode, identity }: Props) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [venueId, setVenue] = useState(venues[0]?.id || '');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [fromPlus, setFromPlus] = useState(false);
  useEffect(() => {
    setMessage('');
    setConsent(false);
    if (mode === 'plus' && user) {
      const returned = new URLSearchParams(location.search).has('payment');
      api(returned ? 'billing/refresh' : 'billing/summary', returned ? {} : undefined)
        .then(setDetails)
        .catch((e) => setMessage(e.message));
      if (returned) history.replaceState(null, '', '/');
    }
  }, [mode, user?.id]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  const [codes, setCodes] = useState<any[] | null>(null);
  const login = () => {
    setFromPlus(true);
    onMode('account');
  };
  const statusLabels: Record<string, string> = {
    creating: 'создаётся',
    pending: 'ожидает оплаты',
    succeeded: 'успешно',
    failed: 'ошибка',
    canceled: 'отменён',
  };
  return (
    <Modal
      title={
        mode === 'plus'
          ? 'ГдеЕдим? Плюс'
          : user
            ? 'Ваш аккаунт'
            : register
              ? 'Создать аккаунт'
              : 'Вход в аккаунт'
      }
      onClose={onClose}
    >
      {mode === 'plus' ? (
        <>
          <div className="plus-splash">
            <Sparkles size={26} />
            <h3>Предложения для своих</h3>
            <p>Скидки и промокоды от заведений района.</p>
          </div>
          <div className="plan-price">
            299 ₽ <small>/ месяц</small>
          </div>
          <p>
            Первые 14 дней бесплатно. Затем вы сами решаете, продлевать ли подписку. Оплата вручную,
            автоматических списаний нет. Карта и данные о столиках бесплатны.
          </p>
          {user && details?.active && (
            <p className="notice">
              {details.kind === 'trial' ? 'Пробный период' : 'Подписка'} действует до{' '}
              {date(details.expiresAt)}.
            </p>
          )}
          {!user ? (
            <button className="primary" onClick={login}>
              Войти для подключения
            </button>
          ) : (
            details && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  Принимаю условия выбранного периода и подтверждаю подключение.
                </label>
                {!details.trialUsed && !details.active && (
                  <button
                    className="primary"
                    disabled={!consent || busy}
                    onClick={() =>
                      run(async () => {
                        setDetails(await api('billing/trial', { consent }));
                        setMessage('Пробный период подключён.');
                      })
                    }
                  >
                    Попробовать на 14 дней
                  </button>
                )}
                {details.paymentsConfigured ? (
                  <button
                    disabled={!consent || busy}
                    onClick={() =>
                      run(async () => {
                        const p = await api('billing/create', { consent });
                        if (p.confirmationUrl) location.assign(p.confirmationUrl);
                        else setDetails(await api('billing/refresh', {}));
                      })
                    }
                  >
                    {details.paymentMode === 'test' ? 'Тестовая оплата · 299 ₽' : 'Продлить за 299 ₽'}
                  </button>
                ) : (
                  <p className="soft-block">Приём платежей пока не подключён.</p>
                )}
                {details.lastPayment && (
                  <p>
                    Последний платёж · {statusLabels[details.lastPayment.status]}{' '}
                    <button
                      className="text-btn"
                      onClick={() => run(async () => setDetails(await api('billing/refresh', {})))}
                    >
                      Проверить статус
                    </button>
                  </p>
                )}
                {details.active && (
                  <button
                    className="text-btn"
                    onClick={() =>
                      run(async () => {
                        setDetails(await api('billing/cancel', {}));
                        setMessage('Продление отключено. Доступ сохранён до конца периода.');
                      })
                    }
                  >
                    Отказаться от продления
                  </button>
                )}
              </>
            )
          )}
        </>
      ) : !user ? (
        <>
          <p className="muted">
            {access === 'admin'
              ? 'Требуется аккаунт администратора.'
              : access === 'partner'
                ? 'Войдите, чтобы открыть кабинет или подать заявку сотрудника.'
                : 'Сохраняйте любимые места и пользуйтесь предложениями заведений.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(register ? 'register' : 'login', { email, password });
                setPassword('');
                const u = await identity(true);
                if (access && u?.role === access) location.assign('/' + access);
                else if (fromPlus) onMode('plus');
              });
            }}
          >
            <label>
              Электронная почта
              <input
                type="email"
                autoComplete="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Пароль
              <input
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                minLength={register ? 10 : 1}
                maxLength={192}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {register && <small>Не меньше 10 символов.</small>}
            <button className="primary" disabled={busy}>
              {register ? 'Создать аккаунт' : 'Войти'}
            </button>
          </form>
          <button
            className="text-btn"
            onClick={() => {
              setRegister(!register);
              setMessage('');
            }}
          >
            {register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}
          </button>
        </>
      ) : (
        <>
          <p>
            <b>{user.email}</b>
          </p>
          {access === 'admin' && user.role !== 'admin' && (
            <p className="notice">Раздел доступен только администратору.</p>
          )}
          {user.role === 'partner' && (
            <a className="primary block-link" href="/partner">
              Кабинет заведения
            </a>
          )}
          {user.role === 'admin' && (
            <a className="primary block-link" href="/admin">
              Панель администратора
            </a>
          )}
          <button className="block-link" onClick={() => onMode('plus')}>
            <Sparkles size={16} /> Управление подпиской
          </button>
          <button
            className="block-link"
            onClick={() => run(async () => setCodes((await api('my-codes')).codes))}
          >
            Мои промокоды
          </button>
          {codes &&
            (!codes.length ? (
              <p>Доступных промокодов пока нет.</p>
            ) : (
              codes.map((c) => (
                <div key={c.ticket} className="soft-block">
                  <b>
                    {c.name} · {c.title}
                  </b>
                  <p>
                    {c.code} · № {c.ticket}
                  </p>
                  <p>{c.used_at ? 'Погашен' : 'Действует до ' + date(c.ends)}</p>
                </div>
              ))
            ))}
          {user.role === 'user' && (
            <details open={access === 'partner' || undefined}>
              <summary>Я сотрудник заведения</summary>
              <p>Выберите место работы. Администратор проверит полномочия и откроет доступ.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api('apply', { venueId });
                    setMessage('Заявка на доступ передана администратору.');
                  });
                }}
              >
                <label>
                  Ваше заведение
                  <select value={venueId} onChange={(e) => setVenue(e.target.value)}>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.address || 'без адреса'}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy || !venueId}>Подать заявку</button>
              </form>
            </details>
          )}
          <button
            className="text-btn"
            onClick={() =>
              run(async () => {
                await api('logout', {});
                await identity();
                onClose();
              })
            }
          >
            Выйти из аккаунта
          </button>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
