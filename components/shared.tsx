'use client';
import { useEffect, useRef } from 'react';
import {
  Utensils,
  X,
  Coffee,
  Soup,
  UtensilsCrossed,
  Heart,
  MapPinned,
  Tag,
  Sparkles,
  UserRound,
} from 'lucide-react';
export type Offer = {
  id: string;
  venueId: string;
  title: string;
  terms: string;
  starts: string | number;
  ends: string | number;
};
export type Venue = {
  id: string;
  name: string;
  type: 'restaurant' | 'cafe' | 'coffee';
  lat: number;
  lon: number;
  address: string | null;
  hours: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null;
  status: string | null;
  party: number | null;
  updatedAt: number | null;
  measuredAt: number | null;
  occupancy: number | null;
  offers: Offer[];
  partner: boolean;
};
export type Catalog = { demo: boolean; ttl: number; last: any; venues: Venue[] };
export type User = { id: string; email: string; role: string; venueId: string | null };
export const types = { restaurant: 'Ресторан', cafe: 'Кафе', coffee: 'Кофейня' };
export const states: Record<string, string> = {
  free: 'Есть свободные столики',
  few: 'Осталось мало мест',
  full: 'Свободных столиков нет',
};
export function statusName(v: Venue) {
  return v.status ? states[v.status] : v.updatedAt ? 'Нет свежих данных' : 'Нет данных';
}
export const date = (v: any) =>
  v
    ? new Date(typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Moscow',
      })
    : '—';
export const time = (v: any) =>
  new Date(Number(v)).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
export function ago(v: number) {
  const m = Math.max(0, Math.floor((Date.now() - v) / 60000));
  return m === 0 ? 'только что' : m < 60 ? m + ' мин назад' : date(v) + ' в ' + time(v);
}
export function hours(s: string) {
  const days: Record<string, string> = {
    Mo: 'Пн',
    Tu: 'Вт',
    We: 'Ср',
    Th: 'Чт',
    Fr: 'Пт',
    Sa: 'Сб',
    Su: 'Вс',
    PH: 'праздники',
    off: 'закрыто',
  };
  return s
    .replace(/Mo-Su/g, 'Ежедневно')
    .replace(/Mo|Tu|We|Th|Fr|Sa|Su|PH|off/g, (x) => days[x])
    .replace(/24\/7/g, 'Круглосуточно')
    .replaceAll(';', ' ·');
}
export async function api(path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(
      '/api/' + path,
      body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
          },
    );
  } catch {
    throw Error('Не удалось связаться с сервером. Проверьте соединение.');
  }
  const data = await r.json().catch(() => ({ error: 'Сервер временно недоступен.' }));
  if (!r.ok) throw Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
export function Brand() {
  return (
    <a className="brand" href="/" aria-label="ГдеЕдим? Главная">
      <span className="brand-icon">
        <Utensils size={23} strokeWidth={2.5} />
      </span>
      <span>
        ГдеЕдим<b>?</b>
      </span>
    </a>
  );
}
export function TypeIcon({ type, size = 23 }: { type: Venue['type']; size?: number }) {
  const Icon = { restaurant: UtensilsCrossed, coffee: Coffee, cafe: Soup }[type];
  return <Icon size={size} strokeWidth={1.7} />;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export const tabs = [
  { id: 'map', text: 'Карта', Icon: MapPinned },
  { id: 'favorites', text: 'Избранное', Icon: Heart },
  { id: 'offers', text: 'Предложения', Icon: Tag },
];
export function Header({
  tab,
  user,
  onTab,
  onAccount,
  onPlus,
}: {
  tab: string;
  user: User | null;
  onTab: (s: string) => void;
  onAccount: () => void;
  onPlus: () => void;
}) {
  return (
    <header className="header">
      <div className="shell header-inner">
        <Brand />
        <nav aria-label="Разделы гида">
          {tabs.map(({ id, text, Icon }) => (
            <button key={id} className={tab === id ? 'nav active' : 'nav'} onClick={() => onTab(id)}>
              <Icon size={17} />
              {text}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="plus" onClick={onPlus}>
            <Sparkles size={16} />
            Плюс
          </button>
          <button className="account" onClick={onAccount}>
            <UserRound size={18} />
            {user ? 'Аккаунт' : 'Войти'}
          </button>
        </div>
      </div>
    </header>
  );
}
