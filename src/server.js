const app = require('./app');

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SEEP API listening on http://localhost:${PORT}`);
});
