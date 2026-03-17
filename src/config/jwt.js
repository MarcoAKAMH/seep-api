const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
// Access token should be short-lived; refresh tokens handle longer sessions.
// You can override with JWT_EXPIRES_IN, e.g. '15m'.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '10m';

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  signAccessToken,
  verifyToken,
  JWT_EXPIRES_IN,
};
