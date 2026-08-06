/**
 * Every screen opens with the same band, so the app reads as one place: a Japanese kicker,
 * the title, one line of plain-English orientation, and — on the right — the single number
 * that screen is actually about.
 *
 * The right-hand slot is deliberately one number and one caption. A screen with four numbers
 * uses the stat band below the header instead; two competing summaries in one header means
 * neither gets read.
 */
function PageHead({ kicker, title, sub, sideValue, sideLabel }) {
  return (
    <header className="page-head">
      <div>
        {/* lang is set so a screen reader switches voice for the Japanese, and so the
            browser picks a Japanese face rather than substituting glyphs. */}
        {kicker && (
          <p className="page-head__kicker" lang="ja">
            {kicker}
          </p>
        )}
        <h1>{title}</h1>
        {sub && <p className="page-head__sub">{sub}</p>}
      </div>

      {sideValue != null && (
        <div className="page-head__side">
          <b>{sideValue}</b>
          {sideLabel && <span>{sideLabel}</span>}
        </div>
      )}
    </header>
  );
}

export default PageHead;
