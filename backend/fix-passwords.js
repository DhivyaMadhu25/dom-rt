/**
 * DOM-RT Setup Script
 * ─────────────────────────────────────────────────────────
 * Generates correct bcrypt hashes and seeds demo users/sites.
 * Run ONCE after loading schema.sql.
 *
 * Usage:
 *   cp .env.example .env   # fill in your DB credentials
 *   node fix-passwords.js
 *
 * SECURITY NOTE:
 *   Default demo password is intentionally weak for local
 *   development only. Change all passwords before any
 *   non-local deployment.
 * ─────────────────────────────────────────────────────────
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const crypto = require('crypto');

// If environment variables are missing, warn but continue with sensible defaults
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[Setup] Warning: missing environment variables: ${missing.join(', ')}. Using reasonable defaults where possible.`);
  console.warn('[Setup] Tip: copy .env.example to .env and fill in values for production use.');
}

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'domrt',
  user:     process.env.DB_USER || 'domrt_user',
  password: process.env.DB_PASSWORD || 'domrt_secret',
});

// Demo password — use env override or fall back to the README/example demo password
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || process.env.DEFAULT_PASSWORD || 'Password123!';

async function setup() {
  console.log('\n[Setup] DOM-RT Database Setup');
  console.log('[Setup] Connecting to database...');

  try {
    await pool.query('SELECT 1');
    console.log('[Setup] ✓ Database connected');
  } catch (err) {
    console.error('[Setup] ✗ Database connection failed:', err.message);
    console.error('[Setup] Check your .env file and ensure PostgreSQL is running.');
    process.exit(1);
  }

  // Generate bcrypt hash with cost factor 12
  console.log(`[Setup] Hashing demo password (bcrypt cost=12)...`);
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // Verify hash correctness before writing to DB
  const verified = await bcrypt.compare(DEMO_PASSWORD, hash);
  if (!verified) {
    console.error('[Setup] ✗ Hash verification failed');
    process.exit(1);
  }
  console.log('[Setup] ✓ Password hash verified');

  // Insert or update demo users
  const existing = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(existing.rows[0].count) === 0) {
    console.log('[Setup] Inserting demo users...');
    await pool.query(`
      INSERT INTO users (id, username, email, password_hash, role_id, region) VALUES
        ('a0000000-0000-0000-0000-000000000001', 'admin',    'admin@domrt.local',    $1, 1, 'HQ'),
        ('a0000000-0000-0000-0000-000000000002', 'manager1', 'manager1@domrt.local', $1, 2, 'East'),
        ('a0000000-0000-0000-0000-000000000003', 'auditor1', 'auditor1@domrt.local', $1, 3, 'HQ'),
        ('a0000000-0000-0000-0000-000000000004', 'viewer1',  'viewer1@domrt.local',  $1, 4, 'West')
      ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [hash]);
    console.log('[Setup] ✓ Demo users created');
  } else {
    await pool.query(
      "UPDATE users SET password_hash=$1 WHERE username IN ('admin','manager1','auditor1','viewer1')",
      [hash]
    );
    console.log('[Setup] ✓ Demo user passwords updated');
  }

  // Insert demo sites if missing
  const siteCount = await pool.query('SELECT COUNT(*) FROM sites');
  if (parseInt(siteCount.rows[0].count) === 0) {
    console.log('[Setup] Inserting demo sites...');
    await pool.query(`
      INSERT INTO sites (id,name,domain_type,location,region,scheduled_open,scheduled_close,status,responsible_user_id)
      VALUES
        ('b0000000-0000-0000-0000-000000000001','Downtown Branch',  'branch','New York, NY',   'East',   '09:00','17:00','inactive','a0000000-0000-0000-0000-000000000002'),
        ('b0000000-0000-0000-0000-000000000002','Midtown Store',    'store', 'New York, NY',   'East',   '08:00','20:00','inactive','a0000000-0000-0000-0000-000000000002'),
        ('b0000000-0000-0000-0000-000000000003','West Depot',       'depot', 'Los Angeles, CA','West',   '06:00','22:00','inactive','a0000000-0000-0000-0000-000000000002'),
        ('b0000000-0000-0000-0000-000000000004','North Clinic',     'clinic','Boston, MA',     'East',   '07:00','19:00','inactive','a0000000-0000-0000-0000-000000000002'),
        ('b0000000-0000-0000-0000-000000000005','Production Cell A','cell',  'Detroit, MI',    'Central','00:00','23:59','inactive','a0000000-0000-0000-0000-000000000002')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('[Setup] ✓ Demo sites created');
  }

  // Print a JWT secret suggestion if not set
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === '<CHANGE_THIS>') {
    const suggested = crypto.randomBytes(64).toString('hex');
    console.log('\n[Setup] ⚠ JWT_SECRET not set. Add this to your .env:');
    console.log(`         JWT_SECRET=${suggested}`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log('  DOM-RT setup complete!');
  console.log('──────────────────────────────────────────────');
  console.log('  Dashboard:  http://localhost:3000');
  console.log('  Accounts:   admin / manager1 / auditor1 / viewer1');
  console.log(`  Password:   ${DEMO_PASSWORD}`);
  console.log('  ⚠ Change passwords before any non-local use.');
  console.log('──────────────────────────────────────────────\n');

  await pool.end();
}

setup().catch(err => {
  console.error('[Setup] Fatal:', err.message);
  process.exit(1);
});
