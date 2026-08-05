const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// Fail at startup rather than signing tokens with `undefined`, which would make
// every token forgeable by anyone who guessed the secret was empty.
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set — add it to docker-compose.yml or backend/.env');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, JWT_EXPIRES_IN };
