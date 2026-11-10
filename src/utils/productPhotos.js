const Joi = require('joi');

const photoUrl = Joi.alternatives().try(
  Joi.string().uri({ scheme: ['https'] }).max(1024),
  Joi.string().pattern(/^\/inventario\/fotos\/[0-9a-f-]{36}\.(jpg|png|webp)$/),
);
const photosSchema = Joi.array().items(photoUrl).max(10).unique();

function productPhotos(product) {
  let photos = product?.fotos;
  if (typeof photos === 'string') photos = JSON.parse(photos);
  if (Array.isArray(photos)) return photos;
  return product?.foto_url ? [product.foto_url] : [];
}

// Older clients can still edit the cover without discarding the rest of the gallery.
function updatedProductPhotos(before, body) {
  if (body.fotos !== undefined) return body.fotos;
  const photos = productPhotos(before);
  if (body.foto_url === undefined || body.foto_url === (photos[0] || null)) return photos;
  return [...new Set([body.foto_url, ...photos.slice(1)].filter(Boolean))];
}

function serializeProductPhotos(product) {
  const fotos = productPhotos(product);
  return { ...product, fotos, foto_url: fotos[0] || null };
}

module.exports = { photoUrl, photosSchema, productPhotos, updatedProductPhotos, serializeProductPhotos };
