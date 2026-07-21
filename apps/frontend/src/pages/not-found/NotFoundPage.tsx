import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';

export function NotFoundPage() {
  return (
    <main className="no-room">
      <b><SearchX /></b>
      <h1>Page not found</h1>
      <p>Check the address or return to the chat.</p>
      <Link to="/">Return to chat</Link>
    </main>
  );
}
