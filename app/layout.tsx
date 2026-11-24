import type { Metadata } from 'next';
import './style.css';
export const metadata: Metadata = {
  title: 'ГдеЕдим? — гастрогид Ново-Переделкино',
  description:
    'Кафе, рестораны и кофейни района на одной карте. Наличие столиков и предложения заведений.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="stylesheet" href="/map.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
