-- Users table: every person who can log in, across all four roles.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('customer', 'staff', 'manager', 'admin')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Login looks users up by email on every request; UNIQUE already indexes it.
-- Admin screens filter by role, so index that too.
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Menu categories: appetizers, mains, desserts, beverages, and whatever a manager adds later.
CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  description   TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id      INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  name             TEXT    NOT NULL,
  description      TEXT,

  -- Money is stored in whole cents. A REAL column would make 0.1 + 0.2 != 0.3 a pricing bug.
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),

  -- Dynamic pricing. Either a flat override OR a percentage off, never both.
  special_price_cents INTEGER CHECK (special_price_cents IS NULL OR special_price_cents >= 0),
  discount_percent    INTEGER CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 99)),
  special_starts_at   TEXT,
  special_ends_at     TEXT,

  image_path       TEXT,
  is_available     INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),

  CHECK (special_price_cents IS NULL OR discount_percent IS NULL),
  UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category  ON menu_items (category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items (is_available);
