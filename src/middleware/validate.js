module.exports = function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      return res.status(400).json({
        message: 'Validation error',
        details: error.details.map(d => ({ message: d.message, path: d.path })),
      });
    }
    req[property] = value;
    return next();
  };
};
