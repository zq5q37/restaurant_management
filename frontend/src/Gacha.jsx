import { useEffect, useRef, useState } from 'react';
import { apiFetch, formatPrice } from './api';
import { DISH_JP, GACHA_JP } from './labels';
import { prefersReducedMotion } from './theme';
import './gacha.css';

/**
 * 一品ガチャ — the capsule machine that picks a dish for you.
 *
 * The toy is the surface. The server tilts the draw toward dishes that are both profitable and
 * overlooked (see backend/menu/gacha.js), so this is a merchandising device wearing a capsule
 * machine. None of that reasoning reaches the client: the response is one dish and nothing
 * about why it came out.
 *
 * COPY RULE: the word "random" appears nowhere in this component. The draw is weighted, and
 * the shop calling it random would be a lie about its own merchandising. "The machine picks
 * one dish for you" is true.
 */

/**
 * How long the machine shakes before the capsule can drop.
 *
 * A floor, not a delay. A localhost response lands in about four milliseconds, and a capsule
 * that pops before the handle has finished turning reads as a glitch rather than a machine.
 * The turn races this against the request (see turn()), so a slow network is never taxed an
 * extra 700ms on top of itself — the slower of the two governs.
 */
const SHAKE_MIN = 700;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a screen reader hears when the capsule opens — the same three facts that are on screen. */
function summarise(item) {
  const price = item.is_on_special
    ? `${formatPrice(item.effective_price_cents)} reduced from ${formatPrice(item.price_cents)}`
    : formatPrice(item.price_cents);
  return `Tonight's pick: ${item.name}, ${price}, from ${item.category_name}.`;
}

function Gacha({ token, categoryId, onSeeDish, onUnauthorized }) {
  const [phase, setPhase] = useState('idle'); // idle | turning | revealed | empty
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Separate from `phase`: the machine reaches `revealed` when the capsule starts falling, and
  // the dish is not shown until it has landed and burst. See openResult().
  const [showResult, setShowResult] = useState(false);

  const lastId = useRef(null); // fed back as ?exclude, so "Turn again" is a different capsule
  const drawSeq = useRef(0);
  const dialogRef = useRef(null);

  const closeResult = () => setShowResult(false);

  /**
   * The capsule bursting is what opens the dialog, so the dish appears at the moment the
   * capsule does — the CSS stays the single source of truth for the timing, with no JS timer
   * to drift from it.
   *
   * The handler is on the machine, where animationend bubbles up from the capsule and its
   * confetti alike, so it has to name the one animation it is waiting for.
   */
  const openResult = (event) => {
    if (event.animationName === 'gacha-burst') setShowResult(true);
  };

  /*
   * The reduced-motion path to the same place. Under `reduce` the keyframes in gacha.css never
   * attach, so animationend never fires and the dish would never be shown at all — the machine
   * would just sit there having drawn something it refuses to hand over.
   */
  useEffect(() => {
    if (phase === 'revealed' && prefersReducedMotion()) setShowResult(true);
  }, [phase, result]);

  /*
   * showModal(), not the `open` attribute — only the former is modal, and without it there is
   * no focus trap, no inert page behind and no Escape.
   *
   * Escape is intercepted rather than left to the dialog, and the default is prevented, for the
   * reason ShiftEditor.jsx documents: a dialog the browser closes on its own goes to
   * `open === false` while React still believes it is showing, and the two never agree again.
   * Driving the close through state keeps them in step.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (!dialog.open) dialog.showModal();

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowResult(false);
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [showResult]);

  /*
   * A capsule drawn from one course must not sit on screen while another is showing. Bumping
   * the sequence is what stops an in-flight draw from the old course landing after the reset.
   */
  useEffect(() => {
    drawSeq.current += 1;
    setPhase('idle');
    setResult(null);
    setError('');
    setShowResult(false);
    lastId.current = null;
  }, [categoryId]);

  async function turn() {
    // An early return rather than `disabled` on the button — see the aria-disabled note below.
    if (phase === 'turning') return;

    const seq = (drawSeq.current += 1);
    setPhase('turning');
    setError('');
    // Turning again from inside the dialog shuts it first: the machine has to be visible to be
    // worth watching, and a modal leaves the page behind it inert.
    setShowResult(false);

    const params = new URLSearchParams();
    if (categoryId) params.set('category_id', categoryId);
    if (lastId.current) params.set('exclude', String(lastId.current));

    try {
      /*
       * Raced, not chained. Awaiting the delay *after* the response would add SHAKE_MIN to
       * every draw on a real connection; Promise.all lets the slower of the two govern, so the
       * animation gets a floor and never becomes a tax. Getting this backwards is invisible on
       * localhost, which is exactly where it would be written.
       */
      const [data] = await Promise.all([
        apiFetch(`/api/gacha?${params}`, { token }),
        sleep(prefersReducedMotion() ? 0 : SHAKE_MIN),
      ]);

      if (drawSeq.current !== seq) return; // a newer turn, or a course change, won

      if (!data.item) {
        setResult(data);
        setPhase('empty');
        return;
      }

      lastId.current = data.item.id;
      setResult(data);
      setPhase('revealed');
    } catch (err) {
      if (drawSeq.current !== seq) return;
      if (err.status === 401) return onUnauthorized();
      setError(err.message);
      // Keep the capsule already on screen rather than blanking the machine over one failure.
      setPhase(result?.item ? 'revealed' : 'idle');
    }
  }

  const item = result?.item ?? null;

  return (
    <section className={`gacha gacha--${phase}`} aria-labelledby="gacha-title">
      {/* Decoration end to end. A screen reader must never be made to walk a capsule. */}
      <div className="gacha__machine" aria-hidden="true" onAnimationEnd={openResult}>
        <div className="gacha__globe">
          {/* Eight capsules in the dome, one of which is the one that drops. */}
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="gacha__ball" style={{ '--i': i }} />
          ))}
        </div>

        <div className="gacha__body-plate">
          <span className="gacha__handle" />
          <span className="gacha__slot" />
        </div>

        <div className="gacha__tray">
          <span className="gacha__prize-ball">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="gacha__confetti" style={{ '--i': i }} />
            ))}
          </span>
        </div>
      </div>

      <div className="gacha__panel">
        {/* <p className="gacha__kicker" lang="ja">
          {GACHA_JP.title}
        </p> */}
        <h2 id="gacha-title" className="gacha__title">
          Can&rsquo;t decide?
        </h2>
        <p className="gacha__sub">Turn the dial and the machine picks one dish for you.</p>

        {/*
          aria-disabled rather than disabled. A focused element that becomes `disabled` has
          focus taken from it and dropped on <body> — so the keyboard user who just pressed the
          dial would be thrown to the top of the document mid-draw. The early return in turn()
          gives the same protection against a double press without moving anyone's place.
        */}
        <button
          type="button"
          className="gacha__dial"
          onClick={turn}
          aria-disabled={phase === 'turning'}
          aria-label="Turn the dial for a dish recommendation"
        >
          {phase === 'turning' ? 'Turning…' : item ? 'Turn again' : 'Turn the dial'}
        </button>

        {/*
          In the DOM from first render, empty. A live region inserted at the same moment its
          text appears is missed by several screen readers — the region has to already exist to
          be watched.

          Deliberately NOT used for the result: the dialog announces itself when focus enters
          it, so announcing here too would speak the dish twice in a row. This carries only the
          states no dialog opens for.
        */}
        <p className="gacha__status" role="status">
          {phase === 'turning' ? 'Turning the dial…' : ''}
          {phase === 'empty' ? 'The machine is empty — nothing is on the menu tonight.' : ''}
        </p>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

      </div>

      {/*
        What came out of the capsule, over the page rather than under the machine.

        A native <dialog> carries the modal behaviour the moment matters most: focus goes to
        the dish and is trapped there, the menu behind goes inert, and the backdrop dims it —
        which is the point of a prize, that it is the only thing on screen for a second.

        Its accessible name is the whole sentence, so a screen reader hears the dish, the price
        and the course as focus enters. That replaces the tabindex="-1" panel this used to be:
        a dialog announces itself, and doing both would say it twice.
      */}
      {showResult && item && (
        <dialog
          className="gacha__result"
          ref={dialogRef}
          aria-label={summarise(item)}
          /* Clicking outside a native dialog does nothing on its own, and a prize you cannot
             dismiss by tapping the dark part is a prize you feel stuck in. The target is the
             dialog itself only when the click landed on its backdrop. */
          onClick={(event) => {
            if (event.target === dialogRef.current) closeResult();
          }}
        >
          <p className="gacha__result-kicker" lang="ja">
            {GACHA_JP.title}
          </p>

          {item.image_path && (
            <img
              className="gacha__result-image"
              src={`/api/images/${item.image_path}`}
              alt={item.name}
            />
          )}

          <h3 className="gacha__result-name">{item.name}</h3>

          {DISH_JP[item.name] && (
            <p className="menu-card__jp" lang="ja">
              {DISH_JP[item.name]}
            </p>
          )}

          {/* Same markup as MenuCard's price, so the app has one price presentation. */}
          <p className="menu-card__price">
            {item.is_on_special ? (
              <>
                <s>{formatPrice(item.price_cents)}</s>
                <strong>{formatPrice(item.effective_price_cents)}</strong>
                <span className="badge badge--special">Special</span>
              </>
            ) : (
              <strong>{formatPrice(item.price_cents)}</strong>
            )}
          </p>

          {/* <p className="gacha__caption">
            {result.draw.repeated
              ? 'It is the only dish in the machine tonight.'
              : `1 of ${result.draw.pool_size} dishes in the machine tonight.`}
          </p> */}

          <div className="gacha__actions">
            <button
              type="button"
              onClick={() => {
                // Closed first: the dialog is modal, so the card it scrolls to would be inert
                // and hidden behind the backdrop if it were still open.
                closeResult();
                onSeeDish(item);
              }}
            >
              See dish
            </button>
            <button type="button" className="button--ghost" onClick={turn}>
              Turn again
            </button>
            <button type="button" className="button--ghost" onClick={closeResult}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}

export default Gacha;
