import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';

export function NotFoundPage() {
  return (
    <main className="no-room">
      <b><SearchX /></b>
      <h1>Страница не найдена</h1>
      <p>Проверьте адрес или вернитесь в чат.</p>
      <Link to="/">Вернуться в чат</Link>
    </main>
  );
}
