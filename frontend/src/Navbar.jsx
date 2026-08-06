import ThemeToggle from './ThemeToggle';

// Which roles see which link, per docs/permission-matrix.md.
// This is presentation only — hiding a link is not access control. The server enforces the
// real rules, so a user who guesses a route still gets 403 from the API.
const NAV_ITEMS = [
  { key: 'menu', label: 'Menu', roles: ['customer', 'staff', 'manager', 'admin'] },
  { key: 'schedule', label: 'Schedule', roles: ['staff', 'manager', 'admin'] },
  { key: 'analytics', label: 'Analytics', roles: ['manager', 'admin'] },
  { key: 'users', label: 'Users', roles: ['manager', 'admin'] },
  { key: 'profile', label: 'Profile', roles: ['customer', 'staff', 'manager', 'admin'] },
];

function Navbar({ user, current, onNavigate, onLogout }) {
  const visible = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <header className="app-header">
      {/*
        The enso crop of the shop's logo. Empty alt and aria-hidden because the wordmark
        beside it already says the name — a screen reader announcing "Rokushichi Rokushichi"
        is worse than silence. At this size the lettering inside the circle is illegible,
        which is why the name is set as text.
      */}
      <span className="brand">
        <img className="brand__mark" src="/logo-mark.webp" alt="" aria-hidden="true" width="96" height="96" />
        <span className="brand__name">Rokushichi</span>
      </span>

      <nav className="app-nav" aria-label="Sections">
        {visible.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            aria-current={current === item.key ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="app-user">
        {/* Before the identity block: appearance is a display preference, not an account one. */}
        <ThemeToggle />
        <span>
          <strong>{user.full_name}</strong> · {user.role}
        </span>
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}

export { NAV_ITEMS };
export default Navbar;
