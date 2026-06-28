/**
 * DOM-RT Complete Evaluation Runner
 * ─────────────────────────────────────────────────────────
 * Runs all Research Questions (RQ1–RQ4) in sequence and
 * produces a combined results report matching the paper.
 *
 * Usage:
 *   node scripts/evaluation/run-all.js [--rq1] [--rq2] [--rq3] [--rq4]
 *   node scripts/evaluation/run-all.js          ← runs all
 *
 * Prerequisites:
 *   1. Backend running:    cd backend && npm run dev
 *   2. AI service running: cd ai && python app.py
 *   3. Data seeded:        cd backend && node fix-passwords.js
 * ─────────────────────────────────────────────────────────
 */

const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '../../results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const runAll = args.length === 0;
const run = (flag) => runAll || args.includes(flag);

function runScript(scriptPath, label) {
  return new Promise((resolve) => {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Running: ${label}`);
    console.log('─'.repeat(70));

    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ ${label} completed`);
        resolve(true);
      } else {
        console.error(`✗ ${label} failed with code ${code}`);
        resolve(false);
      }
    });
  });
}

function generateReport() {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('  DOM-RT EVALUATION REPORT — IEEE Access Paper Results');
  console.log('═'.repeat(70));

  const rqFiles = {
    'RQ1 — Reporting Latency':      'rq1-latency.json',
    'RQ2 — Scalability':            'rq2-scalability.json',
    'RQ3 — Audit Traceability':     'rq3-audit.json',
    'RQ4 — Anomaly Detection':      'rq4-anomaly.json',
  };

  for (const [label, file] of Object.entries(rqFiles)) {
    const filePath = path.join(RESULTS_DIR, file);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath));
      console.log(`\n${label}`);
      console.log(`  Generated: ${data.timestamp}`);

      if (file === 'rq1-latency.json' && data.results) {
        const dr = data.results['DOM-RT (Event-Driven)'];
        if (dr) {
          console.log(`  DOM-RT Median:  ${dr.median}ms  (paper: 420ms)`);
          console.log(`  DOM-RT P95:     ${dr.p95}ms   (paper: 1300ms)`);
        }
      }
      if (file === 'rq2-scalability.json' && data.results?.length) {
        for (const r of data.results) {
          console.log(`  ${r.workload}: API Avg ${r.latency?.avg}ms | Error ${r.error_rate}`);
        }
      }
      if (file === 'rq3-audit.json') {
        console.log(`  Reconstruction accuracy: ${data.reconstruction?.accuracy}`);
        console.log(`  Completeness: ${data.completeness?.correlation_completeness_pct}%`);
      }
      if (file === 'rq4-anomaly.json' && data.results) {
        const h = data.results.hybrid;
        if (h) console.log(`  Hybrid F1: ${h.f1} | FPR: ${h.fpr}  (paper: F1=0.88, FPR=2.4%)`);
        const r = data.results.rule;
        if (r) console.log(`  Rule-based F1: ${r.f1}  (paper: F1=0.71)`);
      }
    } else {
      console.log(`\n${label}: ⚠ Not yet run`);
    }
  }

  // Save combined report
  const report = {
    generated_at: new Date().toISOString(),
    paper: 'DOM-RT: A Domain-Neutral, Audit-Linked Framework for AI-Assisted Real-Time Distributed Operational Monitoring',
    results: {},
  };
  for (const [label, file] of Object.entries(rqFiles)) {
    const filePath = path.join(RESULTS_DIR, file);
    if (fs.existsSync(filePath)) {
      report.results[label] = JSON.parse(fs.readFileSync(filePath));
    }
  }
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'combined-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n─'.repeat(70));
  console.log(`\nFull results saved to: results/combined-report.json`);
  console.log('═'.repeat(70));
}

async function main() {
  console.log('DOM-RT Complete Evaluation Suite');
  console.log('Results will be saved to: results/');
  console.log('\nPrerequisites:');
  console.log('  ✓ Backend running on http://localhost:4000');
  console.log('  ✓ AI service running on http://localhost:5001');
  console.log('  ✓ Database seeded (node backend/fix-passwords.js)');

  const results = [];

  if (run('--rq1')) {
    const ok = await runScript(
      path.join(__dirname, 'rq1-latency.js'),
      'RQ1: Reporting Latency'
    );
    results.push({ rq: 'RQ1', ok });
  }

  if (run('--rq2')) {
    const target = args.find(a => ['small','medium','large'].includes(a)) || 'small';
    process.env.WORKLOAD = target;
    const ok = await runScript(
      path.join(__dirname, 'rq2-scalability.js'),
      `RQ2: Scalability (${target} workload)`
    );
    results.push({ rq: 'RQ2', ok });
  }

  if (run('--rq3')) {
    const ok = await runScript(
      path.join(__dirname, 'rq3-audit.js'),
      'RQ3: Audit Log Traceability'
    );
    results.push({ rq: 'RQ3', ok });
  }

  if (run('--rq4')) {
    const ok = await runScript(
      path.join(__dirname, 'rq4-anomaly.js'),
      'RQ4: AI Anomaly Detection'
    );
    results.push({ rq: 'RQ4', ok });
  }

  generateReport();

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.log(`\n⚠ ${failed.length} evaluation(s) failed: ${failed.map(r => r.rq).join(', ')}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
