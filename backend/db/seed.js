const bcrypt = require('bcrypt');
const { db, migrate, DB_PATH } = require('./index');

// Dev convenience: one known password for every seeded account. Override with SEED_PASSWORD.
// These accounts are for local development only — never seed them into a deployed database.
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Passw0rd!23';
const BCRYPT_ROUNDS = 10;

const SEED_USERS = [
  { email: 'customer@example.com', full_name: 'Casey Customer', role: 'customer' },
  { email: 'staff@example.com', full_name: 'Sam Staff', role: 'staff' },
  { email: 'manager@example.com', full_name: 'Morgan Manager', role: 'manager' },
  { email: 'admin@example.com', full_name: 'Alex Admin', role: 'admin' },
];

migrate();

const insert = db.prepare(`
  INSERT INTO users (email, password_hash, full_name, role)
  VALUES (@email, @password_hash, @full_name, @role)
  ON CONFLICT (email) DO NOTHING
`);

// One transaction: either every seed user lands or none does.
const seedAll = db.transaction((users) => {
  let created = 0;
  for (const user of users) {
    const password_hash = bcrypt.hashSync(SEED_PASSWORD, BCRYPT_ROUNDS);
    if (insert.run({ ...user, password_hash }).changes > 0) created++;
  }
  return created;
});

const created = seedAll(SEED_USERS);

// --- Menu ------------------------------------------------------------------

/**
 * The four courses, carried over from restaurant_management_v1.
 *
 * These replaced a generic Appetizers/Mains/Desserts/Beverages set because the menu is home
 * cooking, not a Western restaurant service — a board with two curries and a nabe has no
 * dessert course to fill. The names are the join key for the Japanese lantern labels in the
 * frontend's `labels.js`; rename one here and the lantern loses its kanji, which is a
 * visible but harmless failure.
 */
const SEED_CATEGORIES = [
  { name: 'Small Plates', description: 'Little dishes to start, or to keep drinking over', display_order: 1 },
  { name: 'Noodles & Rice', description: 'The bowls that make up most of what gets eaten here', display_order: 2 },
  { name: 'From the Pot', description: 'Cooked at the table, shared', display_order: 3 },
  { name: 'Air Fryer', description: 'Fried without the pan of oil', display_order: 4 },
];

/**
 * The menu, carried over from v1. price_cents / cost_cents, never dollars.
 *
 * `cost_cents` is the ingredient cost, which is what the margin and theoretical-profit
 * reports divide by — it is the reason the column exists. The numbers are honest estimates
 * for home portions: rice and vegetable dishes carry high margins, the sukiyaki beef does
 * not, which is exactly the shape the margin report is meant to reveal.
 *
 * Sesame Sauce Salad deliberately keeps no cost, so the dashboard's "missing a cost" path is
 * exercised by the seed rather than only in production. For the same reason the potato wedges
 * ship off the menu — the greyed-out state on the menu board needs something to grey out.
 */
const SEED_ITEMS = [
  ['Small Plates', 'Sesame Sauce Salad',
    'Blanched greens, toasted sesame paste, a little soy and sugar. The thing I make when there is nothing in the fridge.',
    700, null, 1],
  ['Small Plates', 'Sardine Ochazuke',
    'Tinned sardine over rice, hot green tea poured at the table, sesame and nori on top.',
    850, 180, 1],
  ['Noodles & Rice', 'Japanese Curry Rice',
    'Roux blocks, onions cooked down properly, carrot and potato. Better on the second day.',
    1200, 350, 1],
  ['Noodles & Rice', 'Japanese Curry Udon',
    "Yesterday's curry loosened with dashi, thick udon, spring onion. Wear an apron.",
    1350, 430, 1],
  ['Noodles & Rice', 'Tofu Udon',
    'Clear dashi, silken tofu, udon, a lot of white pepper. The quiet one.',
    1100, 290, 1],
  ['From the Pot', 'Sukiyaki',
    'Thin beef, leek, tofu, shiitake, raw egg to dip. Takes over the whole table. Serves two.',
    2800, 1850, 1],
  ['From the Pot', 'Napa Cabbage, Enoki and Pork Soup',
    'Layered cabbage and pork belly, enoki, ginger, nothing else. Cheap, and the best thing here.',
    1050, 400, 1],
  ['Air Fryer', 'Air-fried Chicken',
    'Soy, ginger and garlic overnight, potato starch, twelve minutes at 200°C, shaken twice.',
    1150, 520, 1],
  ['Air Fryer', 'Air-fried Potato Wedges', 'Skin on, paprika, a lot of salt.', 650, 100, 0],
];

const insertCategory = db.prepare(`
  INSERT INTO categories (name, description, display_order)
  VALUES (@name, @description, @display_order)
  ON CONFLICT (name) DO NOTHING
`);

const insertItem = db.prepare(`
  INSERT INTO menu_items (category_id, name, description, price_cents, cost_cents, is_available)
  VALUES (@category_id, @name, @description, @price_cents, @cost_cents, @is_available)
  ON CONFLICT (category_id, name) DO NOTHING
`);

// Backfills cost onto items that predate the column. Separate from the insert so the two
// outcomes stay countable — an upsert reports "changes" for both, which would make the
// summary claim it created nine items every time the seed is re-run.
const backfillCost = db.prepare(`
  UPDATE menu_items SET cost_cents = @cost_cents
  WHERE category_id = @category_id AND name = @name AND cost_cents IS NULL
`);

const seedMenu = db.transaction(() => {
  let categories = 0;
  let items = 0;
  let costsBackfilled = 0;

  for (const category of SEED_CATEGORIES) {
    if (insertCategory.run(category).changes > 0) categories++;
  }

  const idFor = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

  for (const [categoryName, name, description, price_cents, cost_cents, is_available] of SEED_ITEMS) {
    const category_id = idFor(categoryName);
    const row = { category_id, name, description, price_cents, cost_cents, is_available };

    if (insertItem.run(row).changes > 0) items++;
    else if (cost_cents != null && backfillCost.run({ category_id, name, cost_cents }).changes > 0) {
      costsBackfilled++;
    }
  }

  return { categories, items, costsBackfilled };
});

const menu = seedMenu();

/*
 * One open-ended special, so the menu ships with the discount path exercised: curry udon is
 * genuinely cheaper to make because it is yesterday's curry.
 *
 * v1 kept specials in their own table; here they live on the item as `discount_percent` plus
 * an optional window, so this is the same special expressed in this schema. Guarded on the
 * item having no special already, so re-seeding never stacks a discount on top of a price a
 * manager has since changed.
 */
const seedSpecial = db.transaction(() => {
  const udon = db
    .prepare("SELECT id, discount_percent, special_price_cents FROM menu_items WHERE name = 'Japanese Curry Udon'")
    .get();

  if (!udon || udon.discount_percent != null || udon.special_price_cents != null) return false;

  db.prepare(`
    UPDATE menu_items
    SET discount_percent = 26, special_starts_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(udon.id);

  return true;
});

const special = seedSpecial();

// --- Scheduling ------------------------------------------------------------

// [day_of_week (1=Mon..7=Sun), start, end, role, required_staff]
// The Friday and Saturday closing shifts run past midnight on purpose — they exercise the
// overnight handling in shiftBounds().
const SEED_TEMPLATES = [
  [1, '09:00', '17:00', 'server', 2],
  [1, '09:00', '17:00', 'cook', 1],
  [3, '11:00', '19:00', 'server', 2],
  [3, '11:00', '19:00', 'host', 1],
  [5, '17:00', '01:00', 'server', 3],
  [6, '17:00', '01:00', 'server', 3],
  [6, '22:00', '02:00', 'cleaner', 1],
];

const insertTemplate = db.prepare(`
  INSERT INTO shift_templates (day_of_week, start_time, end_time, role, required_staff)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (day_of_week, start_time, end_time, role) DO NOTHING
`);

const seedTemplates = db.transaction(() => {
  let created = 0;
  for (const template of SEED_TEMPLATES) {
    if (insertTemplate.run(...template).changes > 0) created++;
  }
  return created;
});

const templates = seedTemplates();

// --- Analytics demo data ---------------------------------------------------

/**
 * Menu view history for the last 30 days.
 *
 * Popularity analytics need history, and a fresh database has none — the dashboard would be
 * an empty grid until the app had been used for a month. Only views are seeded: they are
 * inert counts of interest. The activity log is deliberately *not* faked, because inventing
 * response times would make the system performance report lie.
 *
 * Deterministic on purpose (no Math.random): re-seeding a wiped volume reproduces the same
 * chart, so a screenshot in the docs still matches what the reader sees.
 */
const VIEW_DAYS = 30;

// Relative interest per item, roughly what a menu looks like: a couple of stars, a long tail.
// An item missing from this table simply gets the floor weight, so adding a dish to the seed
// without touching this list is harmless.
const VIEW_WEIGHTS = {
  'Japanese Curry Rice': 9,
  Sukiyaki: 7,
  'Air-fried Chicken': 6,
  'Japanese Curry Udon': 5,
  'Napa Cabbage, Enoki and Pork Soup': 4,
  'Tofu Udon': 3,
  'Air-fried Potato Wedges': 3,
  'Sardine Ochazuke': 2,
  'Sesame Sauce Salad': 2,
};

const seedViews = db.transaction(() => {
  // Seeding twice would double every count, so this runs only on an empty table.
  if (db.prepare('SELECT 1 FROM menu_item_views LIMIT 1').get()) return 0;

  const items = db.prepare('SELECT id, name FROM menu_items').all();
  const viewers = db
    .prepare("SELECT id FROM users WHERE role IN ('customer', 'staff', 'manager', 'admin')")
    .all()
    .map((u) => u.id);

  const insertView = db.prepare(
    'INSERT INTO menu_item_views (menu_item_id, user_id, viewed_at) VALUES (?, ?, ?)'
  );

  const today = new Date();
  let created = 0;

  for (let dayOffset = VIEW_DAYS - 1; dayOffset >= 0; dayOffset--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - dayOffset);
    const date = day.toISOString().slice(0, 10);

    // Fri/Sat are busier than a Tuesday, so the trend line has a weekly rhythm in it.
    const weekday = day.getUTCDay();
    const busyness = weekday === 5 || weekday === 6 ? 1.6 : weekday === 0 ? 1.2 : 1;

    for (const [index, item] of items.entries()) {
      const weight = VIEW_WEIGHTS[item.name] ?? 1;
      // Mixing the indices spreads counts without randomness — same input, same output.
      const wobble = ((dayOffset * 7 + index * 3) % 5) - 2;
      const count = Math.max(0, Math.round(weight * busyness) + wobble);

      for (let n = 0; n < count; n++) {
        const hour = String(11 + ((index + n) % 11)).padStart(2, '0');
        const minute = String((n * 17 + index * 5) % 60).padStart(2, '0');
        insertView.run(item.id, viewers[(index + n + dayOffset) % viewers.length], `${date} ${hour}:${minute}:00`);
        created++;
      }
    }
  }

  return created;
});

const views = seedViews();

console.log(`Database: ${DB_PATH}`);
console.log(`Seeded ${created} new user(s); ${SEED_USERS.length - created} already existed.`);
console.log(`Seeded ${menu.categories} new categor(ies) and ${menu.items} new menu item(s).`);
if (menu.costsBackfilled) {
  console.log(`Backfilled cost_cents on ${menu.costsBackfilled} existing item(s).`);
}
console.log(
  special
    ? 'Applied the curry udon special (26% off, open-ended).'
    : 'Curry udon already has a special (or is not on the menu); left untouched.'
);
console.log(`Seeded ${templates} new shift template(s).`);
console.log(
  views
    ? `Seeded ${views} demo menu view(s) across the last ${VIEW_DAYS} days.`
    : 'Menu view history already present; left untouched.'
);
console.table(db.prepare('SELECT id, email, role, is_active FROM users ORDER BY id').all());
console.table(
  db.prepare(`
    SELECT c.name AS category, COUNT(m.id) AS items
    FROM categories c LEFT JOIN menu_items m ON m.category_id = c.id
    GROUP BY c.id ORDER BY c.display_order
  `).all()
);
