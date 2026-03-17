const crypto = require('crypto');

function generateOpaqueToken() {
  // 64 bytes => 512 bits of entropy
  // base64url keeps it cookie-safe.
  return crypto.randomBytes(64).toString('base64url');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const k = p.slice(0, idx);
    if (k !== name) continue;
    const v = p.slice(idx + 1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

function nowUtcDate() {
  return new Date();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

module.exports = {
  generateOpaqueToken,
  sha256Hex,
  getCookie,
  nowUtcDate,
  addDays,
};
