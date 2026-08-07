import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// The width at which index.css folds the bar into the hamburger. Duplicated here because the
// open state has to be dropped when the layout stops being the collapsed one: a menu opened
// narrow and then widened past this — a rotation, a window drag — would otherwise leave a
// toggle that no longer exists reporting itself as expanded.
const COLLAPSED = '(max-width: 915px)';

function Navbar({ user, current, onNavigate, onLogout }) {
  const visible = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const [open, setOpen] = useState(false);
  const headerRef = useRef(null);

  /*
   * The bar is fixed, so it is out of flow and the shell has to reserve its row. That height
   * is measured rather than written down: the bar sizes itself from its own content in rem,
   * so a hardcoded offset would drift the moment a link is added, a webfont swaps in, or the
   * reader's base font size is not 16px — and the failure is the page's first line sitting
   * under the bar, which is exactly the thing nobody notices in their own browser.
   */
  useLayoutEffect(() => {
    // While the panel is open the header contains that too, and the panel is not what the
    // page has to clear — it hangs over the content. The bar's own height cannot change
    // while it is open, so the value published on the way in is still the right one.
    if (open) return undefined;

    const header = headerRef.current;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--app-header-h',
        `${entry.target.getBoundingClientRect().height}px`
      );
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, [open]);

  // Signing out unmounts the header, and the sign-in screen shares the shell — leaving the
  // offset behind would open it with a bar's worth of empty space above the form.
  useEffect(() => () => document.documentElement.style.removeProperty('--app-header-h'), []);

  useEffect(() => {
    if (!open) return undefined;

    const collapsed = window.matchMedia(COLLAPSED);
    const onWidthChange = (event) => {
      if (!event.matches) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // The panel floats over the page, so a tap on the page below means "not this" — the
    // dismissal every overlay is expected to have, and the reason the panel needs no backdrop.
    const onPointerDown = (event) => {
      if (!headerRef.current.contains(event.target)) setOpen(false);
    };

    collapsed.addEventListener('change', onWidthChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      collapsed.removeEventListener('change', onWidthChange);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Following a link is what closes the panel — it covers the page below it, so leaving it
  // open after a jump would hide the thing the user just asked for.
  const navigate = (key) => {
    setOpen(false);
    onNavigate(key);
  };

  return (
    <header className="app-header" ref={headerRef} data-menu-open={open ? 'true' : 'false'}>
      {/*
        The enso crop of the shop's logo. Empty alt and aria-hidden because the wordmark
        beside it already says the name — a screen reader announcing "Rokushichi Rokushichi"
        is worse than silence. At this size the lettering inside the circle is illegible,
        which is why the name is set as text.
      */}
      <span className="brand">

        <span className="brand__name">Rokushichi</span>
      </span>

      {/*
        Shown only under the collapse breakpoint, where it is the whole bar's controls.
        "Sections", matching the nav landmark below, rather than the usual "Menu" — one of the
        links it reveals is the food menu, and two different "Menu" buttons in one header is a
        collision in a restaurant app specifically. The name also stays put between states
        instead of flipping to "Close": aria-expanded already carries open versus shut, and a
        name that changes underneath a screen reader user reads as a different button.
      */}
      <button
        type="button"
        className="nav-toggle"
        aria-label="Sections"
        aria-expanded={open}
        aria-controls="app-menu"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <svg className="nav-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
          <line className="nav-toggle__bar nav-toggle__bar--top" x1="4" y1="7" x2="20" y2="7" />
          <line className="nav-toggle__bar nav-toggle__bar--mid" x1="4" y1="12" x2="20" y2="12" />
          <line className="nav-toggle__bar nav-toggle__bar--end" x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {/*
        The panel the hamburger opens. On a wide screen it is `display: contents`, so the nav
        and the identity block stay direct children of the header's flex row and the full-width
        bar is unchanged — the wrapper exists for the collapsed layout alone.
      */}
      <div className="app-menu" id="app-menu">
        <nav className="app-nav" aria-label="Sections">
          {visible.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.key)}
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
      </div>
    </header>
  );
}

export { NAV_ITEMS };
export default Navbar;
