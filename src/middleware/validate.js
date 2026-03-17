function getFieldName(path) {
  if (!Array.isArray(path) || path.length === 0) return 'valor';
  return path.join('.');
}

function translateValidationDetail(detail) {
  const field = getFieldName(detail.path);
  const label = `"${field}"`;

  switch (detail.type) {
    case 'any.required':
      return `El campo ${label} es obligatorio.`;
    case 'string.empty':
      return `El campo ${label} no puede ir vacio.`;
    case 'string.base':
      return `El campo ${label} debe ser texto.`;
    case 'string.email':
      return `El campo ${label} debe ser un correo electronico valido.`;
    case 'string.max':
      return `El campo ${label} no puede tener mas de ${detail.context.limit} caracteres.`;
    case 'string.min':
      return `El campo ${label} debe tener al menos ${detail.context.limit} caracteres.`;
    case 'string.pattern.base':
      return `El campo ${label} tiene un formato invalido.`;
    case 'number.base':
      return `El campo ${label} debe ser un numero.`;
    case 'number.integer':
      return `El campo ${label} debe ser un numero entero.`;
    case 'number.min':
      return `El campo ${label} debe ser mayor o igual a ${detail.context.limit}.`;
    case 'number.max':
      return `El campo ${label} debe ser menor o igual a ${detail.context.limit}.`;
    case 'date.base':
    case 'date.format':
    case 'date.iso':
      return `El campo ${label} debe tener una fecha valida en formato ISO.`;
    case 'boolean.base':
      return `El campo ${label} debe ser verdadero o falso.`;
    case 'object.min':
      return `Debes enviar al menos ${detail.context.limit} campo para actualizar.`;
    default:
      return detail.message;
  }
}

module.exports = function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      return res.status(400).json({
        message: 'Error de validacion.',
        details: error.details.map(d => ({ message: translateValidationDetail(d), path: d.path })),
      });
    }
    req[property] = value;
    return next();
  };
};
