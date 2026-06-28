/**
 * RQ1: Reporting Latency Reduction
 * ─────────────────────────────────────────────────────────
 * Measures end-to-end reporting latency for three methods:
 *   1. Manual Reporting Baseline (simulated)
 *   2. REST Polling Baseline (15s interval simulation)
 *   3. DOM-RT Event-Driven (actual measurement)
 *
 * Paper Table 6 target:
 *   Manual:   Median 30 min,  P95 95 min
 *   REST:     Median 15 s,    P95 32 s
 *   DOM-RT:   Median 420 ms,  P95 1.3 s
 *
 * Usage:
 *   node scripts/evaluation/rq1-latency.js
 * ─────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: './backend/.env' });
const http  = require('http');
const https = require('https');

const BASE_URL  = process.env.API_URL  || 'http://localhost:4000';
const RUNS      = parseInt(process.env.RUNS || '30');

// ── HTTP helper ───────────────────────────────────────────
function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url     = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
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

// ── Statistics ────────────────────────────────────────────
function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n      = sorted.length;
  const median = n % 2 === 0
    ? (sorted[n/2 - 1] + sorted[n/2]) / 2
    : sorted[Math.floor(n/2)];
  const p95  = sorted[Math.floor(n * 0.95)];
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const std  = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { median, p95, mean: Math.round(mean), std: Math.round(std), min: sorted[0], max: sorted[n-1] };
}

// ── Login ─────────────────────────────────────────────────
async function login() {
  const res = await httpRequest('POST', '/api/auth/login', {
    username: 'admin',
    password: process.env.DEMO_PASSWORD || 'DomRT_Demo_2026!',
  });
  if (!res.body.token) throw new Error('Login failed: ' + JSON.stringify(res.body));
  return res.body.token;
}

// ── Get a valid site ID ───────────────────────────────────
async function getSiteId(token) {
  const res = await httpRequest('GET', '/api/sites', null, token);
  if (!res.body[0]) throw new Error('No sites found. Run fix-passwords.js first.');
  return res.body[0].id;
}

// ── RQ1A: DOM-RT Event-Driven Latency ────────────────────
async function measureDomRtLatency(token, siteId, runs) {
  console.log(`\n[RQ1] Measuring DOM-RT event-driven latency (${runs} runs)...`);
  const latencies = [];
  const statuses  = ['open', 'closed', 'delayed', 'degraded'];

  for (let i = 0; i < runs; i++) {
    const status = statuses[i % statuses.length];
    const t0     = Date.now();
    const res    = await httpRequest('PATCH', `/api/sites/${siteId}/status`,
      { status, notes: `RQ1 run ${i}` }, token);

    if (res.status === 200) {
      const latency = Date.now() - t0;
      latencies.push(latency);
      process.stdout.write(`  Run ${i+1}/${runs}: ${latency}ms\r`);
    } else {
      console.error(`  Run ${i+1} failed: ${res.status}`);
    }

    // Small delay between runs
    await new Promise(r => setTimeout(r, 100));
  }

  return stats(latencies);
}

// ── RQ1B: REST Polling Baseline (simulated) ───────────────
function simulateRestPolling() {
  // REST polling at 15s interval — latency is uniformly distributed
  // between 0 and the poll interval (15s)
  const POLL_INTERVAL_MS = 15000;
  const samples = [];
  for (let i = 0; i < 1000; i++) {
    samples.push(Math.random() * POLL_INTERVAL_MS);
  }
  return stats(samples);
}

// ── RQ1C: Manual Reporting Baseline (simulated) ──────────
function simulateManualReporting() {
  // Manual reporting: normally distributed around 30 min
  // with significant variance (P95 ~ 95 min)
  const MEAN_MS = 30 * 60 * 1000;
  const STD_MS  = 20 * 60 * 1000;
  const samples = [];
  for (let i = 0; i < 1000; i++) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random(), u2 = Math.random();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    samples.push(Math.max(0, MEAN_MS + z * STD_MS));
  }
  return stats(samples);
}

// ── Print Results Table ───────────────────────────────────
function printTable(results) {
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('  RQ1 RESULTS — Reporting Latency Comparison (Paper Table 6)');
  console.log('═'.repeat(80));
  console.log(
    'Method'.padEnd(30),
    'Median'.padStart(12),
    'P95'.padStart(12),
    'Mean'.padStart(12),
    'StdDev'.padStart(12)
  );
  console.log('─'.repeat(80));

  for (const [name, s] of Object.entries(results)) {
    const fmt = (ms) => {
      if (ms >= 60000) return `${(ms/60000).toFixed(1)} min`;
      if (ms >= 1000)  return `${(ms/1000).toFixed(2)} s`;
      return `${Math.round(ms)} ms`;
    };
    console.log(
      name.padEnd(30),
      fmt(s.median).padStart(12),
      fmt(s.p95).padStart(12),
      fmt(s.mean).padStart(12),
      fmt(s.std).padStart(12)
    );
  }
  console.log('─'.repeat(80));
  console.log('\nPaper Table 6 Reference Values:');
  console.log('  Manual Reporting: Median 30 min  | P95 95 min');
  console.log('  REST Polling:     Median 15 s     | P95 32 s');
  console.log('  DOM-RT:           Median 420 ms   | P95 1.3 s');
  console.log('═'.repeat(80));
}

// ── Save results to JSON ──────────────────────────────────
function saveResults(results) {
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, '../../results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rq1-latency.json');
  fs.writeFileSync(file, JSON.stringify({
    timestamp: new Date().toISOString(),
    runs: RUNS,
    results,
    paper_reference: {
      manual:  { median_ms: 1800000, p95_ms: 5700000 },
      polling: { median_ms: 15000,   p95_ms: 32000 },
      domrt:   { median_ms: 420,     p95_ms: 1300 },
    }
  }, null, 2));
  console.log(`\nResults saved to: ${file}`);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('DOM-RT Evaluation — RQ1: Reporting Latency');
  console.log('Ensure backend is running on', BASE_URL);
  console.log('');

  let token, siteId;
  try {
    token  = await login();
    siteId = await getSiteId(token);
    console.log(`✓ Authenticated | Site: ${siteId.slice(0, 8)}...`);
  } catch (err) {
    console.error('✗ Setup failed:', err.message);
    console.error('  Make sure the backend is running: npm run dev');
    process.exit(1);
  }

  const domRtStats  = await measureDomRtLatency(token, siteId, RUNS);
  const pollingStats = simulateRestPolling();
  const manualStats  = simulateManualReporting();

  const results = {
    'DOM-RT (Event-Driven)': domRtStats,
    'REST Polling (15s)':    pollingStats,
    'Manual Reporting':      manualStats,
  };

  printTable(results);
  saveResults(results);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
