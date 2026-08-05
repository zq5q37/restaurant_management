const express = require('express');
const cors = require('cors');
const { UPLOAD_DIR } = require('./middleware/upload');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/menu-items', require('./routes/menuItems'));

// Uploaded images are served unauthenticated: filenames are random UUIDs, so they are not
// enumerable, and requiring a bearer token would stop the browser from loading them in <img>.
app.use('/api/images', express.static(UPLOAD_DIR, {
  maxAge: '1d',
  fallthrough: false,
  index: false,
}));

// Unknown /api route — answer in JSON rather than Express's default HTML page, which is what
// made the frontend report "Unexpected token '<'" back when the proxy was misconfigured.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.baseUrl}${req.path}` });
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
});

module.exports = app;
