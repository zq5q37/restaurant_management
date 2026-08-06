import { useEffect, useState } from 'react';
import Login from './Login';
import Navbar from './Navbar';
import Profile from './Profile';
import Menu from './Menu';
import Schedule from './Schedule';
import Users from './Users';
import Analytics from './Analytics';
import ThemeProvider from './ThemeProvider';

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

  // The shell wraps the signed-out state too, so the sign-in screen is the shop's front
  // door rather than a bare form on a white page.
  return (
    <ThemeProvider>
      <div className="app-shell">
        {token && checking ? (
          <main className="app-main">
            <p className="loading">Loading...</p>
          </main>
        ) : !user ? (
          <Login onSuccess={handleLogin} />
        ) : (
          <>
            <Navbar user={user} current={page} onNavigate={setPage} onLogout={handleLogout} />

            <main className="app-main">
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
              {!IMPLEMENTED_PAGES.includes(page) && (
                <p className="loading">Nothing here yet.</p>
              )}
            </main>
          </>
        )}

        <footer className="app-foot">
          <span>Rokushichi</span>
          <span>Kitchen open 18:00 &ndash; 21:30</span>
        </footer>
      </div>
    </ThemeProvider>
  );
}

export default App;
