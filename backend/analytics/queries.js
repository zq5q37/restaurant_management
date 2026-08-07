/**
 * Aggregation queries behind the analytics dashboard.
 *
 * Two rules shape everything here:
 *
 * 1. Ranges are compared against raw timestamps (`viewed_at >= @start AND viewed_at < @end`),
 *    never `date(viewed_at) BETWEEN ...`. Wrapping the column in a function makes the index
 *    on it unusable, so every query would degrade into a full scan of the event tables.
 * 2. Grouping and counting happen in SQLite. Only pricing is computed in JavaScript, because
 *    the specials rules already live in menu/pricing.js and duplicating them in SQL would
 *    create a second source of truth that could disagree with what customers are charged.
 */

const { db } = require('../db');
const { decorate } = require('../menu/pricing');

/**
 * Half-open bounds for an inclusive date range: `to` is turned into the start of the next
 * day, so an event at 23:59 on the final day is included without any rounding of stored
 * timestamps. Matches SQLite's 'YYYY-MM-DD HH:MM:SS' format so string comparison is ordering.
 */
function rangeBounds(from, to) {
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: `${from} 00:00:00`, end: `${next.toISOString().slice(0, 10)} 00:00:00` };
}

/** Every date in the range, so a chart shows quiet days as zero rather than omitting them. */
function eachDate(from, to) {
  const dates = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); ) {
    dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return dates;
}

/** Turns rows of { date, ... } into a dense series across the whole range. */
function densify(rows, from, to, valueKey = 'value') {
  const byDate = new Map(rows.map((r) => [r.date, r[valueKey]]));
  return eachDate(from, to).map((date) => ({ date, [valueKey]: byDate.get(date) ?? 0 }));
}

const round = (n, places = 1) => {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
};

/* ------------------------------------------------------------ popular items ---- */

/**
 * Most-viewed menu items in the range.
 *
 * There is no ordering system in this app, so a view is the strongest available signal of
 * demand. Items with no views still appear (LEFT JOIN) — "nobody looked at this all month"
 * is exactly the finding a manager needs, and it vanishes under an INNER JOIN.
 */
function popularItems({ from, to, limit = 10 }) {
  const { start, end } = rangeBounds(from, to);

  return db
    .prepare(`
      SELECT
        m.id,
        m.name,
        c.name AS category_name,
        m.price_cents,
        m.is_available,
        COUNT(v.id)                AS views,
        COUNT(DISTINCT v.user_id)  AS unique_viewers
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      LEFT JOIN menu_item_views v
        ON v.menu_item_id = m.id AND v.viewed_at >= @start AND v.viewed_at < @end
      GROUP BY m.id
      ORDER BY views DESC, m.name
      LIMIT @limit
    `)
    .all({ start, end, limit })
    .map((row) => ({ ...row, is_available: Boolean(row.is_available) }));
}

/** Views per day, for the trend line. */
function viewsByDay({ from, to }) {
  const { start, end } = rangeBounds(from, to);

  const rows = db
    .prepare(`
      SELECT substr(viewed_at, 1, 10) AS date, COUNT(*) AS views
      FROM menu_item_views
      WHERE viewed_at >= @start AND viewed_at < @end
      GROUP BY date
      ORDER BY date
    `)
    .all({ start, end });

  return densify(rows, from, to, 'views');
}

function viewsByCategory({ from, to }) {
  const { start, end } = rangeBounds(from, to);

  return db
    .prepare(`
      SELECT c.name AS category_name, COUNT(v.id) AS views
      FROM categories c
      LEFT JOIN menu_items m ON m.category_id = c.id
      LEFT JOIN menu_item_views v
        ON v.menu_item_id = m.id AND v.viewed_at >= @start AND v.viewed_at < @end
      GROUP BY c.id
      ORDER BY views DESC, c.name
    `)
    .all({ start, end });
}

/* --------------------------------------------------------------- scheduling ---- */

/**
 * Coverage: how much of the staffing a manager asked for was actually filled.
 *
 * required_staff is summed per shift and assignments counted separately, because a shift
 * needing 3 people with 1 assigned is 1/3 covered, not "uncovered" — a boolean would throw
 * away the size of the gap.
 */
function scheduleCoverage({ from, to }) {
  const totals = db
    .prepare(`
      SELECT
        COUNT(*)                       AS shifts,
        COALESCE(SUM(s.required_staff), 0) AS required,
        COALESCE(SUM((
          SELECT COUNT(*) FROM shift_assignments a WHERE a.shift_id = s.id
        )), 0)                         AS assigned,
        COALESCE(SUM(CASE WHEN (
          SELECT COUNT(*) FROM shift_assignments a WHERE a.shift_id = s.id
        ) >= s.required_staff THEN 1 ELSE 0 END), 0) AS covered_shifts
      FROM shifts s
      WHERE s.shift_date >= @from AND s.shift_date <= @to
    `)
    .get({ from, to });

  return {
    ...totals,
    unfilled: Math.max(0, totals.required - totals.assigned),
    coverage_rate: totals.required ? round((totals.assigned / totals.required) * 100) : null,
  };
}

/** Coverage per day, so a manager can see which days are chronically short. */
function coverageByDay({ from, to }) {
  const rows = db
    .prepare(`
      SELECT
        s.shift_date AS date,
        SUM(s.required_staff) AS required,
        SUM((SELECT COUNT(*) FROM shift_assignments a WHERE a.shift_id = s.id)) AS assigned
      FROM shifts s
      WHERE s.shift_date >= @from AND s.shift_date <= @to
      GROUP BY s.shift_date
      ORDER BY s.shift_date
    `)
    .all({ from, to });

  const byDate = new Map(rows.map((r) => [r.date, r]));

  return eachDate(from, to).map((date) => {
    const row = byDate.get(date);
    const required = row?.required ?? 0;
    const assigned = row?.assigned ?? 0;
    return {
      date,
      required,
      assigned,
      coverage_rate: required ? round((assigned / required) * 100) : null,
    };
  });
}

/** Where the gaps are by role — which job is hard to staff, not just how much is missing. */
function coverageByRole({ from, to }) {
  return db
    .prepare(`
      SELECT
        s.role,
        COUNT(*) AS shifts,
        SUM(s.required_staff) AS required,
        SUM((SELECT COUNT(*) FROM shift_assignments a WHERE a.shift_id = s.id)) AS assigned
      FROM shifts s
      WHERE s.shift_date >= @from AND s.shift_date <= @to
      GROUP BY s.role
      ORDER BY s.role
    `)
    .all({ from, to })
    .map((r) => ({
      ...r,
      unfilled: Math.max(0, r.required - r.assigned),
      coverage_rate: r.required ? round((r.assigned / r.required) * 100) : null,
    }));
}

/**
 * Utilisation: hours each person is rostered for.
 *
 * Hours come from the absolute timestamps, so an overnight 22:00-02:00 shift counts as the
 * 4 hours it is. julianday() difference is in days, hence * 24.
 */
function staffUtilisation({ from, to }) {
  const rows = db
    .prepare(`
      SELECT
        u.id,
        u.full_name,
        u.role,
        COUNT(a.id) AS shifts,
        COALESCE(SUM((julianday(s.ends_at) - julianday(s.starts_at)) * 24), 0) AS hours
      FROM users u
      LEFT JOIN shift_assignments a ON a.user_id = u.id
      LEFT JOIN shifts s
        ON s.id = a.shift_id AND s.shift_date >= @from AND s.shift_date <= @to
      WHERE u.role IN ('staff', 'manager', 'admin') AND u.is_active = 1
      GROUP BY u.id
      ORDER BY hours DESC, u.full_name
    `)
    .all({ from, to });

  // A shift outside the range leaves a NULL join, which SUM ignores but COUNT(a.id) does not.
  const cleaned = rows.map((r) => ({
    ...r,
    hours: round(r.hours),
    shifts: r.hours > 0 ? r.shifts : 0,
  }));

  const totalHours = cleaned.reduce((sum, r) => sum + r.hours, 0);

  // Share of the roster each person carries: the number that shows one server working every
  // closing shift while another works none.
  return cleaned.map((r) => ({
    ...r,
    share_percent: totalHours ? round((r.hours / totalHours) * 100) : 0,
  }));
}

/* --------------------------------------------------------------------- menu ---- */

/**
 * Pricing and theoretical profit per item.
 *
 * "Theoretical" is meant literally: with no orders in the system, profit is what *would* be
 * earned if every view in the range converted once. It ranks items by commercial value
 * rather than raw popularity — a heavily viewed item with a thin margin can be worth less
 * than a quiet one with a fat margin.
 */
function menuProfitability({ from, to }) {
  const { start, end } = rangeBounds(from, to);

  const rows = db
    .prepare(`
      SELECT m.*, c.name AS category_name,
        (SELECT COUNT(*) FROM menu_item_views v
          WHERE v.menu_item_id = m.id AND v.viewed_at >= @start AND v.viewed_at < @end) AS views
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      ORDER BY c.display_order, c.name, m.name
    `)
    .all({ start, end });

  return rows.map((row) => {
    const item = decorate(row);
    const hasCost = item.cost_cents != null;
    const margin = hasCost ? item.effective_price_cents - item.cost_cents : null;

    return {
      id: item.id,
      name: item.name,
      category_name: item.category_name,
      is_available: item.is_available,
      price_cents: item.price_cents,
      effective_price_cents: item.effective_price_cents,
      is_on_special: item.is_on_special,
      cost_cents: item.cost_cents,
      margin_cents: margin,
      // Guard against a zero price: a free item has no margin percentage, not an infinite one.
      margin_percent:
        hasCost && item.effective_price_cents > 0
          ? round((margin / item.effective_price_cents) * 100)
          : null,
      views: row.views,
      theoretical_profit_cents: hasCost ? margin * row.views : null,
    };
  });
}

/** Category rollup of the same figures, for the "where does the money come from" view. */
function profitByCategory({ from, to }) {
  const items = menuProfitability({ from, to });
  const byCategory = new Map();

  for (const item of items) {
    const entry = byCategory.get(item.category_name) ?? {
      category_name: item.category_name,
      items: 0,
      items_missing_cost: 0,
      views: 0,
      theoretical_profit_cents: 0,
    };

    entry.items += 1;
    entry.views += item.views;
    if (item.cost_cents == null) entry.items_missing_cost += 1;
    else entry.theoretical_profit_cents += item.theoretical_profit_cents;

    byCategory.set(item.category_name, entry);
  }

  return [...byCategory.values()].sort(
    (a, b) => b.theoretical_profit_cents - a.theoretical_profit_cents
  );
}

/* ------------------------------------------------------------- system usage ---- */

/**
 * Request volume, performance and errors. Admin-only, per the "View user activity /
 * system usage" row of the permission matrix.
 */
function systemSummary({ from, to }) {
  const { start, end } = rangeBounds(from, to);
  const where = 'created_at >= @start AND created_at < @end';

  const totals = db
    .prepare(`
      SELECT
        COUNT(*)                    AS requests,
        COUNT(DISTINCT user_id)     AS active_users,
        COALESCE(AVG(duration_ms), 0) AS avg_ms,
        COALESCE(MAX(duration_ms), 0) AS max_ms,
        COALESCE(SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END), 0) AS server_errors,
        COALESCE(SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END), 0) AS client_errors
      FROM activity_log
      WHERE ${where}
    `)
    .get({ start, end });

  // p95 by offset rather than by sorting in JS: this reads one row from the index instead of
  // pulling every request in the range into memory to sort it.
  const p95 = db
    .prepare(`
      SELECT duration_ms FROM activity_log
      WHERE ${where}
      ORDER BY duration_ms
      LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 95 / 100 AS INTEGER) FROM activity_log WHERE ${where})
    `)
    .get({ start, end });

  return {
    ...totals,
    avg_ms: round(totals.avg_ms, 2),
    p95_ms: p95?.duration_ms ?? 0,
    error_rate: totals.requests
      ? round(((totals.server_errors + totals.client_errors) / totals.requests) * 100)
      : 0,
  };
}

function requestsByDay({ from, to }) {
  const { start, end } = rangeBounds(from, to);

  const rows = db
    .prepare(`
      SELECT
        substr(created_at, 1, 10) AS date,
        COUNT(*) AS requests,
        COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors,
        ROUND(AVG(duration_ms), 2) AS avg_ms
      FROM activity_log
      WHERE created_at >= @start AND created_at < @end
      GROUP BY date
      ORDER BY date
    `)
    .all({ start, end });

  const byDate = new Map(rows.map((r) => [r.date, r]));

  return eachDate(from, to).map((date) => ({
    date,
    requests: byDate.get(date)?.requests ?? 0,
    errors: byDate.get(date)?.errors ?? 0,
    avg_ms: byDate.get(date)?.avg_ms ?? 0,
  }));
}

/** The endpoints worth optimising: busiest first, with how slow each one is. */
function topEndpoints({ from, to, limit = 10 }) {
  const { start, end } = rangeBounds(from, to);

  return db
    .prepare(`
      SELECT
        method || ' ' || path AS endpoint,
        COUNT(*) AS requests,
        ROUND(AVG(duration_ms), 2) AS avg_ms,
        MAX(duration_ms) AS max_ms,
        COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors
      FROM activity_log
      WHERE created_at >= @start AND created_at < @end
      GROUP BY endpoint
      ORDER BY requests DESC
      LIMIT @limit
    `)
    .all({ start, end, limit });
}

/** Per-user activity: who is actually using the system, and when they were last seen. */
function userActivity({ from, to }) {
  const { start, end } = rangeBounds(from, to);

  return db
    .prepare(`
      SELECT
        u.id,
        u.full_name,
        u.role,
        u.is_active,
        COUNT(l.id) AS requests,
        MAX(l.created_at) AS last_seen
      FROM users u
      LEFT JOIN activity_log l
        ON l.user_id = u.id AND l.created_at >= @start AND l.created_at < @end
      GROUP BY u.id
      ORDER BY requests DESC, u.full_name
    `)
    .all({ start, end })
    .map((r) => ({ ...r, is_active: Boolean(r.is_active) }));
}

/* ------------------------------------------------------------- menu gacha ---- */

/**
 * The pool the dish gacha draws from, with each dish's view count over the window.
 *
 * Lives here rather than in routes/gacha.js because it is the same LEFT-JOIN-over-
 * menu_item_views shape as popularItems() above, and a second copy would be a second
 * definition of "views in a window" that could drift from the one the manager's report uses.
 *
 * LEFT JOIN, not INNER, for the reason popularItems() gives: a dish nobody has looked at all
 * month must still appear. Under an INNER JOIN the most overlooked dishes on the menu — which
 * are exactly the ones the gacha exists to promote — silently vanish from the pool. The date
 * bound rides in the join predicate rather than a WHERE clause for the same reason: in a WHERE
 * it would filter those rows back out after the join had kept them.
 *
 * Availability is filtered UNCONDITIONALLY here, deliberately ignoring canSeeUnavailable() in
 * routes/menuItems.js. That is a *browsing* permission — staff need to see what is off the
 * board. This is a *recommendation*, and recommending a dish the kitchen is not cooking is
 * wrong no matter who asks. Every role draws from the dishes a customer could actually order.
 *
 * ORDER BY m.id is load-bearing, not cosmetic. drawFrom() walks the array in order, so a stable
 * order is what lets db/gacha-weights.js reproduce a draw under a seeded RNG. Removing it
 * because "order does not matter for a random draw" would make the verification unrepeatable.
 *
 * Returns raw rows, cost_cents included: cost is an input to the weighting and must not leave
 * the process. routes/gacha.js picks the public fields off the winner.
 */
function gachaCandidates({ category_id = null, window_days = 30 } = {}) {
  const cutoff = new Date(Date.now() - window_days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' '); // same shape as nowStamp() in menu/pricing.js, so string compare orders

  return db
    .prepare(`
      SELECT m.*, c.name AS category_name, COUNT(v.id) AS views
      FROM menu_items m
      JOIN categories c ON c.id = m.category_id
      LEFT JOIN menu_item_views v
        ON v.menu_item_id = m.id AND v.viewed_at >= @cutoff
      WHERE m.is_available = 1
        AND (@category_id IS NULL OR m.category_id = @category_id)
      GROUP BY m.id
      ORDER BY m.id
    `)
    .all({ cutoff, category_id });
}

module.exports = {
  rangeBounds,
  eachDate,
  popularItems,
  gachaCandidates,
  viewsByDay,
  viewsByCategory,
  scheduleCoverage,
  coverageByDay,
  coverageByRole,
  staffUtilisation,
  menuProfitability,
  profitByCategory,
  systemSummary,
  requestsByDay,
  topEndpoints,
  userActivity,
};
