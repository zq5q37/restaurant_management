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

| Command                  | Containers | Data     |
| ------------------------ | ---------- | -------- |
| `docker compose down`    | removed    | **kept** |
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

| Column          | Type    | Constraints                                        | Notes                                     |
| --------------- | ------- | -------------------------------------------------- | ----------------------------------------- |
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT                           |                                           |
| `email`         | TEXT    | NOT NULL, UNIQUE                                    | Login identifier; UNIQUE implies an index |
| `password_hash` | TEXT    | NOT NULL                                            | bcrypt, cost 10 — never plaintext         |
| `full_name`     | TEXT    | NOT NULL                                            | Display name                              |
| `role`          | TEXT    | NOT NULL, CHECK in (customer/staff/manager/admin)   | Stored lowercase                          |
| `is_active`     | INTEGER | NOT NULL, DEFAULT 1, CHECK in (0,1)                 | Soft-delete flag; SQLite has no boolean   |
| `created_at`    | TEXT    | NOT NULL, DEFAULT `datetime('now')`                 | ISO-8601 UTC                              |
| `updated_at`    | TEXT    | NOT NULL, DEFAULT `datetime('now')`                 | ISO-8601 UTC                              |

Index: `idx_users_role` on `role`, for admin screens that filter by role.

### Design decisions

- **Role as `TEXT` + `CHECK`, not a `roles` table.** The four roles are fixed by application logic;
  a join table would add a lookup to every permission check while buying flexibility we would not use.
  A typo like `'manger'` is rejected by the database.
- **`is_active` rather than deleting rows.** The permission matrix treats "deactivate" and "delete"
  as separate admin actions. Deactivating keeps the row so future orders and shifts referencing this
  user stay valid.

## `categories`

| Column          | Type    | Constraints               | Notes                        |
| --------------- | ------- | ------------------------- | ---------------------------- |
| `id`            | INTEGER | PRIMARY KEY AUTOINCREMENT |                              |
| `name`          | TEXT    | NOT NULL, UNIQUE          | Appetizers, Mains, ...       |
| `description`   | TEXT    |                           |                              |
| `display_order` | INTEGER | NOT NULL, DEFAULT 0       | Menu ordering                |
| `created_at` / `updated_at` | TEXT | NOT NULL       | ISO-8601 UTC                 |

## `menu_items`

| Column                | Type    | Constraints                                  | Notes                                   |
| --------------------- | ------- | -------------------------------------------- | --------------------------------------- |
| `id`                  | INTEGER | PRIMARY KEY AUTOINCREMENT                    |                                         |
| `category_id`         | INTEGER | NOT NULL, FK → `categories(id)` ON DELETE RESTRICT | Cannot orphan an item            |
| `name`                | TEXT    | NOT NULL, UNIQUE per category                |                                         |
| `description`         | TEXT    |                                              |                                         |
| `price_cents`         | INTEGER | NOT NULL, >= 0                               | **Whole cents, never dollars**          |
| `special_price_cents` | INTEGER | >= 0, nullable                               | Flat override                           |
| `discount_percent`    | INTEGER | 1..99, nullable                              | Percentage off                          |
| `special_starts_at`   | TEXT    | nullable                                     | Optional window start                   |
| `special_ends_at`     | TEXT    | nullable                                     | Optional window end                     |
| `image_path`          | TEXT    | nullable                                     | Filename only, served from `/api/images`|
| `is_available`        | INTEGER | NOT NULL, DEFAULT 1, CHECK in (0,1)          |                                         |
| `created_at` / `updated_at` | TEXT | NOT NULL                              |                                         |

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

### Effective price

`backend/menu/pricing.js` computes what the customer actually pays, in this order:

1. No special or discount set → `price_cents`
2. Special set but today falls outside `special_starts_at`..`special_ends_at` → `price_cents`
3. `special_price_cents` set → that value
4. `discount_percent` set → `round(price_cents * (100 - discount) / 100)`

The API returns this as `effective_price_cents` alongside `price_cents`, plus an `is_on_special`
boolean, so the frontend never re-implements the rule.

## Image storage

Uploaded images live in the `menu-images` named volume at `/app/uploads` (`UPLOAD_DIR`), so they
survive `docker compose down` exactly like the database. Only the filename is stored in
`menu_items.image_path`; the directory is a deployment detail.

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

Run it inside the container, since `better-sqlite3` is compiled for Linux in the image:

```
docker compose exec backend npm run seed
```
