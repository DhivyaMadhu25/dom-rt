const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'domrt',
  user:     process.env.DB_USER     || 'domrt_user',
  password: process.env.DB_PASSWORD || 'domrt_secret',
  max:      20,
  idleTimeoutMillis:      30000,
  connectionTimeoutMillis: 10000,   // increased from 2s to 10s
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
  // Don't crash the process on pool error
});

// Test connection on startup with retry
async function waitForDb(retries = 5, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] ✓ PostgreSQL connected');
      return;
    } catch (err) {
      console.error(`[DB] Connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) {
        console.error('[DB] ✗ Could not connect to PostgreSQL after', retries, 'attempts.');
        console.error('[DB]   Make sure PostgreSQL is running: brew services start postgresql@16');
        process.exit(1);
      }
      console.log(`[DB] Retrying in ${delayMs/1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// Wrap query for structured logging + latency tracking
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.debug(`[DB] query=${text.substring(0, 60)} duration=${duration}ms rows=${result.rowCount}`);
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '| SQL:', text.substring(0, 120));
    throw err;
  }
};

// Transaction helper
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, withTransaction, waitForDb };
