const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const { pool } = require('../src/config/db');
const { syncInventoryAlerts } = require('../src/services/inventoryAlerts');

syncInventoryAlerts().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
