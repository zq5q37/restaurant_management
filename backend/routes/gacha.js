/**
 * The dish gacha: one weighted recommendation per turn of the dial.
 *
 * Its own router rather than a path inside routes/menuItems.js. `/api/menu-items/gacha` would
 * be swallowed by that file's `GET /:id` handler unless the two were carefully ordered, and a
 * route whose correctness depends on declaration order is a trap. This is also its own concern:
 * the weighting is in menu/gacha.js and the pool query in analytics/queries.js.
 *
 * The maths, and why the draw is tilted the way it is, is documented in menu/gacha.js.
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { decorate } = require('../menu/pricing');
const { gachaCandidates } = require('../analytics/queries');
const { VIEW_WINDOW_DAYS, weighDraw, drawFrom } = require('../menu/gacha');

const router = express.Router();

// Every role may turn the dial — no requireRole. A recommendation is not privileged.
router.use(requireAuth);

/**
 * The fields a drawn dish is allowed to carry out of this process.
 *
 * Named explicitly rather than handing the row to decorate(), which spreads `...item` and would
 * take cost_cents, the view count and every intermediate score along with it. Cost is an input
 * to the weighting and the shop's business; the only reliable place to stop a column is before
 * it leaves. If this list is ever replaced with `decorate(row)` because that is shorter, the
 * margins go out with it.
 *
 * NOTE — pre-existing, neither introduced nor fixed here: GET /api/menu-items uses `SELECT m.*`
 * and GET /api/menu-items/:id uses `SELECT *`, both through decorate(), so cost_cents already
 * reaches customers on those endpoints. That is worth fixing on its own terms; in the meantime
 * a new endpoint should not add a second door to it.
 */
const PUBLIC_FIELDS = [
  'id',
  'category_id',
  'category_name',
  'name',
  'description',
  'price_cents',
  'special_price_cents',
  'discount_percent',
  'special_starts_at',
  'special_ends_at',
  'image_path',
  'is_available',
  'created_at',
  'updated_at',
];

/** Same shape GET /api/menu-items/:id returns, so the client needs no second mapping. */
const publicItem = (row) =>
  decorate(Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, row[field]])));

/** Shared by both id params. Mirrors the check in routes/menuItems.js. */
const parseId = (value) => (/^\d+$/.test(value) ? Number(value) : null);

/**
 * GET /api/gacha?category_id=&exclude=
 *
 * A GET because nothing is written — see the recordView note below. That makes it cacheable by
 * default, which would freeze the machine on one dish, so it opts out explicitly.
 *
 * REJECTED: POST /api/gacha/draw. POST would imply the server recorded something. It must not,
 * and a verb that lies about its side effects is worse than a GET that needs a cache header.
 */
router.get('/', (req, res) => {
  const { category_id, exclude } = req.query;

  let categoryId = null;
  if (category_id !== undefined) {
    categoryId = parseId(category_id);
    if (categoryId === null) {
      return res.status(400).json({ error: 'category_id must be an integer' });
    }
  }

  let excludeId = null;
  if (exclude !== undefined) {
    excludeId = parseId(exclude);
    if (excludeId === null) {
      return res.status(400).json({ error: 'exclude must be an integer' });
    }
  }

  const pool = gachaCandidates({ category_id: categoryId, window_days: VIEW_WINDOW_DAYS });

  /*
   * "Turn again" should not hand back the capsule already on screen — but not at the cost of
   * handing back nothing. On a one-dish course, honouring the exclusion would empty the machine,
   * so the exclusion is dropped and the repeat is reported instead of hidden.
   */
  const withoutLast = excludeId === null ? pool : pool.filter((row) => row.id !== excludeId);
  const rows = withoutLast.length ? withoutLast : pool;
  const repeated = Boolean(excludeId) && withoutLast.length === 0 && pool.length > 0;

  const draw = {
    pool_size: pool.length,
    category_id: categoryId,
    repeated,
    drawn_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };

  // A proxy or the browser caching a draw would leave the dial turning up the same dish forever.
  res.set('Cache-Control', 'no-store');

  /*
   * An empty machine is a 200, not a 404. Nothing is missing — the endpoint exists and answered
   * correctly, and "every dish is off the board tonight" is a legitimate state of the menu that
   * the client has to render either way. A 404 would route it through the error path and print
   * it in red.
   */
  if (!rows.length) return res.json({ item: null, draw });

  const { candidates, total } = weighDraw(rows);
  const winner = drawFrom(candidates, total);

  /*
   * A draw is an impression, not a view — deliberately no recordView() here.
   *
   * The gacha reads menu_item_views to find the dishes nobody looks at. Writing a view on every
   * draw would let the machine inflate the very signal it reads from: it would promote a quiet
   * dish, count its own promotion as interest, and demote it again without a single customer
   * having looked at anything. The counter would be measuring the machine, not the room.
   *
   * The view is recorded only if someone clicks through, where the write already lives —
   * Menu.jsx's revealItem() fires GET /api/menu-items/:id.
   *
   * The feedback loop that remains is the intended one: a promoted dish people actually open
   * accrues real views, its overlooked score falls, and the machine moves on to the next dish
   * nobody has found. The machine rotates its own promotion as the menu gets discovered.
   */
  res.json({ item: publicItem(winner.row), draw });
});

module.exports = router;
