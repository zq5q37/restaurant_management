import { useRef } from 'react';
import { useTheme } from './theme';

/**
 * An animated sun/moon theme toggle, after the 21st.dev component of the same name.
 *
 * That one is built on Tailwind and Framer Motion, neither of which this project has, and
 * pulling in a utility-class framework and an animation runtime for one button is a poor
 * trade. So the behaviour is rebuilt natively: one disc masked by a second circle that
 * slides across to bite out the crescent, rays retracting into the disc, and the whole glyph
 * counter-rotating — a mask offset and two transforms, which CSS transitions do as well as
 * any animation library. The page-wide sweep is the View Transitions API, no dependency
 * either. Both degrade cleanly to an instant change.
 */
function ThemeToggle() {
  const { theme, isDark, chooseFrom, followsSystem } = useTheme();
  const buttonRef = useRef(null);

  const next = isDark ? 'light' : 'dark';

  return (
    <button
      ref={buttonRef}
      type="button"
      className="theme-toggle"
      /*
       * A lone icon cannot say whether it shows the current state or the thing it will do,
       * so the label states the action and aria-pressed is deliberately absent — this is a
       * button that does something, not a control with an on and an off.
       */
      aria-label={`Switch to ${next} mode`}
      title={
        followsSystem
          ? `Switch to ${next} mode — currently following your system setting`
          : `Switch to ${next} mode`
      }
      data-theme-state={theme}
      onClick={() => chooseFrom(next, buttonRef.current)}
    >
      <svg className="theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <mask id="theme-toggle-crescent">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          {/* Parked outside the disc for the sun; slides over it to carve the crescent. */}
          <circle className="theme-toggle__bite" cx="24" cy="10" r="6" fill="black" />
        </mask>

        <circle
          className="theme-toggle__disc"
          cx="12"
          cy="12"
          r="5"
          mask="url(#theme-toggle-crescent)"
        />

        <g className="theme-toggle__rays" strokeLinecap="round">
          <line x1="12" y1="1.6" x2="12" y2="3.6" />
          <line x1="12" y1="20.4" x2="12" y2="22.4" />
          <line x1="1.6" y1="12" x2="3.6" y2="12" />
          <line x1="20.4" y1="12" x2="22.4" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="19.4" y1="4.6" x2="18" y2="6" />
          <line x1="6" y1="18" x2="4.6" y2="19.4" />
        </g>
      </svg>
    </button>
  );
}

export default ThemeToggle;
