const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'restaurant.db');

// The Docker named volume creates /app/data, but a bare `npm run seed` on the host may not have it.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');   // readers don't block the writer
db.pragma('foreign_keys = ON');    // off by default in SQLite; future tables will need it

function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

module.exports = { db, migrate, DB_PATH };
