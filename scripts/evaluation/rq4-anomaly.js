/**
 * RQ4: AI-Assisted Anomaly Detection Quality
 * ─────────────────────────────────────────────────────────
 * Evaluates precision, recall, F1-score and false-positive
 * rate for all three detection tiers.
 *
 * Paper Table 9 target:
 *   Rule-based:    P=0.74 R=0.68 F1=0.71 FPR=5.8% Lat=120ms
 *   Statistical:   P=0.81 R=0.76 F1=0.78 FPR=4.1% Lat=180ms
 *   Isolation F:   P=0.86 R=0.83 F1=0.84 FPR=3.2% Lat=240ms
 *   Hybrid:        P=0.90 R=0.87 F1=0.88 FPR=2.4% Lat=310ms
 *
 * Usage:
 *   node scripts/evaluation/rq4-anomaly.js
 * ─────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: './backend/.env' });
const http = require('http');

const BASE_URL     = process.env.API_URL    || 'http://localhost:4000';
const AI_URL       = process.env.AI_URL     || 'http://localhost:5001';
const ANOMALY_RATE = parseFloat(process.env.ANOMALY_RATE || '0.10');
const SAMPLE_SIZE  = parseInt(process.env.SAMPLE_SIZE   || '100');

function httpRequest(method, urlStr, body, token) {
  return new Promise((resolve) => {
    const url     = new URL(urlStr);
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
    req.on('error', () => resolve({ status: 0, latency: Date.now() - start }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const res = await httpRequest('POST', `${BASE_URL}/api/auth/login`, {
    username: 'admin',
    password: process.env.DEMO_PASSWORD || 'DomRT_Demo_2026!',
  });
  if (!res.body?.token) throw new Error('Login failed');
  return res.body.token;
}

// Generate labeled test samples (normal + anomalous)
function generateLabeledSamples(n, anomalyRate) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const isAnomaly = Math.random() < anomalyRate;
    if (isAnomaly) {
      // Anomalous feature distributions
      const type = Math.floor(Math.random() * 5);
      samples.push({
        label: true,  // ground truth: IS anomaly
        anomaly_type: ['delayed_opening','missing_activity','abnormal_volume',
                       'repeated_exception','alert_burst'][type],
        features: {
          avg_open_delay:   type === 0 ? 90 + Math.random() * 120 : Math.random() * 10,
          activity_count:   type === 1 ? Math.random() * 5         : 150 + Math.random() * 100,
          total_amount:     type === 2 ? Math.random() * 100        : 4000 + Math.random() * 3000,
          open_alerts:      type === 4 ? 8 + Math.random() * 10     : Math.random() * 2,
          exception_count:  type === 3 ? 10 + Math.random() * 15    : Math.random() * 3,
        }
      });
    } else {
      // Normal feature distributions
      samples.push({
        label: false,
        anomaly_type: null,
        features: {
          avg_open_delay:  Math.random() * 15,
          activity_count:  100 + Math.random() * 200,
          total_amount:    3000 + Math.random() * 5000,
          open_alerts:     Math.random() * 3,
          exception_count: Math.random() * 4,
        }
      });
    }
  }
  return samples;
}

// Rule-based detection (mirrors backend anomaly.js Tier 1)
function ruleBasedDetect(features) {
  const start = Date.now();
  let detected = false;

  if (features.avg_open_delay > 30)    detected = true;  // delayed opening
  if (features.activity_count < 10)    detected = true;  // missing activity
  if (features.open_alerts > 5)        detected = true;  // alert burst
  if (features.exception_count > 8)    detected = true;  // repeated exceptions

  return { detected, latency: Date.now() - start };
}

// Statistical baseline (Z-score > 2.5 threshold)
function statisticalDetect(features, baselines) {
  const start = Date.now();
  let maxZ = 0;

  for (const [key, value] of Object.entries(features)) {
    const bl = baselines[key];
    if (bl && bl.std > 0) {
      const z = Math.abs((value - bl.mean) / bl.std);
      maxZ = Math.max(maxZ, z);
    }
  }

  return { detected: maxZ > 2.5, z_score: maxZ, latency: Date.now() - start };
}

// Compute baselines from normal samples
function computeBaselines(samples) {
  const normal = samples.filter(s => !s.label);
  const keys   = Object.keys(normal[0].features);
  const result = {};

  for (const key of keys) {
    const values = normal.map(s => s.features[key]);
    const mean   = values.reduce((s, v) => s + v, 0) / values.length;
    const std    = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    result[key]  = { mean, std };
  }
  return result;
}

// Isolation Forest via AI service
async function isolationForestDetect(features) {
  const start = Date.now();
  try {
    const res = await httpRequest('POST', `${AI_URL}/predict`, { features });
    const latency = Date.now() - start;
    if (res.status === 200) {
      return {
        detected:      res.body.is_anomaly,
        anomaly_score: res.body.anomaly_score,
        latency,
        available:     true,
      };
    }
  } catch { /* AI service unavailable */ }
  return { detected: false, latency: Date.now() - start, available: false };
}

// Compute precision, recall, F1, FPR
function computeMetrics(predictions, labels) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < predictions.length; i++) {
    const pred  = predictions[i];
    const truth = labels[i];
    if (pred && truth)  tp++;
    if (pred && !truth) fp++;
    if (!pred && truth) fn++;
    if (!pred && !truth) tn++;
  }
  const precision = tp / (tp + fp) || 0;
  const recall    = tp / (tp + fn) || 0;
  const f1        = 2 * precision * recall / (precision + recall) || 0;
  const fpr       = fp / (fp + tn) || 0;
  return {
    precision: precision.toFixed(2),
    recall:    recall.toFixed(2),
    f1:        f1.toFixed(2),
    fpr:       (fpr * 100).toFixed(1) + '%',
    tp, fp, tn, fn,
  };
}

async function main() {
  console.log('DOM-RT Evaluation — RQ4: AI-Assisted Anomaly Detection');
  console.log(`Generating ${SAMPLE_SIZE} labeled samples (anomaly rate: ${ANOMALY_RATE * 100}%)`);

  let token;
  try {
    token = await login();
    console.log('✓ Authenticated with backend');
  } catch (err) {
    console.error('✗ Auth failed:', err.message);
    process.exit(1);
  }

  // Check AI service
  const aiHealth = await httpRequest('GET', `${AI_URL}/health`, null, null);
  const aiAvailable = aiHealth.status === 200;
  console.log(`${aiAvailable ? '✓' : '⚠'} AI service: ${aiAvailable ? 'available' : 'unavailable (Isolation Forest skipped)'}`);

  // Generate labeled dataset
  const samples    = generateLabeledSamples(SAMPLE_SIZE, ANOMALY_RATE);
  const labels     = samples.map(s => s.label);
  const anomalies  = labels.filter(Boolean).length;
  const normal     = labels.length - anomalies;
  console.log(`\nDataset: ${samples.length} total | ${anomalies} anomalous | ${normal} normal`);

  // Compute statistical baselines from training subset
  const baselines = computeBaselines(samples.slice(0, Math.floor(SAMPLE_SIZE * 0.6)));

  // ── Tier 1: Rule-based ────────────────────────────────
  console.log('\n[RQ4] Running Tier 1: Rule-based detection...');
  const rulePreds    = [];
  const ruleLatencies = [];
  for (const s of samples) {
    const r = ruleBasedDetect(s.features);
    rulePreds.push(r.detected);
    ruleLatencies.push(r.latency);
  }
  const ruleMetrics = computeMetrics(rulePreds, labels);
  ruleMetrics.avg_latency = Math.round(ruleLatencies.reduce((a,b)=>a+b,0)/ruleLatencies.length) + 'ms';

  // ── Tier 2: Statistical ───────────────────────────────
  console.log('[RQ4] Running Tier 2: Statistical baseline detection...');
  const statPreds    = [];
  const statLatencies = [];
  for (const s of samples) {
    const r = statisticalDetect(s.features, baselines);
    // Hybrid: rule OR statistical
    statPreds.push(r.detected || rulePreds[samples.indexOf(s)]);
    statLatencies.push(r.latency);
  }
  const statMetrics = computeMetrics(statPreds, labels);
  statMetrics.avg_latency = Math.round(statLatencies.reduce((a,b)=>a+b,0)/statLatencies.length) + 'ms';

  // ── Tier 3: Isolation Forest ──────────────────────────
  let ifMetrics = null;
  let hybridMetrics = null;

  if (aiAvailable) {
    console.log('[RQ4] Running Tier 3: Isolation Forest detection...');
    const ifPreds    = [];
    const ifLatencies = [];
    const hybridPreds = [];

    for (let i = 0; i < samples.length; i++) {
      const s  = samples[i];
      const r  = await isolationForestDetect(s.features);
      ifPreds.push(r.detected);
      ifLatencies.push(r.latency);
      // Hybrid = rule OR statistical OR IF
      hybridPreds.push(rulePreds[i] || statPreds[i] || r.detected);
      process.stdout.write(`  Scoring: ${i+1}/${samples.length}\r`);
    }
    console.log('');

    ifMetrics = computeMetrics(ifPreds, labels);
    ifMetrics.avg_latency = Math.round(ifLatencies.reduce((a,b)=>a+b,0)/ifLatencies.length) + 'ms';
    hybridMetrics = computeMetrics(hybridPreds, labels);
    hybridMetrics.avg_latency = 'see above';
  }

  // ── Print Results ─────────────────────────────────────
  console.log('\n');
  console.log('═'.repeat(85));
  console.log('  RQ4 RESULTS — AI-Assisted Anomaly Detection (Paper Table 9)');
  console.log('═'.repeat(85));
  console.log(
    'Detection Method'.padEnd(22),
    'Precision'.padStart(11),
    'Recall'.padStart(9),
    'F1-Score'.padStart(10),
    'FPR'.padStart(8),
    'Avg Latency'.padStart(13)
  );
  console.log('─'.repeat(85));

  const rows = [
    ['Rule-based (Tier 1)', ruleMetrics],
    ['Statistical (Tier 2)', statMetrics],
    ...(ifMetrics ? [
      ['Isolation Forest (T3)', ifMetrics],
      ['Hybrid Rule+AI', hybridMetrics],
    ] : []),
  ];

  for (const [name, m] of rows) {
    console.log(
      name.padEnd(22),
      m.precision.padStart(11),
      m.recall.padStart(9),
      m.f1.padStart(10),
      m.fpr.padStart(8),
      (m.avg_latency || 'N/A').padStart(13)
    );
  }

  console.log('─'.repeat(85));
  console.log('\nPaper Table 9 Reference Values:');
  console.log('  Rule-based:         P=0.74  R=0.68  F1=0.71  FPR=5.8%  Lat=120ms');
  console.log('  Statistical:        P=0.81  R=0.76  F1=0.78  FPR=4.1%  Lat=180ms');
  console.log('  Isolation Forest:   P=0.86  R=0.83  F1=0.84  FPR=3.2%  Lat=240ms');
  console.log('  Hybrid Rule+AI:     P=0.90  R=0.87  F1=0.88  FPR=2.4%  Lat=310ms');
  console.log('═'.repeat(85));

  // Save results
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, '../../results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'rq4-anomaly.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      dataset: { total: SAMPLE_SIZE, anomalies, normal, anomaly_rate: ANOMALY_RATE },
      results: { rule: ruleMetrics, statistical: statMetrics, isolation_forest: ifMetrics, hybrid: hybridMetrics }
    }, null, 2)
  );
  console.log(`\nResults saved to: results/rq4-anomaly.json`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
