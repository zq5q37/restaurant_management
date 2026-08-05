# API Endpoints

Base URL `http://localhost:5000/api` (host) or `http://backend:3000/api` (inside the compose
network). The frontend reaches it as `/api/...` via the Vite proxy.

## Auth

### `POST /api/auth/login`

```json
{ "email": "admin@example.com", "password": "Passw0rd!23" }
```

**200**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 4, "email": "admin@example.com", "full_name": "Alex Admin", "role": "admin" }
}
```

| Status | When                                                        |
| ------ | ----------------------------------------------------------- |
| 400    | `email` or `password` missing / not a string                 |
| 401    | Unknown email, wrong password, **or** deactivated account    |

All three 401 cases return the identical body `{"error":"Invalid email or password"}`. Saying
"no such user" would let anyone probe which emails are registered. For the same reason an unknown
email is still compared against a dummy bcrypt hash, so the response time does not give it away.

### `GET /api/auth/me`

Requires `Authorization: Bearer <token>`. Returns the current user.

| Status | When                                     |
| ------ | ---------------------------------------- |
| 401    | Header missing or not `Bearer <token>`   |
| 401    | Token invalid or expired                 |
| 401    | User deleted or deactivated since issue  |

## Tokens

HS256 JWT signed with `JWT_SECRET`, expiring after `JWT_EXPIRES_IN` (default `8h`). Payload is
`{ sub: <user id>, email, role }`.

`JWT_SECRET` is set in `docker-compose.yml` for local development only. The server **refuses to
start** if it is unset, rather than signing with `undefined`. Any deployed environment must supply
its own secret from the host.

## Profile (own record)

All require `Authorization: Bearer <token>`. Available to **every** role — these are the matrix rows
"View + edit own profile" and "Change own password", which are ownership rules, not role rules.

| Endpoint                       | Body                                  | Success |
| ------------------------------ | ------------------------------------- | ------- |
| `GET /api/profile`             | —                                     | 200     |
| `PATCH /api/profile`           | `{ full_name?, email? }`              | 200     |
| `PATCH /api/profile/password`  | `{ current_password, new_password }`  | 204     |

**There is no `:id` in these URLs.** The row acted on is always `req.user.id`, taken from the
verified token, so a client cannot address another user's record at all. This is why no ownership
comparison appears in the code: ownership is structural rather than checked, which removes the
possibility of an IDOR bug rather than guarding against one.

`PATCH /api/profile` accepts only `full_name` and `email`. `role` and `is_active` are ignored if
sent — they are admin-only via `/api/users/:id/role` and `/api/users/:id/active`, so a user cannot
promote themselves by editing their own profile.

| Status | When                                                                     |
| ------ | ------------------------------------------------------------------------ |
| 400    | Neither field supplied, blank `full_name`, malformed `email`             |
| 409    | `email` already belongs to another user                                  |

Password change requires `current_password`, so a stolen token alone cannot be used to lock the
owner out. New password must be at least 8 characters and differ from the current one.

| Status | When                              |
| ------ | --------------------------------- |
| 400    | Missing field, too short, unchanged |
| 401    | `current_password` incorrect      |

> Changing a password does **not** invalidate tokens already issued — they remain valid until they
> expire. Real revocation needs a token version column or a blocklist.

## Users (Administration)

All require `Authorization: Bearer <token>`. Roles come straight from the Administration section of
[permission-matrix.md](permission-matrix.md).

| Endpoint                       | Customer | Staff | Manager | Admin | Matrix row                         |
| ------------------------------ | :------: | :---: | :-----: | :---: | ---------------------------------- |
| `GET /api/users`               |   403    |  403  |   200   |  200  | List all users                     |
| `POST /api/users`              |   403    |  403  |   403   |  201  | Create user                        |
| `PATCH /api/users/:id/role`    |   403    |  403  |   403   |  200  | Change a user's role               |
| `PATCH /api/users/:id/active`  |   403    |  403  |   403   |  200  | Deactivate user                    |
| `DELETE /api/users/:id`        |   403    |  403  |   403   |  204  | Delete user                        |

No token on any of these returns 401 rather than 403 — the request is unauthenticated, not
merely unauthorised.

`POST /api/users` body: `{ email, password, full_name, role }`. Email is lowercased; the password is
bcrypt-hashed before storage. `password_hash` is never included in any response.

| Status | When                                                        |
| ------ | ----------------------------------------------------------- |
| 400    | Missing field, or `role` outside the four valid values       |
| 404    | `:id` does not exist                                         |
| 409    | Duplicate email, or an admin targeting their own account     |

### Self-lockout guards

An admin cannot demote, deactivate, or delete **their own** account (409). Without this, the last
admin could remove the system's only means of administering it.

## Menu

All require `Authorization: Bearer <token>`. Write access is manager+ throughout, per the Menu
section of [permission-matrix.md](permission-matrix.md).

| Endpoint                                  | Customer | Staff | Manager | Admin |
| ----------------------------------------- | :------: | :---: | :-----: | :---: |
| `GET /api/categories`                     |    ✓     |   ✓   |    ✓    |   ✓   |
| `POST/PATCH/DELETE /api/categories[/:id]` |   403    |  403  |    ✓    |   ✓   |
| `GET /api/menu-items`                     |  ✓ (1)   |   ✓   |    ✓    |   ✓   |
| `POST/PATCH/DELETE /api/menu-items[/:id]` |   403    |  403  |    ✓    |   ✓   |
| `PATCH /api/menu-items/:id/availability`  |   403    |  403  |    ✓    |   ✓   |
| `PATCH /api/menu-items/:id/pricing`       |   403    |  403  |    ✓    |   ✓   |
| `POST/DELETE /api/menu-items/:id/image`   |   403    |  403  |    ✓    |   ✓   |

(1) Customers see **only available items**. This is enforced in the query, not as a default the
client can override — `?available=false` from a customer still returns available items only, and
`GET /api/menu-items/:id` for an unavailable item returns 404 rather than 200.

### Search and filtering

`GET /api/menu-items?q=&category_id=&available=&sort=&limit=&offset=`

| Param         | Values                          | Notes                                        |
| ------------- | ------------------------------- | -------------------------------------------- |
| `q`           | free text                       | Matches name or description; `%` and `_` are escaped so they match literally |
| `category_id` | integer                         | 400 if not an integer                        |
| `available`   | `true` / `false`                | Ignored for customers                        |
| `sort`        | `name`, `price`, `newest`       | Default: category display order, then name   |
| `limit`       | 1..200                          | Default 100                                  |
| `offset`      | integer                         | Default 0                                    |

Response: `{ items, total, limit, offset }`. Each item carries `price_cents`,
`effective_price_cents`, `is_on_special` and `category_name`.

### Pricing

`PATCH /api/menu-items/:id/pricing` accepts any of `price_cents`, `special_price_cents`,
`discount_percent`, `special_starts_at`, `special_ends_at`. Send `null` to clear a field.

Validation runs against the row **as it will be after the patch**, not just the fields sent — so
adding a `discount_percent` to an item that already has a `special_price_cents` is rejected, even
though the request itself only contains one of them.

| Status | When                                                                |
| ------ | ------------------------------------------------------------------- |
| 400    | Non-integer price, `discount_percent` outside 1–99, both special and discount set, special above base price, end before start |

### Image upload

`POST /api/menu-items/:id/image` — `multipart/form-data`, field name `image`.

| Status | When                                                    |
| ------ | -------------------------------------------------------- |
| 413    | Larger than 2 MB                                         |
| 415    | Declared Content-Type not JPEG/PNG/WebP                  |
| 415    | **File content** is not actually a JPEG/PNG/WebP         |
| 400    | No file in the `image` field                             |

Two separate checks, because `Content-Type` comes from the client and is trivially spoofed. A shell
script sent as `image/png` passes the first check and is caught by the second, which reads the
file's magic bytes and deletes it. Stored filenames are random UUIDs, so a crafted filename cannot
traverse directories or overwrite an existing file.

Images are served from `GET /api/images/:filename` **without authentication** — filenames are
unguessable UUIDs, and requiring a bearer token would stop the browser loading them in `<img>`.
Replacing or deleting an item's image removes the old file from disk.

## Scheduling

All require `Authorization: Bearer <token>`. Weekdays are ISO-8601 (1 = Monday … 7 = Sunday);
weeks start Monday and any `week_start` is snapped back to its Monday.

| Endpoint | Customer | Staff | Manager | Admin |
| -------- | :------: | :---: | :-----: | :---: |
| `GET /api/shifts`, `GET /api/shifts/:id` | own | own | all | all |
| `POST/PATCH/DELETE /api/shifts[/:id]` | 403 | 403 | ✓ | ✓ |
| `POST/DELETE /api/shifts/:id/assignments[/:userId]` | 403 | 403 | ✓ | ✓ |
| `GET/POST/PATCH/DELETE /api/shift-templates[/:id]` | 403 | 403 | ✓ | ✓ |
| `POST /api/schedule/generate`, `/publish` | 403 | 403 | ✓ | ✓ |
| `GET /api/schedule/week` | own | own | all | all |
| `GET /api/schedule/coverage` | 403 | 403 | ✓ | ✓ |
| `GET/POST /api/availability`, `DELETE /:id` | own | own | any | any |
| `GET /api/notifications`, `PATCH /:id/read`, `POST /read-all` | own | own | own | own |

Staff results are restricted to shifts they are assigned to — the response carries
`scope: "own"` or `"all"` so a client knows which it received. It is not a filter staff can
turn off.

### Generating a week

`POST /api/schedule/generate { week_start }` creates one shift per active template for that week.
**Idempotent** — re-running adds only what is missing, so a manager can add a template mid-week and
generate again without duplicating. Returns `shifts_created` and `shifts_skipped`.

### Conflict detection

Assigning a user to a shift overlapping one they already work returns **409** with the offending
`conflicting_shift_id`. The same check runs when a shift is *moved*, since editing times can push an
existing assignee into a clash. Overlap is tested on absolute timestamps, so a 17:00–01:00 shift and
a 22:00–02:00 shift on the same evening are correctly detected as overlapping.

Also rejected: assigning the same person twice (409), a deactivated user (409), or a customer (409).

### Coverage

`GET /api/schedule/coverage?week_start=` returns `total_shifts`, `covered_shifts`,
`uncovered_shifts`, `staff_needed`, and a `gaps` array where each entry carries `missing`.

### Notifications (simulated)

Rows are written on assignment, unassignment, shift edits, shift deletion, and
`POST /api/schedule/publish`. No email or push is sent — recipients read them from
`GET /api/notifications`, which also returns an `unread` count.

## Middleware

From `backend/middleware/auth.js`:

- `requireAuth` — validates the bearer token and sets `req.user`.
- `requireRole(...roles)` — use after `requireAuth`, e.g. `requireRole('manager', 'admin')`.
  Responds 403 when the role does not match. Maps directly onto
  [permission-matrix.md](permission-matrix.md).

```js
router.get('/admin/users', requireAuth, requireRole('admin'), handler);
```

`requireAuth` re-reads the user from the database on every request rather than trusting the token
payload. A JWT stays valid until it expires, so without that re-read, deactivating an account would
not take effect until the token ran out.
