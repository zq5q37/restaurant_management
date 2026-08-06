import { useEffect, useState } from 'react';
import Login from './Login';
import Navbar, { NAV_ITEMS } from './Navbar';
import Profile from './Profile';
import Menu from './Menu';
import Schedule from './Schedule';
import Users from './Users';
import Analytics from './Analytics';

const TOKEN_KEY = 'auth_token';

// Nav links exist for pages that are still to be built, so the fallback below needs to know
// which ones actually render something.
const IMPLEMENTED_PAGES = ['menu', 'schedule', 'analytics', 'users', 'profile'];

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [page, setPage] = useState('menu');

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setPage('menu');
  }

  // After a page reload we have a token but no user object, so ask the server who it belongs to.
  // This doubles as the expiry check: an expired or revoked token gets a 401 and logs us out.
  useEffect(() => {
    if (!token) return;

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => setUser(data.user))
      .catch(() => handleLogout())
      .finally(() => setChecking(false));
  }, [token]);

  function handleLogin({ token: newToken, user: newUser }) {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }

  if (token && checking) return <p>Loading...</p>;
  if (!user) return <Login onSuccess={handleLogin} />;

  const label = NAV_ITEMS.find((item) => item.key === page)?.label ?? page;

  return (
    <div>
      <Navbar user={user} current={page} onNavigate={setPage} onLogout={handleLogout} />

      <main>
        <h1>{label}</h1>
        {page === 'menu' && (
          <Menu token={token} user={user} onUnauthorized={handleLogout} />
        )}
        {page === 'schedule' && (
          <Schedule token={token} user={user} onUnauthorized={handleLogout} />
        )}
        {page === 'analytics' && (
          <Analytics token={token} user={user} onUnauthorized={handleLogout} />
        )}
        {page === 'users' && (
          <Users token={token} user={user} onUnauthorized={handleLogout} />
        )}
        {page === 'profile' && (
          <Profile
            token={token}
            user={user}
            onUpdated={setUser}
            onUnauthorized={handleLogout}
          />
        )}
        {!IMPLEMENTED_PAGES.includes(page) && <p>Nothing here yet.</p>}
      </main>
    </div>
  );
}

export default App;
