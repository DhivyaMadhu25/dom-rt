/**
 * RQ2: Scalability Under Increasing Load
 * ─────────────────────────────────────────────────────────
 * Measures API latency, WebSocket latency, throughput,
 * and error rate across small / medium / large workloads.
 *
 * Paper Table 7 target:
 *   Small:  API Avg 42ms  | P95 96ms  | WS P95 180ms | 320 ev/s  | 0.00%
 *   Medium: API Avg 68ms  | P95 155ms | WS P95 310ms | 920 ev/s  | 0.08%
 *   Large:  API Avg 126ms | P95 410ms | WS P95 780ms | 1850 ev/s | 0.42%
 *
 * Usage:
 *   node scripts/evaluation/rq2-scalability.js [small|medium|large|all]
 * ─────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: './backend/.env' });
const http = require('http');
const { generateBenchmarkData } = require('../../src/benchmark/generator');

const BASE_URL = process.env.API_URL || 'http://localhost:4000';

// Workload concurrency levels matching the paper
const WORKLOAD_CONFIG = {
  small:  { concurrency: 25,  duration_s: 60,  label: 'Small (50 sites)' },
  medium: { concurrency: 100, duration_s: 60,  label: 'Medium (250 sites)' },
  large:  { concurrency: 500, duration_s: 60,  label: 'Large (1000 sites)' },
};

function httpRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url     = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const start   = Date.now();
    const options = {
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname, method,
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
        const latency = Date.now() - start;
        try { resolve({ status: res.statusCode, latency, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, latency, body: data }); }
      });
    });
    req.on('error', err => resolve({ status: 0, latency: Date.now() - start, error: err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

function stats(arr) {
  if (!arr.length) return { avg: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n      = sorted.length;
  return {
    avg: Math.round(arr.reduce((s, v) => s + v, 0) / n),
    p95: sorted[Math.floor(n * 0.95)],
    min: sorted[0],
    max: sorted[n - 1],
    count: n,
  };
}

async function login() {
  const res = await httpRequest('POST', '/api/auth/login', {
    username: 'admin',
    password: process.env.DEMO_PASSWORD || 'DomRT_Demo_2026!',
  });
  if (!res.body.token) throw new Error('Login failed');
  return res.body.token;
}

async function runConcurrentRequests(token, concurrency, durationSeconds) {
  const endTime    = Date.now() + durationSeconds * 1000;
  const latencies  = [];
  const errors     = [];
  let   totalReqs  = 0;

  // Get sites to use
  const sitesRes = await httpRequest('GET', '/api/sites?limit=50', null, token);
  const sites    = sitesRes.body;
  if (!sites || !sites.length) throw new Error('No sites found — run benchmark generator first');

  const worker = async () => {
    while (Date.now() < endTime) {
      const site     = sites[Math.floor(Math.random() * sites.length)];
      const statuses = ['open', 'closed', 'delayed'];
      const status   = statuses[Math.floor(Math.random() * statuses.length)];

      const res = await httpRequest(
        'PATCH', `/api/sites/${site.id}/status`,
        { status }, token
      );
      totalReqs++;

      if (res.status === 200) {
        latencies.push(res.latency);
      } else {
        errors.push(res.status);
      }
    }
  };

  // Run concurrent workers
  const workers = Array.from({ length: Math.min(concurrency, 50) }, () => worker());
  await Promise.all(workers);

  const errorRate = errors.length / (totalReqs || 1);
  const throughput = totalReqs / durationSeconds;

  return {
    latency:    stats(latencies),
    error_rate: (errorRate * 100).toFixed(2) + '%',
    throughput: Math.round(throughput) + ' req/s',
    total_requests: totalReqs,
    errors: errors.length,
  };
}

async function runWorkload(workloadName, token) {
  const config = WORKLOAD_CONFIG[workloadName];
  console.log(`\n[RQ2] Running ${config.label} workload...`);
  console.log(`      Concurrency: ${config.concurrency} | Duration: ${config.duration_s}s`);

  // Generate benchmark data if needed
  console.log(`[RQ2] Generating ${workloadName} benchmark data...`);
  try {
    await generateBenchmarkData(workloadName);
  } catch (err) {
    console.warn(`[RQ2] Benchmark generation warning: ${err.message}`);
  }

  // Warm up (5 seconds)
  console.log('[RQ2] Warming up (5s)...');
  await runConcurrentRequests(token, config.concurrency, 5);

  // Actual measurement
  console.log(`[RQ2] Measuring for ${config.duration_s}s...`);
  const result = await runConcurrentRequests(token, config.concurrency, config.duration_s);

  return { workload: workloadName, ...config, ...result };
}

function printTable(results) {
  console.log('\n');
  console.log('═'.repeat(90));
  console.log('  RQ2 RESULTS — Scalability Under Increasing Load (Paper Table 7)');
  console.log('═'.repeat(90));
  console.log(
    'Workload'.padEnd(10),
    'API Avg'.padStart(10),
    'API P95'.padStart(10),
    'Throughput'.padStart(14),
    'Error Rate'.padStart(12),
    'Total Req'.padStart(12)
  );
  console.log('─'.repeat(90));

  for (const r of results) {
    console.log(
      r.workload.padEnd(10),
      `${r.latency.avg}ms`.padStart(10),
      `${r.latency.p95}ms`.padStart(10),
      r.throughput.padStart(14),
      r.error_rate.padStart(12),
      r.total_requests.toString().padStart(12)
    );
  }

  console.log('─'.repeat(90));
  console.log('\nPaper Table 7 Reference Values:');
  console.log('  Small:  API Avg 42ms  | P95 96ms  | 320 ev/s  | 0.00% errors');
  console.log('  Medium: API Avg 68ms  | P95 155ms | 920 ev/s  | 0.08% errors');
  console.log('  Large:  API Avg 126ms | P95 410ms | 1850 ev/s | 0.42% errors');
  console.log('\nNote: WebSocket P95 requires k6 load test (see scripts/loadtest.js)');
  console.log('═'.repeat(90));
}

function saveResults(results) {
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, '../../results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rq2-scalability.json');
  fs.writeFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nResults saved to: ${file}`);
}

async function main() {
  const target  = process.argv[2] || 'all';
  const targets = target === 'all' ? ['small', 'medium', 'large'] : [target];

  console.log('DOM-RT Evaluation — RQ2: Scalability');
  console.log('Backend URL:', BASE_URL);

  let token;
  try {
    token = await login();
    console.log('✓ Authenticated');
  } catch (err) {
    console.error('✗ Auth failed:', err.message);
    process.exit(1);
  }

  const results = [];
  for (const wl of targets) {
    if (!WORKLOAD_CONFIG[wl]) {
      console.error(`Unknown workload: ${wl}. Use: small | medium | large | all`);
      process.exit(1);
    }
    const r = await runWorkload(wl, token);
    results.push(r);
  }

  printTable(results);
  saveResults(results);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
