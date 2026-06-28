/**
 * RQ3: Audit Log Traceability
 * ─────────────────────────────────────────────────────────
 * Measures audit log completeness and correlation chain
 * reconstruction accuracy.
 *
 * Paper Table 8 target:
 *   Operational actions recorded:          100%
 *   Audit records with valid user ID:       100%
 *   Audit records with valid site ID:       100%
 *   Audit records with valid timestamp:     100%
 *   Events reconstructable via corr ID:    99.8%
 *
 * Usage:
 *   node scripts/evaluation/rq3-audit.js
 * ─────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: './backend/.env' });
const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:4000';

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url     = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + (url.search || ''), method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const res = await httpRequest('POST', '/api/auth/login', {
    username: 'admin',
    password: process.env.DEMO_PASSWORD || 'DomRT_Demo_2026!',
  });
  if (!res.body.token) throw new Error('Login failed');
  return res.body.token;
}

// Generate a controlled set of operations with known correlation IDs
async function generateTracedOperations(token, count = 50) {
  console.log(`[RQ3] Generating ${count} traced operations...`);

  const sitesRes = await httpRequest('GET', '/api/sites', null, token);
  const sites    = sitesRes.body;
  if (!sites || !sites.length) throw new Error('No sites found');

  const correlationIds = [];
  const statuses = ['open', 'closed', 'delayed', 'open', 'closed'];

  for (let i = 0; i < count; i++) {
    const site   = sites[i % sites.length];
    const status = statuses[i % statuses.length];
    const res    = await httpRequest(
      'PATCH', `/api/sites/${site.id}/status`, { status }, token
    );
    if (res.status === 200 && res.body.correlationId) {
      correlationIds.push(res.body.correlationId);
    }
    process.stdout.write(`  Operations: ${i+1}/${count}\r`);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n[RQ3] ✓ Generated ${correlationIds.length} traced operations`);
  return correlationIds;
}

// Check audit completeness via API
async function measureAuditCompleteness(token) {
  console.log('[RQ3] Measuring audit log completeness...');
  const res = await httpRequest('GET', '/api/audit/completeness', null, token);
  return res.body;
}

// Test correlation chain reconstruction
async function measureChainReconstruction(token, correlationIds) {
  console.log(`[RQ3] Testing correlation chain reconstruction (${correlationIds.length} chains)...`);

  let reconstructed = 0;
  let failed        = 0;

  for (let i = 0; i < correlationIds.length; i++) {
    const id  = correlationIds[i];
    const res = await httpRequest('GET', `/api/audit/reconstruct/${id}`, null, token);

    if (res.status === 200 &&
        res.body.audit_chain?.length > 0 &&
        res.body.operational_events?.length > 0) {
      reconstructed++;
    } else {
      failed++;
    }
    process.stdout.write(`  Reconstructing: ${i+1}/${correlationIds.length}\r`);
  }

  console.log('');
  return {
    total:         correlationIds.length,
    reconstructed,
    failed,
    accuracy:      ((reconstructed / correlationIds.length) * 100).toFixed(1) + '%',
  };
}

function printTable(completeness, reconstruction) {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('  RQ3 RESULTS — Audit Log Traceability (Paper Table 8)');
  console.log('═'.repeat(70));
  console.log('\nAudit Completeness Metrics:');
  console.log('─'.repeat(70));

  const metrics = [
    ['Total audit records',                   completeness.total_records],
    ['Records with valid user ID',            `${completeness.with_user_id} (${completeness.user_completeness_pct}%)`],
    ['Records with valid correlation ID',     `${completeness.with_correlation_id} (${completeness.correlation_completeness_pct}%)`],
  ];

  for (const [label, value] of metrics) {
    console.log(`  ${label.padEnd(42)} ${String(value).padStart(20)}`);
  }

  console.log('\nCorrelation Chain Reconstruction:');
  console.log('─'.repeat(70));
  console.log(`  Total chains tested:`.padEnd(44) + `${reconstruction.total}`.padStart(18));
  console.log(`  Successfully reconstructed:`.padEnd(44) + `${reconstruction.reconstructed}`.padStart(18));
  console.log(`  Failed:`.padEnd(44) + `${reconstruction.failed}`.padStart(18));
  console.log(`  Reconstruction accuracy:`.padEnd(44) + `${reconstruction.accuracy}`.padStart(18));

  console.log('\n─'.repeat(70));
  console.log('\nPaper Table 8 Reference Values:');
  console.log('  Operational actions recorded:         100%');
  console.log('  Audit records with valid user ID:     100%');
  console.log('  Audit records with valid timestamp:   100%');
  console.log('  Events reconstructable via corr ID:  99.8%');
  console.log('═'.repeat(70));
}

function saveResults(completeness, reconstruction) {
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, '../../../results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rq3-audit.json');
  fs.writeFileSync(file, JSON.stringify({
    timestamp: new Date().toISOString(),
    completeness,
    reconstruction,
    paper_reference: {
      user_completeness_pct:        100,
      correlation_completeness_pct: 100,
      reconstruction_accuracy_pct:  99.8,
    }
  }, null, 2));
  console.log(`\nResults saved to: ${file}`);
}

async function main() {
  console.log('DOM-RT Evaluation — RQ3: Audit Log Traceability');
  console.log('Backend URL:', BASE_URL);

  let token;
  try {
    token = await login();
    console.log('✓ Authenticated');
  } catch (err) {
    console.error('✗ Auth failed:', err.message);
    process.exit(1);
  }

  // Generate operations to audit
  const correlationIds = await generateTracedOperations(token, 50);

  // Measure completeness
  const completeness = await measureAuditCompleteness(token);

  // Measure reconstruction
  const reconstruction = await measureChainReconstruction(token, correlationIds);

  printTable(completeness, reconstruction);
  saveResults(completeness, reconstruction);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
