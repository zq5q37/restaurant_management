const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isDateString, addDays } = require('../schedule/dates');
const { sendCsv, centsToAmount } = require('../analytics/csv');
const q = require('../analytics/queries');

const router = express.Router();

// Matrix: "View dashboard" and "Export reports" are manager+. The system report adds an
// admin-only check of its own — "View user activity / system usage" is admin alone.
router.use(requireAuth, requireRole('manager', 'admin'));

const DEFAULT_DAYS = 30;
const MAX_RANGE_DAYS = 366;

/**
 * Resolves ?from=&to= into an inclusive range, defaulting to the last 30 days.
 *
 * The upper bound on the span is not arbitrary caution: every query below scans event tables
 * over the range, and an unbounded range from a mistyped year would scan everything.
 */
function resolveRange(req, res) {
  const to = req.query.to ?? new Date().toISOString().slice(0, 10);
  const from = req.query.from ?? addDays(to, -(DEFAULT_DAYS - 1));

  if (!isDateString(from) || !isDateString(to)) {
    res.status(400).json({ error: 'from and to must be YYYY-MM-DD dates' });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: 'from must not be after to' });
    return null;
  }
  if (q.eachDate(from, to).length > MAX_RANGE_DAYS) {
    res.status(400).json({ error: `Range must not exceed ${MAX_RANGE_DAYS} days` });
    return null;
  }

  return { from, to };
}

const wantsCsv = (req) => req.query.format === 'csv';

/** Suffixes exported filenames with the range, so downloads don't collide in ~/Downloads. */
const filename = (name, { from, to }) => `${name}_${from}_to_${to}.csv`;

/* ------------------------------------------------------------------ overview ---- */

/**
 * GET /api/analytics/overview?from=&to=
 * The headline numbers, one request rather than four partial ones.
 */
router.get('/overview', (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return;

  const coverage = q.scheduleCoverage(range);
  const views = q.viewsByDay(range);
  const items = q.menuProfitability(range);

  const totalViews = views.reduce((sum, d) => sum + d.views, 0);
  const priced = items.filter((i) => i.margin_percent != null);

  res.json({
    range,
    menu: {
      items: items.length,
      available: items.filter((i) => i.is_available).length,
      on_special: items.filter((i) => i.is_on_special).length,
      missing_cost: items.length - priced.length,
      average_margin_percent: priced.length
        ? Math.round((priced.reduce((s, i) => s + i.margin_percent, 0) / priced.length) * 10) / 10
        : null,
      theoretical_profit_cents: items.reduce((s, i) => s + (i.theoretical_profit_cents ?? 0), 0),
    },
    views: { total: totalViews, by_day: views },
    schedule: coverage,
  });
});

/* ------------------------------------------------------------ popular items ---- */

router.get('/popular-items', (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return;

  const limit = Math.min(Number(req.query.limit) > 0 ? Number(req.query.limit) : 10, 100);
  const items = q.popularItems({ ...range, limit });

  if (wantsCsv(req)) {
    return sendCsv(res, filename('popular_items', range), [
      { key: 'name', label: 'Item' },
      { key: 'category_name', label: 'Category' },
      { key: 'views', label: 'Views' },
      { key: 'unique_viewers', label: 'Unique viewers' },
      { key: 'price_cents', label: 'Price', map: (r) => centsToAmount(r.price_cents) },
      { key: 'is_available', label: 'Available', map: (r) => (r.is_available ? 'yes' : 'no') },
    ], items);
  }

  res.json({
    range,
    items,
    by_category: q.viewsByCategory(range),
    by_day: q.viewsByDay(range),
  });
});

/* ---------------------------------------------------------------- scheduling ---- */

router.get('/schedule', (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return;

  const utilisation = q.staffUtilisation(range);

  if (wantsCsv(req)) {
    return sendCsv(res, filename('staff_utilisation', range), [
      { key: 'full_name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'shifts', label: 'Shifts' },
      { key: 'hours', label: 'Hours' },
      { key: 'share_percent', label: 'Share of hours (%)' },
    ], utilisation);
  }

  res.json({
    range,
    summary: q.scheduleCoverage(range),
    by_day: q.coverageByDay(range),
    by_role: q.coverageByRole(range),
    utilisation,
  });
});

/* ---------------------------------------------------------------------- menu ---- */

router.get('/menu', (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return;

  const items = q.menuProfitability(range);

  if (wantsCsv(req)) {
    return sendCsv(res, filename('menu_profitability', range), [
      { key: 'name', label: 'Item' },
      { key: 'category_name', label: 'Category' },
      { key: 'price_cents', label: 'List price', map: (r) => centsToAmount(r.price_cents) },
      {
        key: 'effective_price_cents',
        label: 'Effective price',
        map: (r) => centsToAmount(r.effective_price_cents),
      },
      { key: 'cost_cents', label: 'Cost', map: (r) => centsToAmount(r.cost_cents) },
      { key: 'margin_cents', label: 'Margin', map: (r) => centsToAmount(r.margin_cents) },
      { key: 'margin_percent', label: 'Margin (%)' },
      { key: 'views', label: 'Views' },
      {
        key: 'theoretical_profit_cents',
        label: 'Theoretical profit',
        map: (r) => centsToAmount(r.theoretical_profit_cents),
      },
    ], items);
  }

  res.json({ range, items, by_category: q.profitByCategory(range) });
});

/* ------------------------------------------------------------- system usage ---- */

/** Matrix: "View user activity / system usage" — Admin only, not manager. */
router.get('/system', requireRole('admin'), (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return;

  const users = q.userActivity(range);

  if (wantsCsv(req)) {
    return sendCsv(res, filename('user_activity', range), [
      { key: 'full_name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'is_active', label: 'Account active', map: (r) => (r.is_active ? 'yes' : 'no') },
      { key: 'requests', label: 'Requests' },
      { key: 'last_seen', label: 'Last seen' },
    ], users);
  }

  res.json({
    range,
    summary: q.systemSummary(range),
    by_day: q.requestsByDay(range),
    endpoints: q.topEndpoints(range),
    users,
  });
});

module.exports = router;
