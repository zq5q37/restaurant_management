import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BROWSER_CHROME,
  STORAGE_KEY,
  ThemeContext,
  currentTheme,
  prefersReducedMotion,
  storedChoice,
} from './theme';

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(currentTheme);

  // Tracked separately from the theme value, because "dark because the OS is dark" and
  // "dark because I chose it" behave differently: only the first follows an OS change.
  const [followsSystem, setFollowsSystem] = useState(() => storedChoice() === null);

  // The attribute is the single source of truth for CSS, so it is written here rather than
  // in the toggle — any future caller of setTheme gets the side effect for free.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', BROWSER_CHROME[theme]);
  }, [theme]);

  useEffect(() => {
    if (!followsSystem) return undefined;

    const query = window.matchMedia('(prefers-color-scheme: light)');
    const sync = () => setTheme(query.matches ? 'light' : 'dark');
    sync();

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [followsSystem]);

  const choose = useCallback((next) => {
    setFollowsSystem(false);
    setTheme(next);
    // Applied here as well as in the effect above, because a view transition snapshots the
    // DOM the moment its callback returns and React's state update has not landed by then.
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference is lost on reload, which is a smaller failure than throwing here.
    }
  }, []);

  /**
   * Switches the theme as a circular reveal growing from `origin`, using the View
   * Transitions API. Falls straight through to `choose` where the API is missing (Firefox
   * and Safari at time of writing) or where the reader has asked for less motion — a theme
   * switch is not worth a polyfill, and it works identically without the sweep.
   */
  const chooseFrom = useCallback(
    (next, origin) => {
      const reduced = prefersReducedMotion();

      /*
       * The visibility check is not defensive padding — a view transition on a hidden
       * document aborts, and when it aborts this early the update callback is never invoked,
       * so putting the theme change inside that callback would silently lose it.
       */
      const canAnimate =
        !reduced &&
        typeof document.startViewTransition === 'function' &&
        document.visibilityState === 'visible' &&
        origin;

      if (!canAnimate) {
        choose(next);
        return;
      }

      const box = origin.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      // Radius that reaches the furthest corner, so the circle always clears the viewport.
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );

      const transition = document.startViewTransition(() => choose(next));

      // Last line of defence: a transition can abort for reasons we cannot test for, and
      // losing the user's click is far worse than losing the sweep.
      const ensureApplied = () => {
        if (document.documentElement.dataset.theme !== next) choose(next);
      };
      transition.finished.then(ensureApplied, ensureApplied);

      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${radius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 520,
              easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
              // Only the incoming snapshot is clipped; the outgoing one stays underneath,
              // which is what makes it read as a wipe rather than a fade.
              pseudoElement: '::view-transition-new(root)',
            }
          );
        })
        .catch(() => {
          // Aborts are harmless here: `choose` already ran inside the callback, so the
          // theme, the attribute and localStorage are all applied. The sweep is decoration.
        });
    },
    [choose]
  );

  const value = useMemo(
    () => ({
      theme,
      followsSystem,
      isDark: theme === 'dark',
      choose,
      chooseFrom,
    }),
    [theme, followsSystem, choose, chooseFrom]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export default ThemeProvider;
