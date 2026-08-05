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
