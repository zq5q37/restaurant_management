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
