const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({
  ...config.database,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 10000,
});

pool.on('error', (error) => {
  console.error(
    'Connexion PostgreSQL inactive interrompue :',
    error.code || error.message
  );
});

module.exports = pool;