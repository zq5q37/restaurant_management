import { useEffect, useState } from 'react';
import Login from './Login';

const TOKEN_KEY = 'auth_token';

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
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

  return (
    <div>
      <h1>Signed in</h1>
      <ul>
        <li>Name: {user.full_name}</li>
        <li>Email: {user.email}</li>
        <li>Role: {user.role}</li>
      </ul>
      <button onClick={handleLogout}>Log out</button>
    </div>
  );
}

export default App;
