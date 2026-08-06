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

  -- What the ingredients cost. Nullable: an item whose cost nobody has entered yet is
  -- excluded from margin reporting rather than being reported as 100% profit.
  cost_cents       INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),

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

/* ---------------------------------------------------------------- scheduling ----
 * Weekdays are ISO-8601 throughout: 1 = Monday ... 7 = Sunday, and weeks start Monday.
 * Times of day are 'HH:MM' (24h, zero-padded) so string comparison is chronological.
 */

-- A recurring weekly slot, e.g. "every Tuesday 17:00-23:00, two servers".
-- Concrete shifts are generated from these one week at a time.
CREATE TABLE IF NOT EXISTS shift_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time     TEXT    NOT NULL,
  end_time       TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('server', 'host', 'cleaner', 'cook')),
  required_staff INTEGER NOT NULL DEFAULT 1 CHECK (required_staff >= 1),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (day_of_week, start_time, end_time, role)
);

-- A shift that actually exists on the calendar. Absolute timestamps rather than a date plus
-- two times, so a 22:00-02:00 closing shift is one unambiguous interval and overlap tests are
-- a plain comparison. shift_date is the business day it belongs to, for weekly grouping.
CREATE TABLE IF NOT EXISTS shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id    INTEGER REFERENCES shift_templates (id) ON DELETE SET NULL,
  shift_date     TEXT    NOT NULL,
  starts_at      TEXT    NOT NULL,
  ends_at        TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('server', 'host', 'cleaner', 'cook')),
  required_staff INTEGER NOT NULL DEFAULT 1 CHECK (required_staff >= 1),
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at > starts_at),
  -- Stops a week being generated twice from the same template. NULLs are distinct in SQLite,
  -- so this places no constraint on manually created (template-less) shifts.
  UNIQUE (template_id, shift_date)
);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id    INTEGER NOT NULL REFERENCES shifts (id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shift_id, user_id)
);

-- When a staff member says they can work. Recurring weekly, not per-date.
CREATE TABLE IF NOT EXISTS staff_availability (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, day_of_week, start_time, end_time)
);

-- Simulated notifications: rows written on schedule changes, read back over the API.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  shift_id   INTEGER REFERENCES shifts (id) ON DELETE SET NULL,
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

/* ----------------------------------------------------------------- analytics ----
 * There is no ordering system in this app, so "popular items" is measured by views:
 * one row per time someone opens an item. Kept as raw events rather than a counter on
 * menu_items, because a counter cannot answer "popular last week" or "by whom".
 */
CREATE TABLE IF NOT EXISTS menu_item_views (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  -- Null once the viewer's account is deleted; the view itself still counts.
  user_id      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  viewed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Every analytics query filters on a date range first, so viewed_at leads the index.
CREATE INDEX IF NOT EXISTS idx_views_viewed_at ON menu_item_views (viewed_at);
CREATE INDEX IF NOT EXISTS idx_views_item      ON menu_item_views (menu_item_id, viewed_at);

-- One row per API request, written after the response is sent. Feeds both halves of the
-- system report: who is using the system (user_id) and how it performs (duration_ms, status).
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  method      TEXT    NOT NULL,
  -- The route pattern ('/api/menu-items/:id'), not the raw URL: '/api/menu-items/7' and
  -- '/api/menu-items/8' are the same endpoint, and grouping by raw URL would hide that.
  path        TEXT    NOT NULL,
  status      INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_activity_user    ON activity_log (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_shifts_date            ON shifts (shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_starts          ON shifts (starts_at);
CREATE INDEX IF NOT EXISTS idx_assignments_user       ON shift_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_shift      ON shift_assignments (shift_id);
CREATE INDEX IF NOT EXISTS idx_availability_user      ON staff_availability (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user     ON notifications (user_id, is_read);
