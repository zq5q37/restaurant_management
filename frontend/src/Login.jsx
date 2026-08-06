import { useState } from 'react';
import ThemeToggle from './ThemeToggle';

// Seeded by backend/db/seed.js. Rendered only under `import.meta.env.DEV`, so Vite strips
// this block from a production build — these accounts must never be shown on a real site.
const SEED_PASSWORD = 'Passw0rd!23';
const SEED_ACCOUNTS = [
  'customer@example.com',
  'staff@example.com',
  'manager@example.com',
  'admin@example.com',
];

function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        // The server deliberately returns one message for every failure reason.
        setError(data.error || 'Login failed');
        return;
      }
      onSuccess(data);
    } catch {
      setError('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-main signin">
      <div className="signin__toggle">
        <ThemeToggle />
      </div>

      <div className="page--narrow">
        {/*
          The full lockup rather than the enso crop: this is the one screen with room for the
          whole sign, and it is what tells a visitor which shop they have arrived at.
        */}
        <img className="signin-logo" src="/logo-lockup.webp" alt="Rokushichi — Japanese cuisine" />

        <form onSubmit={handleSubmit} className="signin__form">
          <h1 className="signin__title">Sign in</h1>
          <p className="hint">Staff and guests use the same door.</p>

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <button type="submit" className="signin__submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>

        {import.meta.env.DEV && (
          <div className="signin__seed">
            <p className="hint">
              Dev seed accounts &mdash; password for all: <code>{SEED_PASSWORD}</code>
            </p>
            <ul className="chip-row">
              {SEED_ACCOUNTS.map((seedEmail) => (
                <li key={seedEmail}>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setEmail(seedEmail);
                      setPassword(SEED_PASSWORD);
                      setError('');
                    }}
                  >
                    {seedEmail.split('@')[0]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

export default Login;
