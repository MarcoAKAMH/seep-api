const express = require('express');
const Joi = require('joi');
const bcrypt = require('bcryptjs');

const validate = require('../../middleware/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { pool } = require('../../config/db');
const { signAccessToken } = require('../../config/jwt');
const { required, loadUserAccessProfile } = require('../../middleware/auth');
const { generateOpaqueToken, sha256Hex, getCookie, nowUtcDate, addDays } = require('../../utils/refreshTokens');

const router = express.Router();
const LOGIN_ERROR_MESSAGE = 'Error de validacion. Verifica tus credenciales.';

// ---- Config ----
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'seep_rt';
const REFRESH_DAYS_REMEMBER = Number(process.env.REFRESH_DAYS_REMEMBER || 30);
const REFRESH_DAYS_SESSION = Number(process.env.REFRESH_DAYS_SESSION || 1);
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(); // 'lax' | 'strict' | 'none'
const COOKIE_SECURE = (process.env.COOKIE_SECURE
  ? String(process.env.COOKIE_SECURE).toLowerCase() === 'true'
  : process.env.NODE_ENV === 'production');

function setRefreshCookie(res, token, opts) {
  const { remember, maxAgeMs } = opts || {};
  // If remember=false => session cookie (no maxAge) for better security.
  const ttlMs = typeof maxAgeMs === 'number'
    ? maxAgeMs
    : (remember === false ? 0 : REFRESH_DAYS_REMEMBER * 24 * 60 * 60 * 1000);

  const cookieOpts = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: '/api/auth',
  };

  // If ttlMs is 0/undefined, make it a session cookie (no maxAge).
  if (ttlMs && ttlMs > 0) cookieOpts.maxAge = ttlMs;

  res.cookie(REFRESH_COOKIE_NAME, encodeURIComponent(token), cookieOpts);
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: '/api/auth',
  });
}

// Simple in-memory rate limiter for login/refresh (per IP)
// NOTE: For multi-instance deployments, replace with Redis-backed limiter.
const rl = new Map();
function rateLimit({ keyPrefix, windowMs, max }) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const cur = rl.get(key);
    if (!cur || now > cur.resetAt) {
      rl.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (cur.count >= max) {
      const retryAfter = Math.ceil((cur.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message: 'Demasiados intentos. Intenta más tarde.' });
    }
    cur.count += 1;
    return next();
  };
}

const loginSchema = Joi.object({
  correo: Joi.string().email().max(160).required(),
  password: Joi.string().min(6).max(200).required(),
  remember: Joi.boolean().default(true),
});

// Dev/demo only: create a user in `usuario` table with bcrypt hash.
const registerSchema = Joi.object({
  correo: Joi.string().email().max(160).required(),
  password: Joi.string().min(8).max(200).required(),
  nombre: Joi.string().max(160).required(),
  activo: Joi.boolean().truthy(1).falsy(0).default(true),
});

async function issueTokens({ res, user, remember, req }) {
  const accessProfile = await loadUserAccessProfile(user.id);
  const accessToken = signAccessToken({ sub: String(user.id), correo: user.correo, nombre: user.nombre });

  const refreshToken = generateOpaqueToken();
  const tokenHash = sha256Hex(refreshToken);
  const now = nowUtcDate();
  const expiresAt = addDays(now, remember ? REFRESH_DAYS_REMEMBER : REFRESH_DAYS_SESSION);

  await pool.query(
    `INSERT INTO auth_refresh_token (usuario_id, token_hash, is_persistent, expires_at, ip, user_agent)
     VALUES (:usuario_id, :token_hash, :is_persistent, :expires_at, :ip, :user_agent)`,
    {
      usuario_id: user.id,
      token_hash: tokenHash,
      is_persistent: remember ? 1 : 0,
      expires_at: expiresAt,
      ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || null,
      user_agent: (req.headers['user-agent'] || '').toString().slice(0, 255) || null,
    }
  );

  setRefreshCookie(res, refreshToken, { remember });

  return {
    accessToken,
    authUser: {
      id: user.id,
      correo: user.correo,
      nombre: user.nombre,
      ...accessProfile,
    },
  };
}

router.post(
  '/login',
  rateLimit({ keyPrefix: 'login', windowMs: 15 * 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) return res.status(401).json({ message: LOGIN_ERROR_MESSAGE });

    const { correo, password, remember } = value;

    const [rows] = await pool.query(
      'SELECT id, correo, password_hash, nombre, activo FROM usuario WHERE correo = :correo LIMIT 1',
      { correo }
    );
    const user = rows[0];
    if (!user || !user.activo) return res.status(401).json({ message: LOGIN_ERROR_MESSAGE });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: LOGIN_ERROR_MESSAGE });

    const { accessToken, authUser } = await issueTokens({ res, user, remember, req });

    return res.json({
      token: accessToken,
      user: authUser,
    });
  })
);

router.post(
  '/refresh',
  rateLimit({ keyPrefix: 'refresh', windowMs: 5 * 60 * 1000, max: 60 }),
  asyncHandler(async (req, res) => {
    const rt = getCookie(req, REFRESH_COOKIE_NAME);
    if (!rt) return res.status(401).json({ message: 'No se envio el refresh token.' });

    const hash = sha256Hex(rt);

    const [rows] = await pool.query(
      `SELECT id, usuario_id, is_persistent, expires_at, revoked_at
       FROM auth_refresh_token
       WHERE token_hash = :hash
       LIMIT 1`,
      { hash }
    );

    const record = rows[0];

    // Token not found -> maybe cleared cookie or invalid.
    if (!record) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'El refresh token es invalido.' });
    }

    // If revoked and still presented => possible token reuse / stolen token.
    if (record.revoked_at) {
      // Revoke ALL tokens for this user as a safety measure.
      await pool.query(
        `UPDATE auth_refresh_token
         SET revoked_at = IFNULL(revoked_at, NOW())
         WHERE usuario_id = :usuario_id`,
        { usuario_id: record.usuario_id }
      );
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'El refresh token fue revocado.' });
    }

    // Expired
    if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
      await pool.query('UPDATE auth_refresh_token SET revoked_at = NOW() WHERE id = :id', { id: record.id });
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'El refresh token ya expiro.' });
    }

    // Rotate refresh token
    const [uRows] = await pool.query(
      'SELECT id, correo, nombre, activo FROM usuario WHERE id = :id LIMIT 1',
      { id: record.usuario_id }
    );
    const user = uRows[0];
    if (!user || !user.activo) {
      await pool.query('UPDATE auth_refresh_token SET revoked_at = NOW() WHERE id = :id', { id: record.id });
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'Usuario inactivo' });
    }

    const newRefreshToken = generateOpaqueToken();
    const newHash = sha256Hex(newRefreshToken);

    await pool.query(
      'UPDATE auth_refresh_token SET revoked_at = NOW(), replaced_by_hash = :newHash WHERE id = :id',
      { id: record.id, newHash }
    );

    const now = nowUtcDate();
    const expiresAt = record.expires_at ? new Date(record.expires_at) : addDays(now, REFRESH_DAYS_REMEMBER);
    const remainingMs = expiresAt.getTime() - now.getTime();

    if (remainingMs <= 0) {
      clearRefreshCookie(res);
      return res.status(401).json({ message: 'El refresh token ya expiro.' });
    }

    await pool.query(
      `INSERT INTO auth_refresh_token (usuario_id, token_hash, is_persistent, expires_at, ip, user_agent)
       VALUES (:usuario_id, :token_hash, :is_persistent, :expires_at, :ip, :user_agent)`,
      {
        usuario_id: user.id,
        token_hash: newHash,
        is_persistent: record.is_persistent ? 1 : 0,
        expires_at: expiresAt,
        ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || null,
        user_agent: (req.headers['user-agent'] || '').toString().slice(0, 255) || null,
      }
    );

    // Keep the original session expiry (no infinite extension) but rotate token value.
    setRefreshCookie(res, newRefreshToken, record.is_persistent ? { maxAgeMs: remainingMs } : { remember: false });

    const accessProfile = await loadUserAccessProfile(user.id);
    const accessToken = signAccessToken({ sub: String(user.id), correo: user.correo, nombre: user.nombre });

    return res.json({
      token: accessToken,
      user: { id: user.id, correo: user.correo, nombre: user.nombre, ...accessProfile },
    });
  })
);

router.post('/logout', asyncHandler(async (req, res) => {
  const rt = getCookie(req, REFRESH_COOKIE_NAME);
  if (rt) {
    const hash = sha256Hex(rt);
    await pool.query(
      'UPDATE auth_refresh_token SET revoked_at = IFNULL(revoked_at, NOW()) WHERE token_hash = :hash',
      { hash }
    );
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

// Optional demo endpoint (disable in production)
if (process.env.NODE_ENV !== 'production') {
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { correo, password, nombre, activo } = req.body;

  const [exists] = await pool.query('SELECT id FROM usuario WHERE correo = :correo LIMIT 1', { correo });
  if (exists[0]) return res.status(409).json({ message: 'Correo ya registrado' });

  const password_hash = await bcrypt.hash(password, 10);

  const [result] = await pool.query(
    'INSERT INTO usuario (correo, password_hash, nombre, activo) VALUES (:correo, :password_hash, :nombre, :activo)',
    { correo, password_hash, nombre, activo: activo ? 1 : 0 }
  );

  return res.status(201).json({ id: result.insertId, correo, nombre, activo });
}));
}

router.get('/me', required, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
