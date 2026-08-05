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
