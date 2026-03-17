function buildUpdateSet(data, allowedFields) {
  const fields = allowedFields.filter(k => data[k] !== undefined);
  if (fields.length === 0) return null;
  const set = fields.map(f => `\`${f}\` = :${f}`).join(', ');
  const values = {};
  for (const f of fields) values[f] = data[f];
  return { set, values, fields };
}

function buildInsert(data, allowedFields) {
  const fields = allowedFields.filter(k => data[k] !== undefined);
  if (fields.length === 0) return null;
  const cols = fields.map(f => `\`${f}\``).join(', ');
  const params = fields.map(f => `:${f}`).join(', ');
  const values = {};
  for (const f of fields) values[f] = data[f];
  return { cols, params, values, fields };
}

module.exports = { buildUpdateSet, buildInsert };
