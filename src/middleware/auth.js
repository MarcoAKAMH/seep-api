const { verifyToken } = require('../config/jwt');

function required(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ message: 'Missing Bearer token' });

  try {
    const payload = verifyToken(match[1]);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid/expired token' });
  }
}

module.exports = { required };
