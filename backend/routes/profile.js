const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const PUBLIC_COLUMNS = 'id, email, full_name, role, is_active, created_at, updated_at';

// Matrix rows "View + edit own profile" and "Change own password" apply to every role, so these
// routes need authentication but no role check. Ownership is structural rather than checked:
// the row acted on is always req.user.id from the verified token, never an id from the client.
router.use(requireAuth);

const findById = (id) => db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id);

/** View own profile. */
router.get('/', (req, res) => {
  res.json({ user: findById(req.user.id) });
});

/** Edit own profile. Role and is_active are deliberately not editable here — those are admin-only. */
router.patch('/', (req, res) => {
  const { full_name, email } = req.body || {};

  if (full_name === undefined && email === undefined) {
    return res.status(400).json({ error: 'Provide full_name and/or email' });
  }

  const updates = {};

  if (full_name !== undefined) {
    if (typeof full_name !== 'string' || !full_name.trim()) {
      return res.status(400).json({ error: 'full_name must be a non-empty string' });
    }
    updates.full_name = full_name.trim();
  }

  if (email !== undefined) {
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'email must be a valid email address' });
    }
    const normalised = email.trim().toLowerCase();
    const taken = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?')
      .get(normalised, req.user.id);
    if (taken) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    updates.email = normalised;
  }

  const assignments = Object.keys(updates).map((col) => `${col} = @${col}`).join(', ');
  db.prepare(`UPDATE users SET ${assignments}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...updates, id: req.user.id });

  res.json({ user: findById(req.user.id) });
});

/** Change own password. */
router.patch('/password', (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (new_password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `new_password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }

  const { password_hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(req.user.id);

  // Requiring the current password means a stolen token alone cannot lock the owner out
  // of their own account by changing the password.
  if (!bcrypt.compareSync(current_password, password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (bcrypt.compareSync(new_password, password_hash)) {
    return res.status(400).json({ error: 'New password must differ from the current one' });
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(bcrypt.hashSync(new_password, BCRYPT_ROUNDS), req.user.id);

  res.status(204).end();
});

module.exports = router;
