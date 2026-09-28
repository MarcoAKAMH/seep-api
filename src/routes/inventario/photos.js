const express = require('express');
const router = express.Router();
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const asyncHandler = require('../../utils/asyncHandler');
const directory = path.resolve(process.env.INVENTORY_PHOTO_DIR || path.join(__dirname, '../../../uploads/inventory'));
const filenamePattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

router.post('/fotos', (req, res, next) => {
  if (!req.user.can_manage_inventory_catalog) return res.status(403).json({ message: 'Solo el administrador global puede cargar fotos.' });
  next();
}, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), asyncHandler(async (req, res) => {
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length < 12) return res.status(400).json({ message: 'Selecciona una imagen JPEG, PNG o WebP.' });
  let extension;
  if (data.subarray(0, 3).equals(Buffer.from([255,216,255])) && req.is('image/jpeg')) extension = 'jpg';
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && req.is('image/png')) extension = 'png';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' && req.is('image/webp')) extension = 'webp';
  if (!extension) return res.status(400).json({ message: 'El contenido no corresponde a una imagen permitida.' });
  await fs.mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(directory, filename), data, { flag: 'wx' });
  res.status(201).json({ foto_url: `/inventario/fotos/${filename}` });
}));

router.get('/fotos/:filename', asyncHandler(async (req, res, next) => {
  if (!filenamePattern.test(req.params.filename)) return res.status(404).json({ message: 'Foto no encontrada.' });
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(req.params.filename, { root: directory }, error => {
    if (error && !res.headersSent) {
      if (error.code === 'ENOENT' || error.status === 404) res.status(404).json({ message: 'Foto no encontrada.' });
      else next(error);
    }
  });
}));

module.exports = router;
