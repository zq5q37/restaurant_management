# Database Schema

SQLite, accessed via `better-sqlite3`. Schema lives in `backend/db/schema.sql` and is applied by
`migrate()` in `backend/db/index.js`. Every connection sets `foreign_keys = ON` (SQLite defaults it
off) and `journal_mode = WAL`.

Database file location comes from `DB_PATH`, set to `/app/data/restaurant.db` in `docker-compose.yml`
and backed by the `sqlite-data` named volume so it survives `docker compose down`.

## Persistence

The database lives in the named volume `sqlite-data`, mounted at `/app/data`. Note that the
`./backend:/app` bind mount is shadowed at that path by the named volume, so the `.db` file is in
Docker-managed storage, **not** in `backend/data/` on the host.

| Command                  | Containers | Data      |
| ------------------------ | ---------- | --------- |
| `docker compose down`    | removed    | **kept**  |
| `docker compose down -v` | removed    | **wiped** |

`server.js` calls `migrate()` before listening, so a fresh or wiped volume gets its schema
automatically on boot — the server never serves requests against a missing table. Seed data is
*not* automatic; after a `down -v` you must re-run `docker compose exec backend npm run seed`.

One more volume to know about: `/app/node_modules` is an **anonymous** volume, populated only when
first created. After changing dependencies or fixing a broken install, rebuilding the image is not
enough — use `docker compose up -d --force-recreate --renew-anon-volumes backend`.

## `users`

Every person who can log in, across all four roles. See [permission-matrix.md](permission-matrix.md)
for what each role may do.

| Column          | Type    | Constraints                                       | Notes                                     |
| --------------- | ------- | ------------------------------------------------- | ----------------------------------------- |
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT                         |                                           |
| `email`         | TEXT    | NOT NULL, UNIQUE                                  | Login identifier; UNIQUE implies an index |
| `password_hash` | TEXT    | NOT NULL                                          | bcrypt, cost 10 — never plaintext         |
| `full_name`     | TEXT    | NOT NULL                                          | Display name                              |
| `role`          | TEXT    | NOT NULL, CHECK in (customer/staff/manager/admin) | Stored lowercase                          |
| `is_active`     | INTEGER | NOT NULL, DEFAULT 1, CHECK in (0,1)               | Soft-delete flag; SQLite has no boolean   |
| `created_at`    | TEXT    | NOT NULL, DEFAULT `datetime('now')`               | ISO-8601 UTC                              |
| `updated_at`    | TEXT    | NOT NULL, DEFAULT `datetime('now')`               | ISO-8601 UTC                              |

Index: `idx_users_role` on `role`, for admin screens that filter by role.

### Design decisions

- **Role as `TEXT` + `CHECK`, not a `roles` table.** The four roles are fixed by application logic;
  a join table would add a lookup to every permission check while buying flexibility we would not use.
  A typo like `'manger'` is rejected by the database.
- **`is_active` rather than deleting rows.** The permission matrix treats "deactivate" and "delete"
  as separate admin actions. Deactivating keeps the row so future orders and shifts referencing this
  user stay valid.

## `categories`

| Column                      | Type    | Constraints               | Notes                  |
| --------------------------- | ------- | ------------------------- | ---------------------- |
| `id`                        | INTEGER | PRIMARY KEY AUTOINCREMENT |                        |
| `name`                      | TEXT    | NOT NULL, UNIQUE          | Appetizers, Mains, ... |
| `description`               | TEXT    |                           |                        |
| `display_order`             | INTEGER | NOT NULL, DEFAULT 0       | Menu ordering          |
| `created_at` / `updated_at` | TEXT    | NOT NULL                  | ISO-8601 UTC           |

## `menu_items`

| Column                      | Type    | Constraints                                        | Notes                                    |
| --------------------------- | ------- | -------------------------------------------------- | ---------------------------------------- |
| `id`                        | INTEGER | PRIMARY KEY AUTOINCREMENT                          |                                          |
| `category_id`               | INTEGER | NOT NULL, FK → `categories(id)` ON DELETE RESTRICT | Cannot orphan an item                    |
| `name`                      | TEXT    | NOT NULL, UNIQUE per category                      |                                          |
| `description`               | TEXT    |                                                    |                                          |
| `price_cents`               | INTEGER | NOT NULL, >= 0                                     | **Whole cents, never dollars**           |
| `cost_cents`                | INTEGER | >= 0, nullable                                     | Ingredient cost; drives margin reporting |
| `special_price_cents`       | INTEGER | >= 0, nullable                                     | Flat override                            |
| `discount_percent`          | INTEGER | 1..99, nullable                                    | Percentage off                           |
| `special_starts_at`         | TEXT    | nullable                                           | Optional window start                    |
| `special_ends_at`           | TEXT    | nullable                                           | Optional window end                      |
| `image_path`                | TEXT    | nullable                                           | Filename only, served from `/api/images` |
| `is_available`              | INTEGER | NOT NULL, DEFAULT 1, CHECK in (0,1)                |                                          |
| `created_at` / `updated_at` | TEXT    | NOT NULL                                           |                                          |

Indexes on `category_id` and `is_available`.

### Design decisions

- **Money is `INTEGER` cents, not `REAL` dollars.** Floating point cannot represent 0.1 exactly, so
  `0.1 + 0.2 !== 0.3`. Stored in cents, every price is an exact integer and rounding happens once,
  when the frontend formats it for display.
- **A table-level `CHECK` forbids setting both `special_price_cents` and `discount_percent`.** Two
  competing discounts on one row has no correct answer, so the schema makes it unrepresentable.
- **`ON DELETE RESTRICT` on `category_id`.** Deleting a category with items would either orphan them
  or silently delete them; the API returns 409 with a count instead.
- **`UNIQUE (category_id, name)`** — duplicate names are fine across categories ("Water" as a
  beverage and a side), but not within one.
- **`cost_cents` is nullable, and null is not zero.** An item nobody has costed is excluded from
  margin reporting entirely; defaulting it to 0 would report it as 100% profit, which is worse
  than reporting nothing.

### Effective price

`backend/menu/pricing.js` computes what the customer actually pays, in this order:

1. No special or discount set → `price_cents`
2. Special set but today falls outside `special_starts_at`..`special_ends_at` → `price_cents`
3. `special_price_cents` set → that value
4. `discount_percent` set → `round(price_cents * (100 - discount) / 100)`

The API returns this as `effective_price_cents` alongside `price_cents`, plus an `is_on_special`
boolean, so the frontend never re-implements the rule.

## Scheduling

Weekdays are ISO-8601 throughout: **1 = Monday … 7 = Sunday**, and weeks start Monday. Times of
day are `'HH:MM'` (24-hour, zero-padded) so string comparison is chronological.

### `shift_templates`

A recurring weekly slot — "every Friday 17:00–01:00, three servers". Concrete shifts are generated
from these a week at a time. `UNIQUE (day_of_week, start_time, end_time, role)`.

### `shifts`

| Column                  | Notes                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `template_id`           | FK → `shift_templates`, **ON DELETE SET NULL** — deleting a rule keeps the history |
| `shift_date`            | The business day, for weekly grouping                                              |
| `starts_at` / `ends_at` | Absolute `'YYYY-MM-DD HH:MM:SS'` timestamps                                        |
| `role`                  | server / host / cleaner / cook                                                     |
| `required_staff`        | Drives coverage; default 1                                                         |

`CHECK (ends_at > starts_at)` and `UNIQUE (template_id, shift_date)`.

### `shift_assignments`, `staff_availability`, `notifications`

`shift_assignments` links users to shifts, `UNIQUE (shift_id, user_id)`, cascading on delete.
`staff_availability` is a recurring weekly window per user. `notifications` holds the simulated
schedule-change messages.

### Design decisions

- **Absolute timestamps, not a date plus two clock times.** A closing shift of 22:00–02:00 is a
  single unambiguous interval, so overlap testing is `a.starts_at < b.ends_at AND b.starts_at <
  a.ends_at` with no special case for crossing midnight. Storing two times would make that
  comparison wrong exactly on the shifts most likely to be double-booked.
- **`ON DELETE SET NULL` from shifts to templates.** Removing a recurring rule should not erase
  the weeks already worked; the shift survives, only its link to the rule is dropped.
- **`UNIQUE (template_id, shift_date)` makes generation idempotent.** SQLite treats NULLs as
  distinct, so this constrains generated shifts without restricting manually created ones.
- **All date maths is UTC.** `new Date('2026-08-10')` is timezone-dependent and can land a day
  early west of Greenwich, which would shift a whole generated week; the helpers append
  `'T00:00:00Z'` to pin it.

## Analytics

Two event tables feed the reporting dashboard. Both are append-only: rows are written as things
happen and never updated, so every report is a query over history rather than a counter that has
already thrown the detail away.

### `menu_item_views`

| Column         | Notes                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `menu_item_id` | FK → `menu_items`, ON DELETE CASCADE                                    |
| `user_id`      | FK → `users`, **ON DELETE SET NULL** — the view still counts afterwards |
| `viewed_at`    | `datetime('now')`                                                      |

Written by `GET /api/menu-items/:id` and `POST /api/menu-items/:id/view`. The **list** endpoint
deliberately does not count: appearing in a grid of everything is not the same as being looked at.

Indexes: `idx_views_viewed_at` on `viewed_at`, and `idx_views_item` on `(menu_item_id, viewed_at)`.

### `activity_log`

| Column        | Notes                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| `user_id`     | FK → `users`, ON DELETE SET NULL; null for unauthenticated requests     |
| `method`      | GET / POST / ...                                                       |
| `path`        | The **route pattern** (`/api/menu-items/:id`), not the raw URL          |
| `status`      | HTTP status the response carried                                       |
| `duration_ms` | Server-side handling time                                              |
| `created_at`  | `datetime('now')`                                                      |

Written by `backend/middleware/activity.js` on the response's `finish` event — after the last byte
is sent, so the insert is off the response path. Health checks and image requests are skipped.

Indexes: `idx_activity_created` on `created_at`, `idx_activity_user` on `(user_id, created_at)`.

### Design decisions

- **Raw events, not counters.** A `view_count` column on `menu_items` cannot answer "popular last
  week", "popular with whom", or support any date range at all. Rows are cheap; lost detail is not
  recoverable.
- **Route pattern rather than raw URL.** Grouping by `/api/menu-items/7` and `/api/menu-items/8`
  separately would scatter one endpoint across as many rows as there are items.
- **Ranges are compared against raw timestamps** (`viewed_at >= @start AND viewed_at < @end`),
  never `date(viewed_at) BETWEEN ...`. Wrapping the column in a function makes its index unusable,
  turning every report into a full table scan. `to` is converted to the start of the next day, so
  an event at 23:59 on the final day is still included.
- **Telemetry never breaks the request.** Both writers swallow and log their errors: a failed
  analytics insert must not turn a working page load into a 500.

## Image storage

Uploaded images live in the `menu-images` named volume at `/app/uploads` (`UPLOAD_DIR`), so they
survive `docker compose down` exactly like the database. Only the filename is stored in
`menu_items.image_path`; the directory is a deployment detail.

### Dish photography

The nine seed dishes ship with photographs, kept in `backend/seed-assets/dishes/` and attached by:

```
npm run attach-photos                              # host
docker compose exec backend node db/attach-photos.js   # container
```

This is a **separate step from `npm run seed`** because the two write to different places: the
seed writes rows to the database, `attach-photos` copies files into `UPLOAD_DIR`, and those are
two different volumes. Wiping either alone leaves the other stale, which is why the photographs
have their own command rather than riding along with the seed.

It is idempotent and conservative: an item that already has an image is left alone, so a photo
uploaded through the menu editor is never overwritten. `--force` replaces them anyway.

Sources, authors and licences are recorded in `backend/seed-assets/dishes/ATTRIBUTION.md`. All
nine came from Wikimedia Commons (CC0, CC BY or CC BY-SA) and were checked by eye against the
dish before being used — two are near-misses and say so in that file.

## Seed data

`npm run seed` (see `backend/db/seed.js`) creates one user per role. It is **idempotent** — it uses
`ON CONFLICT (email) DO NOTHING`, so re-running against the persisted volume is safe.

| Email                  | Role     |
| ---------------------- | -------- |
| `customer@example.com` | customer |
| `staff@example.com`    | staff    |
| `manager@example.com`  | manager  |
| `admin@example.com`    | admin    |

All share the password `Passw0rd!23`, overridable via the `SEED_PASSWORD` environment variable.
**Local development only — never seed these accounts into a deployed database.**

The menu itself is the Rokushichi board carried over from v1: four courses (Small Plates,
Noodles & Rice, From the Pot, Air Fryer) and nine dishes with honest ingredient costs, plus one
open-ended special — 26% off the curry udon, because it is yesterday's curry. Two rows are
deliberately awkward so the reporting paths are exercised by the seed rather than only in
production: Sesame Sauce Salad carries no cost (excluded from margin figures) and the potato
wedges ship off the menu.

The seed also writes **30 days of menu view history**, so the analytics dashboard has something to
show on a fresh database instead of an empty grid. It is deterministic (no `Math.random`), runs only
when `menu_item_views` is empty, and gives Friday and Saturday a heavier weighting so the trend line
has a realistic weekly rhythm. The **activity log is deliberately not seeded** — inventing response
times would make the system performance report lie; it fills up as soon as the app is used.

Run it inside the container, since `better-sqlite3` is compiled for Linux in the image:

```
docker compose exec backend npm run seed
```
