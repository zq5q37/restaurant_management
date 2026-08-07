import { createContext, useContext } from 'react';

/**
 * The theme context and its hook, kept out of ThemeProvider.jsx so that file exports only a
 * component — a module mixing components with plain functions loses fast refresh.
 */

export const THEMES = ['dark', 'light'];

/**
 * localStorage, not a cookie: the theme is a display preference with no security weight, it
 * is needed before the first paint (see the inline script in index.html), and a signed-out
 * visitor has no session to hang it on.
 */
export const STORAGE_KEY = 'rms-theme';

/** Browser UI colour per theme — the address bar on mobile, the title bar on desktop. */
export const BROWSER_CHROME = { dark: '#0c0a09', light: '#efece4' };

export const ThemeContext = createContext(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Reads the choice the inline boot script already resolved, so the two never disagree. */
export function currentTheme() {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.dataset.theme;
  return THEMES.includes(attr) ? attr : 'dark';
}

/**
 * Whether the reader has asked for less motion.
 *
 * Read at the moment it is needed rather than held in state: this decides whether an animation
 * runs at all, and a stale answer would either play motion someone opted out of or strand a
 * sequence waiting on an animationend that will never fire.
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function storedChoice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(raw) ? raw : null;
  } catch {
    // Private browsing and blocked storage both throw on access rather than returning null,
    // and a theme is not worth breaking the app over.
    return null;
  }
}
