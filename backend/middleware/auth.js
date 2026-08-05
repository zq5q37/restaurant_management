const { verifyToken } = require('../auth/tokens');
const { db } = require('../db');

const selectUser = () =>
  db.prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?');

/** Rejects the request unless it carries a valid, unexpired token for an active user. */
function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({
      error: err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }

  // Re-read the user on every request. A JWT is valid until it expires, so without this
  // an admin who deactivates an account would have to wait out the token's lifetime.
  const user = selectUser().get(payload.sub);
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Account is no longer active' });
  }

  req.user = user;
  next();
}

/** Use after requireAuth: requireRole('manager', 'admin') */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
