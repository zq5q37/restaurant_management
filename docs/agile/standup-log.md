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
- 

**Blockers:** -

**Challenges & resolutions:** -

## Day 4: 2026-08-06

**Yesterday:** -

**Today:** -

**Blockers:** -

**Challenges & resolutions:** -

## Day 5: 2026-08-07

**Yesterday:** -

**Today:** -

**Blockers:** -

**Challenges & resolutions:** -