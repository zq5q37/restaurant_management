const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'restaurant.db');

// The Docker named volume creates /app/data, but a bare `npm run seed` on the host may not have it.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');   // readers don't block the writer
db.pragma('foreign_keys = ON');    // off by default in SQLite; future tables will need it

/**
 * Columns added to a table that already exists in a deployed database.
 *
 * `CREATE TABLE IF NOT EXISTS` in schema.sql covers new databases but is a no-op on old ones,
 * and SQLite has no `ADD COLUMN IF NOT EXISTS`, so each addition is applied only when
 * PRAGMA table_info says it is missing. Keep the definition identical to schema.sql.
 */
const ADDED_COLUMNS = [
  ['menu_items', 'cost_cents', 'INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0)'],
];

function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  for (const [table, column, definition] of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

module.exports = { db, migrate, DB_PATH };
