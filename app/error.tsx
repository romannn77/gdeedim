'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="panel standalone">
      <h1>Не удалось открыть страницу</h1>
      <p>Проверьте подключение к базе данных и повторите попытку.</p>
      <button onClick={reset}>Попробовать снова</button>
    </main>
  );
}
