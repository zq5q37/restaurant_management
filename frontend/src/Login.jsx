import { useState } from 'react';

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
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>

      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Logging in...' : 'Log in'}
      </button>

      {error && <p role="alert">{error}</p>}

      {import.meta.env.DEV && (
        <div>
          <hr />
          <p>
            Dev seed accounts &mdash; password for all: <code>{SEED_PASSWORD}</code>
          </p>
          <ul>
            {SEED_ACCOUNTS.map((seedEmail) => (
              <li key={seedEmail}>
                <code>{seedEmail}</code>{' '}
                <button
                  type="button"
                  onClick={() => {
                    setEmail(seedEmail);
                    setPassword(SEED_PASSWORD);
                    setError('');
                  }}
                >
                  fill
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

export default Login;
