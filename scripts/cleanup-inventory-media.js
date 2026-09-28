const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');
const photoDirectory = path.resolve(process.env.INVENTORY_PHOTO_DIR || path.join(__dirname, '../uploads/inventory'));
const evidenceDirectory = path.resolve(process.env.INVENTORY_COUNT_EVIDENCE_DIR || path.join(__dirname, '../uploads/inventory-counts'));
const mediaPattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

async function files(directory) { try { return (await fs.readdir(directory, { withFileTypes: true })).filter(item => item.isFile() && mediaPattern.test(item.name)).map(item => item.name); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function cleanupInventoryMedia({ apply = false } = {}) {
  const orphanDays = Math.max(1, Number(process.env.INVENTORY_ORPHAN_MEDIA_DAYS || 30));
  const evidenceDays = Math.max(30, Number(process.env.INVENTORY_EVIDENCE_RETENTION_DAYS || 365));
  const cutoffOrphan = Date.now() - orphanDays * 86400000;
  const [photoRows] = await pool.query("SELECT foto_url FROM inv_producto WHERE foto_url LIKE '/inventario/fotos/%'");
  const [expiredEvidence] = await pool.query(`SELECT d.id,d.evidencia_url FROM inv_conteo_ciclico_detalle d JOIN inv_conteo_ciclico c ON c.id=d.conteo_id
    WHERE d.evidencia_url IS NOT NULL AND c.estado IN ('COMPLETADO','CANCELADO') AND COALESCE(d.contado_at,c.created_at)<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)`, [evidenceDays]);
  const referencedPhotos = new Set(photoRows.map(row => String(row.foto_url).split('/').pop()));
  const orphanPhotos = [];
  for (const name of await files(photoDirectory)) { const info = await fs.stat(path.join(photoDirectory, name)); if (!referencedPhotos.has(name) && info.mtimeMs < cutoffOrphan) orphanPhotos.push(name); }
  const referencedEvidence = new Set(expiredEvidence.map(row => String(row.evidencia_url).split('/').pop()));
  const allEvidenceReferences = new Set((await pool.query("SELECT evidencia_url FROM inv_conteo_ciclico_detalle WHERE evidencia_url IS NOT NULL"))[0].map(row => String(row.evidencia_url).split('/').pop()));
  const orphanEvidence = [];
  for (const name of await files(evidenceDirectory)) { const info = await fs.stat(path.join(evidenceDirectory, name)); if (!allEvidenceReferences.has(name) && info.mtimeMs < cutoffOrphan) orphanEvidence.push(name); }
  if (apply) {
    for (const row of expiredEvidence) await pool.query("UPDATE inv_conteo_ciclico_detalle SET evidencia_url=NULL WHERE id=? AND evidencia_url=?", [row.id, row.evidencia_url]);
    for (const name of orphanPhotos) await fs.rm(path.join(photoDirectory, name), { force: true });
    for (const name of orphanEvidence) await fs.rm(path.join(evidenceDirectory, name), { force: true });
    for (const name of referencedEvidence) await fs.rm(path.join(evidenceDirectory, name), { force: true });
  }
  return { apply, orphan_days: orphanDays, evidence_retention_days: evidenceDays, orphan_product_photos: orphanPhotos, orphan_count_evidence: orphanEvidence, expired_count_evidence: expiredEvidence.length };
}

if (require.main === module) cleanupInventoryMedia({ apply: process.argv.includes('--apply') }).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = { cleanupInventoryMedia };
