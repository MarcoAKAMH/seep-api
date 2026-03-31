const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
dotenv.config({
  path: path.resolve(__dirname, '..', '.env.local'),
  override: true,
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

// If running behind a reverse proxy (nginx, cloud load balancer), set TRUST_PROXY=1
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Middlewares
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    const allowed = process.env.CORS_ORIGIN;
    if (!allowed) return cb(null, true);
    const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
    // allow same-origin (no Origin header) and explicit allowlist
    if (!origin) return cb(null, true);
    if (list.includes(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido por la configuracion de CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

// Health
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// API
app.use('/api', routes);

// Errors
app.use(notFound);
app.use(errorHandler);

module.exports = app;
