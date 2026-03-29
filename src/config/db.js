const fs = require('fs');
const mysql = require('mysql2/promise');

function sslOptionsFromEnv() {
  if (String(process.env.DB_SSL || '').toLowerCase() !== 'true') return undefined;
  const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false';
  const ssl = { rejectUnauthorized };

  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    ssl.ca = fs.readFileSync(caPath, 'utf8');
  }

  return ssl;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'seep_taller',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
  namedPlaceholders: true,
  ssl: sslOptionsFromEnv(),
});

module.exports = { pool };
