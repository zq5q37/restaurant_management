/**
 * Read-only: what is actually in this database?
 *
 * Handy when there is more than one — the host file at backend/data/restaurant.db and the
 * one Docker keeps in the `sqlite-data` volume are different databases, and seeding the
 * wrong one is the usual reason the browser does not change.
 *
 *   node db/inspect.js                        # the host database
 *   docker compose exec backend node db/inspect.js   # the container's
 */
const { db, DB_PATH } = require('./index');

console.log(`Database: ${DB_PATH}\n`);

const columns = db.prepare('PRAGMA table_info(menu_items)').all().map((c) => c.name);
console.log('menu_items.cost_cents present:', columns.includes('cost_cents'));

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((t) => t.name);
console.log('tables:', tables.join(', '), '\n');

console.table(
  db
    .prepare(`
      SELECT c.name AS category, m.name AS item, m.price_cents, m.cost_cents, m.is_available
      FROM menu_items m JOIN categories c ON c.id = m.category_id
      ORDER BY c.display_order, m.name
    `)
    .all()
);

const counts = {};
for (const table of ['users', 'shifts', 'shift_assignments', 'menu_item_views', 'activity_log']) {
  try {
    counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  } catch {
    counts[table] = '(table missing)';
  }
}
console.table(counts);
