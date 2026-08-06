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

const SEED_CATEGORIES = [
  { name: 'Appetizers', description: 'Small plates to start', display_order: 1 },
  { name: 'Mains', description: 'Main courses', display_order: 2 },
  { name: 'Desserts', description: 'Something sweet', display_order: 3 },
  { name: 'Beverages', description: 'Drinks, hot and cold', display_order: 4 },
];

// price_cents / cost_cents, never dollars — see the note in schema.sql. Costs drive the
// margin reporting; Soup of the Day deliberately has none, so the dashboard's "missing cost"
// path is exercised by the seed rather than only in production.
const SEED_ITEMS = [
  ['Appetizers', 'Garlic Bread', 'Toasted sourdough with garlic butter', 650, 180, 1],
  ['Appetizers', 'Soup of the Day', 'Ask your server', 780, null, 1],
  ['Mains', 'Margherita Pizza', 'Tomato, mozzarella, basil', 1450, 420, 1],
  ['Mains', 'Grilled Salmon', 'With seasonal vegetables', 2200, 1150, 1],
  ['Mains', 'Mushroom Risotto', 'Arborio rice, wild mushrooms', 1680, 540, 0],
  ['Desserts', 'Tiramisu', 'Espresso-soaked ladyfingers', 890, 260, 1],
  ['Desserts', 'Lemon Tart', 'With raspberry coulis', 820, 240, 1],
  ['Beverages', 'Espresso', 'Single shot', 320, 45, 1],
  ['Beverages', 'Fresh Orange Juice', 'Squeezed to order', 480, 170, 1],
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
const VIEW_WEIGHTS = {
  'Margherita Pizza': 9,
  'Grilled Salmon': 7,
  Tiramisu: 5,
  'Garlic Bread': 4,
  Espresso: 4,
  'Lemon Tart': 3,
  'Fresh Orange Juice': 2,
  'Soup of the Day': 2,
  'Mushroom Risotto': 1,
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
