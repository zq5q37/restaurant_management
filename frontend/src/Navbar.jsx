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
    <nav>
      <strong>Restaurant Management</strong>

      <ul>
        {visible.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onNavigate(item.key)}
              aria-current={current === item.key ? 'page' : undefined}
              disabled={current === item.key}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <span>
        {user.full_name} ({user.role})
      </span>{' '}
      <button type="button" onClick={onLogout}>
        Log out
      </button>
      <hr />
    </nav>
  );
}

export { NAV_ITEMS };
export default Navbar;
