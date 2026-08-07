/**
 * How the dish gacha decides what falls out of the capsule.
 *
 * The toy is the surface. Underneath it the draw is tilted toward dishes that are BOTH
 * profitable AND overlooked — the ones that earn their keep and that nobody scrolls far enough
 * to reach. It is a merchandising device wearing a capsule machine.
 *
 * Everything here is arithmetic on plain objects. The SQL lives in analytics/queries.js and the
 * HTTP in routes/gacha.js, so this file can be reasoned about — and re-run over the whole menu
 * by db/gacha-weights.js — without a database or a request in sight.
 *
 * REJECTED: computing the weights on the client. The inputs are cost_cents and view history;
 * shipping either to a browser to shuffle there would publish the shop's margins to every
 * customer who opened devtools. The client is told which dish came out and nothing about why.
 */

const { effectivePriceCents } = require('./pricing');

/** Matches DEFAULT_DAYS in routes/analytics.js, so "overlooked" here and "unpopular" in the
    manager's report are the same measurement rather than two that can disagree. */
const VIEW_WINDOW_DAYS = 30;

/** The two halves of "high margin AND overlooked". They are meant to sum to 1. */
const W_MARGIN = 0.5;
const W_OVERLOOKED = 0.5;

/** Turns the weighted sum into an AND — see weightOf(). */
const GAMMA = 2;

/** Every dish keeps at least this much weight, which is what makes it a gacha. See weightOf(). */
const FLOOR = 0.15;

/** Used only when there is no priced dish at all to take a median of. */
const NEUTRAL_FALLBACK = 0.5;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Min-max onto [0,1]. A flat input carries no information — every dish scoring the same means
 * the axis cannot discriminate — so it collapses to neutral rather than dividing by zero.
 */
function normalise(values) {
  const known = values.filter((v) => v != null);
  if (!known.length) return { scale: () => NEUTRAL_FALLBACK, flat: true };

  const lo = Math.min(...known);
  const hi = Math.max(...known);
  if (hi === lo) return { scale: () => NEUTRAL_FALLBACK, flat: true };

  return { scale: (v) => (v - lo) / (hi - lo), flat: false };
}

/**
 * Contribution margin in cents, or null when the cost has never been entered.
 *
 * Off the EFFECTIVE price, not the list price: the special is what the customer pays, so it is
 * what the shop banks. Using the list price would make the machine push discounted dishes
 * hardest — precisely backwards, since a special is already a promotion and does not need a
 * second one. It also keeps one definition of margin in the app; menuProfitability() in
 * analytics/queries.js already works off the effective price.
 *
 * Cents rather than percent, because rent is paid in cents. A 79%-margin $7 salad contributes
 * less per cover than a 34%-margin $28 hotpot, and the gacha promotes whichever actually pays.
 *
 * A negative margin is not special-cased. A dish sold below cost is a loss leader; it lands at
 * the bottom of the scale and FLOOR keeps it drawable. Least promoted, never banned.
 */
const marginCentsOf = (row) =>
  row.cost_cents == null ? null : effectivePriceCents(row) - row.cost_cents;

/**
 * How overlooked a dish is, before normalisation. Higher means fewer people have looked at it.
 *
 * The +2 is the zero-view guard expressed as arithmetic rather than as a branch: the argument
 * never drops below 2, so log2 never drops below 1 — no divide-by-zero, no value above 1, and
 * the most overlooked dish on the menu (no views at all) scores exactly 1.0 by construction.
 *
 * Log damping rather than 1/views or (max - views): view counts are heavy-tailed, and a linear
 * inverse lets one runaway dish flatten every other dish's score into noise. Log compresses the
 * tail and keeps the ordering. 0 views -> 1.000, 1 -> 0.631, 10 -> 0.279, 100 -> 0.150.
 */
const rawOverlooked = (views) => 1 / Math.log2(views + 2);

/**
 * quality -> the weight a dish is drawn with.
 *
 * GAMMA is what turns a weighted sum into an AND. A plain sum lets a dish win on one axis
 * alone; squaring is convex, so it pushes the mid-range down harder than the top. A dish that
 * is best-in-menu on margin and worst on views scores 0.5^2 = 0.250 and loses to an all-round
 * 0.6/0.6 dish at 0.360. That is the "BOTH", out of one exponent.
 *
 * REJECTED: the literal product M * O. It enforces AND more bluntly but zeroes any dish sitting
 * at the bottom of either min-max scale — and min-max guarantees exactly one dish sits at 0 on
 * each axis. Those two would collapse to the floor for a reason that is an artefact of the
 * normalisation rather than anything about the dish.
 *
 * FLOOR is what makes this a gacha and not a vending machine: every dish stays drawable, so the
 * machine can always surprise you. It is also the total-weight guarantee — quality is in [0,1]
 * (a convex combination of two [0,1] scores) and GAMMA >= 1 keeps it there, so every weight is
 * in [FLOOR, 1] and the total is at least 0.15n. Never zero, never negative, for any n >= 1.
 */
const weightOf = (quality) => FLOOR + (1 - FLOOR) * quality ** GAMMA;

/**
 * Scores every candidate and returns the full audit trail, not just the weights — the
 * verification script prints exactly what the selector consumes, so the two can never drift.
 *
 * Rows are whatever gachaCandidates() returned: menu_items columns plus a `views` count.
 *
 * "All the dishes have been viewed already" is not a state this can reach. Views lower a
 * weight; they never remove a dish. There is no exhausted machine.
 */
function weighDraw(rows) {
  const margins = rows.map(marginCentsOf);
  const marginScale = normalise(margins);

  /*
   * An unknown cost is scored as the median of the dishes that do have one — not excluded, and
   * not a flat 0.5.
   *
   * Excluding would silently drop dishes off the menu: a customer looking at eight dishes and
   * being told the machine holds seven is a bug. cost_cents is nullable because nobody has
   * typed it in yet, which is a data-entry gap in the office, not a statement about the dish.
   *
   * A flat 0.5 would mean "assume it beats most of the menu" whenever the menu skews low — and
   * on this menu that is the shape, so it would make the one dish with no cost recorded the
   * single most-promoted dish on the board for no reason about the dish. The median means "as
   * promoted as a typical dish on THIS menu", which is as far as honesty goes when nobody has
   * entered a number.
   */
  const knownScores = margins.filter((m) => m != null).map(marginScale.scale);
  const neutralMargin = knownScores.length ? median(knownScores) : NEUTRAL_FALLBACK;

  const overlooked = rows.map((row) => rawOverlooked(row.views));
  const overlookedScale = normalise(overlooked);

  const candidates = rows.map((row, i) => {
    const marginScore = margins[i] == null ? neutralMargin : marginScale.scale(margins[i]);
    const overlookedScore = overlookedScale.scale(overlooked[i]);
    const quality = W_MARGIN * marginScore + W_OVERLOOKED * overlookedScore;

    return {
      row,
      margin_cents: margins[i],
      margin_score: marginScore,
      views: row.views,
      overlooked_score: overlookedScore,
      quality,
      weight: weightOf(quality),
    };
  });

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  for (const c of candidates) c.probability = c.weight / total;

  return { candidates, total, neutralMargin };
}

/**
 * Roulette-wheel selection: walk the cumulative weights and stop where the target lands.
 *
 * O(n) per draw, deliberately. The pool is a restaurant menu — eight dishes on the seed,
 * realistically under two hundred. REJECTED: an alias table, which would be O(1) per draw at
 * the cost of an O(n) build against a menu a manager edits live; the build alone costs more
 * than the scan it replaces.
 *
 * `rng` is injected rather than exposed as a seed parameter on the endpoint. A caller-controlled
 * seed would let anyone sweep seeds and read the weight ordering straight off the machine —
 * which is the margin ranking of the menu, the one thing this feature must not publish.
 * Reproducibility is a bench tool, and db/gacha-weights.js is the bench.
 */
function drawFrom(candidates, total, rng = Math.random) {
  const target = rng() * total;
  let acc = 0;

  for (const candidate of candidates) {
    acc += candidate.weight;
    if (target < acc) return candidate;
  }

  // Float error, not defensiveness: summing n doubles can leave the accumulator a hair under
  // `total`, and an rng() very close to 1 then falls past every branch. The target is inside
  // the last bucket by a rounding error, so the last candidate is the correct answer.
  return candidates[candidates.length - 1];
}

module.exports = {
  VIEW_WINDOW_DAYS,
  W_MARGIN,
  W_OVERLOOKED,
  GAMMA,
  FLOOR,
  marginCentsOf,
  rawOverlooked,
  weightOf,
  weighDraw,
  drawFrom,
};
