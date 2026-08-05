const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
const ROLES = ['customer', 'staff', 'manager', 'admin'];

// Never select password_hash into a response.
const PUBLIC_COLUMNS = 'id, email, full_name, role, is_active, created_at, updated_at';

// Every route below is behind authentication; the per-row rules come from
// docs/permission-matrix.md (Administration section).
router.use(requireAuth);

/** Matrix: "List all users" — Manager, Admin */
router.get('/', requireRole('manager', 'admin'), (req, res) => {
  res.json({ users: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY id`).all() });
});

/** Matrix: "Create user / change a user's role" — Admin only */
router.post('/', requireRole('admin'), (req, res) => {
  const { email, password, full_name, role } = req.body || {};

  if (![email, password, full_name, role].every((v) => typeof v === 'string' && v)) {
    return res.status(400).json({ error: 'email, password, full_name and role are required' });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }

  const normalisedEmail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalisedEmail)) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  const info = db
    .prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(normalisedEmail, bcrypt.hashSync(password, BCRYPT_ROUNDS), full_name, role);

  res
    .status(201)
    .json({ user: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(info.lastInsertRowid) });
});

/** Matrix: "Create user / change a user's role" — Admin only */
router.patch('/:id/role', requireRole('admin'), (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
  }

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // An admin demoting themselves could leave the system with no admin at all.
  if (target.id === req.user.id && role !== 'admin') {
    return res.status(409).json({ error: 'You cannot change your own role' });
  }

  db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
    .run(role, target.id);

  res.json({ user: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(target.id) });
});

/** Matrix: "Deactivate or delete user" — Admin only */
router.patch('/:id/active', requireRole('admin'), (req, res) => {
  const { is_active } = req.body || {};
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be true or false' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.id === req.user.id && is_active === false) {
    return res.status(409).json({ error: 'You cannot deactivate your own account' });
  }

  db.prepare("UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?")
    .run(is_active ? 1 : 0, target.id);

  res.json({ user: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(target.id) });
});

/** Matrix: "Deactivate or delete user" — Admin only */
router.delete('/:id', requireRole('admin'), (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.id === req.user.id) {
    return res.status(409).json({ error: 'You cannot delete your own account' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.status(204).end();
});

module.exports = router;
