## Day 1: 2026-08-03

**Yesterday:** -

**Today:**
- Stack fixed (Express / React / SQLite / JWT)
- Repo scaffolded with docs.
- Create permission matrix
- Set up Github Repo

**Blockers:** -

**Challenges & resolutions:**
- overwhelmed => break down tasks and decide what to do each day.

## Day 2: 2026-08-04

**Yesterday:** -

**Today:**
- Repo scaffolded with backend (Express generator, port 3000)
- Repo scaffolded with frontend (React app generator)
- Frontend connects with backend through vite.config.js
```js
proxy: {
      '/api': 'http://localhost:3000' // Routes local React /api requests directly to Express
    }
```
```js
// frontend
fetch('/api/message')

//backend
app.get('/api/message', (req, res) => {
  res.json({ message: "Hello from the Express backend meow!" });
});
```

**Blockers:** -

**Challenges & resolutions:** -

## Day 3: 2026-08-05

**Yesterday:** -

**Today:**
- Dockerise backend: `docker build -t backend ./backend` => `docker run --rm -p 5000:3000 backend` => `http://localhost:5000/api/health`
- Dockerise frontend: `docker build -t frontend ./frontend` => `docker run --rm -p 5173:5173 frontend` => See React Frontend
- Docker compose => `docker compose up --build`
- after build: `docker compose up`
- `users` table + seed one user per role (customer / staff / manager / admin)
  - `backend/db/schema.sql`, `backend/db/index.js`, `backend/db/seed.js`
  - `docker compose exec backend npm run seed` (must run in container, `better-sqlite3` is compiled for Linux)
  - role stored as TEXT + CHECK, not a roles table — 4 roles are fixed by app logic, no join needed
  - seed is idempotent via `ON CONFLICT (email) DO NOTHING`, safe to re-run over the persisted volume
  - filled in `docs/database-schema.md`
- SQLite volume: `sqlite-data:/app/data` => survives `down && up`, wiped by `down -v` (verified with a probe row)
- `migrate()` on boot in `server.js` => schema auto-created on fresh volume; seeding stays manual

**Blockers:** -

**Challenges & resolutions:**
- remember to `docker ps` and `docker kill id`
- proxy was at the top level of `vite.config.js` instead of inside `server` => Vite silently ignored it,
- target must be `http://backend:3000` (compose service name), not `localhost` — inside thefrontend container `localhost` is the frontend itself.

## Day 4: 2026-08-06

**Yesterday:** -

**Today:**
- Dropped `bartender` — `SHIFT_ROLES` is now server / host / cleaner / cook
- Schedule frontend (`Schedule.jsx`, `dates.js`, `schedule.css`): one week at a time, Week view (7 day cards) or Day view, day strip as picker, prev / next / today nav
  - one `GET /api/schedule/week` feeds both views — the day view is a filter, not a second request
  - date maths in UTC, mirroring `backend/schedule/dates.js`; overnight shifts marked `(+1)`
  - staff see their own shifts only (`scope: "own"`); coverage bar + staffing badges are manager+
- Manager/admin controls (`ShiftEditor.jsx`): create / edit / delete shift, assign / unassign staff, generate week from templates, publish week
  - assignment picker hides customers, deactivated users, and anyone already on the shift — all three are 409s from the API
  - overlap conflict shown with the clashing shift named
- Users tab (`Users.jsx`): manager sees a read-only list; admin gets role change, deactivate/reactivate, delete, create
  - self-lockout guards mirrored client-side — own row's controls disabled, so an admin never fires a request that can only 409
- Analytics dashboard, backend + frontend
  - new tables `menu_item_views` and `activity_log`, new `menu_items.cost_cents`; `migrate()` gained an idempotent ADD COLUMN step since `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table
  - `GET /api/analytics/{overview,popular-items,schedule,menu,system}?from=&to=`, all aggregated in SQL; `system` is admin-only
  - ranges compare raw timestamps, never `date(col) BETWEEN` — wrapping the column kills the index
  - `Analytics.jsx` + reusable SVG charts (`charts.jsx`): line, ranked bars, stacked columns, meters, stat tiles — no charting library
  - export: CSV from the API (RFC 4180, CRLF), PDF via a print stylesheet + the browser's print-to-PDF
  - seeded 30 days of view history (deterministic) so a fresh DB isn't an empty dashboard; activity log left unseeded on purpose
- Frontend redesign: ported the Rokushichi design system from `restaurant_management_v1` (brand + `huashu-design` skill)
  - two themes from one token set — dark "Lantern Alley", light "Cat Cafe", both sampled from photographs; every rule uses a token, a literal hex is a bug in whichever theme you aren't looking at
  - shell: amber brand plate with the enso mark, nav underline, page-head band per screen with a Japanese kicker, footer
  - menu became course bands with the lantern motif (which inverts to a painted signboard in the light theme for free)
  - shifts read as lit lanterns; understaffed carries a red edge rule + count badge + word, never colour alone
  - theme toggle with a sun/moon mask morph and a View Transitions circular wipe — no animation library
  - charts moved onto tokens, so both themes come from one set of rules

**Blockers:** -

**Challenges & resolutions:**
- `schedule.js` helper collided with `Schedule.jsx` on the case-insensitive Windows FS — `import from './Schedule'` resolved to the helper => renamed to `dates.js`
- `multer` was missing from `backend/package-lock.json` => `npm start` on the host crashed; `npm install` restored it. The Dockerfile runs `npm install`, not `npm ci`, so the image had been hiding it
- a leftover Docker port-forward held `localhost:5173` on IPv6 => host dev server only reachable on `127.0.0.1:5173`; `docker compose down` before running Vite outside Docker
- analytics tab switch crashed: the previous tab's payload was still in state while the next request was in flight, so `Popular` rendered against the overview's shape => tag the payload with the tab it came from and only render on a match
- an SVG at `width:100%` scales its whole coordinate system, so a 640-wide chart on a full-width page rendered 400px tall with 24px axis text => grid the cards to ~34rem columns so charts render near their natural size
- the chart pair inherited from v1 (ochre + sign red) FAILED the palette validator in the light theme — normal-vision ΔE 14.5 against a floor of 15, i.e. hard to tell apart even with full colour vision => swapped the second series to the street-lamp blue the token set already had, giving ΔE 18.0 light / 19.0 dark. Warm lantern vs cold lamp is also the right metaphor for "filled" vs "still needed"
- two validator flags kept deliberately and documented in `index.css` rather than silenced: the lantern amber sits above the dark-mode lightness band (it is the light source in the photograph), and the lamp sits below the chroma floor (what it encodes *is* absence)

## Day 5: 2026-08-07

**Yesterday:** -

**Today:** -

**Blockers:** -

**Challenges & resolutions:** -