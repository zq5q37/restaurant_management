/**
 * One-off maintenance: retire the generic starter menu.
 *
 * The seed used to ship Appetizers/Mains/Desserts/Beverages with nine Western dishes. It now
 * ships the Rokushichi board, and because the seed only ever inserts, a database created
 * before that change ends up with both menus side by side rather than the new one.
 *
 * This is deliberately NOT part of `seed.js`: a fresh database never had these rows, so a
 * permanent delete step there would be dead weight pointed at data only older databases have.
 * Run it once per existing database — including the one Docker keeps in its volume, which is
 * a different database from the host file:
 *
 *   node db/retire-starter-menu.js
 *   docker compose exec backend node db/retire-starter-menu.js
 *
 * Scoped to exact (category, name) pairs from the old seed, so a dish added through the menu
 * editor is left alone. View history for the removed dishes goes with them via ON DELETE
 * CASCADE, which is correct — it is demand data for things no longer on the menu. Users,
 * shifts, assignments, notifications and the activity log are untouched.
 */
const { db, DB_PATH } = require('./index');

const RETIRED_ITEMS = [
  ['Appetizers', 'Garlic Bread'],
  ['Appetizers', 'Soup of the Day'],
  ['Mains', 'Margherita Pizza'],
  ['Mains', 'Grilled Salmon'],
  ['Mains', 'Mushroom Risotto'],
  ['Desserts', 'Tiramisu'],
  ['Desserts', 'Lemon Tart'],
  ['Beverages', 'Espresso'],
  ['Beverages', 'Fresh Orange Juice'],
];

const RETIRED_CATEGORIES = ['Appetizers', 'Mains', 'Desserts', 'Beverages'];

const findItem = db.prepare(`
  SELECT m.id FROM menu_items m
  JOIN categories c ON c.id = m.category_id
  WHERE c.name = ? AND m.name = ?
`);
const countViews = db.prepare('SELECT COUNT(*) AS n FROM menu_item_views WHERE menu_item_id = ?');
const countItemsIn = db.prepare(`
  SELECT COUNT(*) AS n FROM menu_items m
  JOIN categories c ON c.id = m.category_id
  WHERE c.name = ?
`);

const retire = db.transaction(() => {
  let items = 0;
  let views = 0;

  for (const [category, name] of RETIRED_ITEMS) {
    const row = findItem.get(category, name);
    if (!row) continue;

    views += countViews.get(row.id).n;
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(row.id);
    items += 1;
  }

  let categories = 0;
  for (const name of RETIRED_CATEGORIES) {
    // ON DELETE RESTRICT protects a category that still holds items, so this only removes
    // the ones fully emptied above — a category someone reused keeps its dishes and itself.
    if (countItemsIn.get(name).n > 0) continue;
    categories += db.prepare('DELETE FROM categories WHERE name = ?').run(name).changes;
  }

  return { items, views, categories };
});

const result = retire();

console.log(`Database: ${DB_PATH}`);
console.log(
  result.items
    ? `Retired ${result.items} starter dish(es) and ${result.categories} emptied categor(ies); ` +
        `${result.views} view(s) went with them. Run \`npm run seed\` next.`
    : 'No starter dishes found — nothing to retire.'
);
