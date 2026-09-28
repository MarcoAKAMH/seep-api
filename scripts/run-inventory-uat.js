const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', 'test/mysql-inventory.test.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, SEEP_MYSQL_TESTS: '1' }, stdio: 'inherit' });
process.exitCode = result.status === null ? 1 : result.status;
