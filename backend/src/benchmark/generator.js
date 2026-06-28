/**
 * DOM-RT Synthetic Benchmark Dataset Generator
 * Generates configurable workloads: small / medium / large
 * Injects controlled anomalies for AI evaluation
 */

const { query, withTransaction } = require('../db/pool');
const { v4: uuidv4 }  = require('uuid');
const bcrypt          = require('bcrypt');

const DOMAIN_TYPES  = ['branch', 'store', 'depot', 'clinic', 'cell', 'hub'];
const REGIONS       = ['East', 'West', 'Central', 'South', 'North'];
const ACTIVITY_TYPES = ['transaction', 'shipment', 'patient_visit', 'production_run', 'inspection'];

const PROFILES = {
  small:  { sites: 50,    usersPerRegion: 2,  activitiesPerSite: 200,   alertRate: 0.01, anomalyRate: 0.05 },
  medium: { sites: 250,   usersPerRegion: 5,  activitiesPerSite: 400,   alertRate: 0.03, anomalyRate: 0.08 },
  large:  { sites: 1000,  usersPerRegion: 10, activitiesPerSite: 1000,  alertRate: 0.05, anomalyRate: 0.10 },
};

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomItem    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomAmount  = () => parseFloat((Math.random() * 10000).toFixed(2));

async function generateBenchmarkData(profileName = 'small') {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile: ${profileName}. Use small | medium | large`);

  const runId = uuidv4();
  const startTime = Date.now();
  console.log(`\n[Benchmark] Starting ${profileName} workload generation (runId: ${runId})`);

  const passwordHash = await bcrypt.hash('BenchmarkPass123!', 10);

  // ── Generate Users ──────────────────────────────────────
  console.log('[Benchmark] Generating users...');
  const userIds = [];
  for (const region of REGIONS) {
    for (let i = 0; i < profile.usersPerRegion; i++) {
      const username = `bench_mgr_${region.toLowerCase()}_${i}_${runId.slice(0, 6)}`;
      const result = await query(
        `INSERT INTO users (username, email, password_hash, role_id, region)
         VALUES ($1,$2,$3,2,$4) RETURNING id`,
        [username, `${username}@bench.local`, passwordHash, region]
      );
      userIds.push({ id: result.rows[0].id, region });
    }
  }

  // ── Generate Sites ──────────────────────────────────────
  console.log(`[Benchmark] Generating ${profile.sites} sites...`);
  const siteIds = [];
  for (let i = 0; i < profile.sites; i++) {
    const region      = randomItem(REGIONS);
    const domainType  = randomItem(DOMAIN_TYPES);
    const manager     = userIds.find(u => u.region === region) || userIds[0];
    const isDelayed   = Math.random() < profile.anomalyRate;  // inject delayed-opening anomaly

    const result = await query(
      `INSERT INTO sites
         (name, domain_type, location, region, scheduled_open, scheduled_close,
          status, responsible_user_id)
       VALUES ($1,$2,$3,$4,'09:00','17:00',$5,$6) RETURNING id`,
      [
        `Bench ${domainType} ${i + 1}`,
        domainType,
        `${region} City ${i}`,
        region,
        isDelayed ? 'inactive' : 'open',
        manager.id,
      ]
    );
    siteIds.push({ id: result.rows[0].id, region, isDelayed });
  }

  // ── Generate Activity Records ────────────────────────────
  console.log('[Benchmark] Generating activity records...');
  const BATCH_SIZE = 500;
  let activityBatch = [];
  let totalActivities = 0;

  for (const site of siteIds) {
    const count = site.isDelayed
      ? Math.floor(profile.activitiesPerSite * 0.1)  // inject missing-activity anomaly
      : profile.activitiesPerSite;

    for (let i = 0; i < count; i++) {
      const correlationId = uuidv4();
      activityBatch.push([
        site.id,
        randomItem(ACTIVITY_TYPES),
        userIds.find(u => u.region === site.region)?.id || userIds[0].id,
        randomAmount(),
        'USD',
        `Benchmark activity ${i}`,
        JSON.stringify({ run_id: runId }),
        correlationId,
      ]);

      if (activityBatch.length >= BATCH_SIZE) {
        await insertActivityBatch(activityBatch);
        totalActivities += activityBatch.length;
        activityBatch = [];
      }
    }
  }
  if (activityBatch.length > 0) {
    await insertActivityBatch(activityBatch);
    totalActivities += activityBatch.length;
  }

  // ── Generate Alerts with Injected Anomalies ──────────────
  console.log('[Benchmark] Generating alerts and anomalies...');
  const anomalySites = siteIds.filter(s => s.isDelayed);
  for (const site of anomalySites) {
    await query(
      `INSERT INTO alerts
         (site_id, alert_type, severity, detection_method, anomaly_score,
          contributing_features, model_version, message, correlation_id)
       VALUES ($1,'delayed_opening','high','rule_based',0.9,$2,'1.0.0',$3,$4)`,
      [
        site.id,
        JSON.stringify({ delay_minutes: randomBetween(30, 120), injected: true }),
        'Injected benchmark anomaly: delayed_opening',
        uuidv4(),
      ]
    );
  }

  // ── Record Benchmark Metrics ─────────────────────────────
  const duration = Date.now() - startTime;
  await query(
    `INSERT INTO benchmark_metrics (run_id, metric_name, metric_value, unit, workload_size)
     VALUES ($1,'generation_duration',$2,'ms',$3),
            ($1,'sites_created',$4,'count',$3),
            ($1,'activities_created',$5,'count',$3),
            ($1,'anomalies_injected',$6,'count',$3)`,
    [runId, duration, profileName, profile.sites, totalActivities, anomalySites.length]
  );

  console.log(`\n[Benchmark] ✓ Complete in ${(duration / 1000).toFixed(1)}s`);
  console.log(`  Profile:     ${profileName}`);
  console.log(`  Sites:       ${siteIds.length}`);
  console.log(`  Activities:  ${totalActivities}`);
  console.log(`  Anomalies:   ${anomalySites.length}`);
  console.log(`  Run ID:      ${runId}\n`);

  return { runId, profile: profileName, siteCount: siteIds.length, activityCount: totalActivities };
}

async function insertActivityBatch(batch) {
  const placeholders = batch.map((_, i) => {
    const base = i * 8;
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8})`;
  }).join(',');
  const values = batch.flat();
  await query(
    `INSERT INTO activity_records
       (site_id,activity_type,actor_id,amount,unit,description,metadata,correlation_id)
     VALUES ${placeholders}`,
    values
  );
}

// CLI usage: node generator.js [small|medium|large]
if (require.main === module) {
  const profile = process.argv[2] || 'small';
  generateBenchmarkData(profile)
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { generateBenchmarkData };
