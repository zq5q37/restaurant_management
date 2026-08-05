const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { signToken } = require('../auth/tokens');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Compared against when the email is unknown, so a missing account costs the same time as a
// wrong password. Without it, response timing tells an attacker which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 10);

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());

  const passwordMatches = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

  // One message for all three failures — unknown email, wrong password, deactivated account.
  // Distinguishing them would confirm to an attacker which emails exist.
  if (!user || !passwordMatches || !user.is_active) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
