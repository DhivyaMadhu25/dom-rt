/**
 * DOM-RT Site Auto-Reporter
 * ─────────────────────────────────────────────────────────
 * Simulates distributed sites automatically reporting their
 * own operational status via REST API — no manual admin needed.
 *
 * Two modes:
 *  1. REST endpoint  POST /api/sites/report  — single site reports itself
 *  2. Scheduler      runs every 60s          — all sites self-report based on schedule
 *
 * Usage (from backend/):
 *   node src/services/auto-reporter.js          ← run standalone
 *   (it also auto-starts when imported by server.js)
 */

const { query, withTransaction } = require('../db/pool');
const { emitEvent }              = require('./websocket');
const { triggerAnomalyCheck }    = require('./anomaly');
const { v4: uuidv4 }             = require('uuid');

// ─────────────────────────────────────────────────────────
// Core logic: decide what status a site SHOULD have right now
// ─────────────────────────────────────────────────────────
function computeExpectedStatus(site, nowMinutes, anomalyRate = 0.05) {
  if (!site.scheduled_open || !site.scheduled_close) return 'inactive';

  const [oh, om] = site.scheduled_open.split(':').map(Number);
  const [ch, cm] = site.scheduled_close.split(':').map(Number);
  const openMin  = oh * 60 + om;
  const closeMin = ch * 60 + cm;

  const withinHours = nowMinutes >= openMin && nowMinutes < closeMin;

  if (!withinHours) return 'closed';

  // Inject realistic anomalies
  const rand = Math.random();
  if (rand < anomalyRate * 0.3)        return 'failed';
  if (rand < anomalyRate * 0.6)        return 'degraded';
  if (rand < anomalyRate)              return 'delayed';

  return 'open';
}

// ─────────────────────────────────────────────────────────
// Update one site's status atomically with full audit trail
// ─────────────────────────────────────────────────────────
async function reportSiteStatus(siteId, newStatus, source = 'auto_reporter') {
  const correlationId = uuidv4();

  try {
    const siteResult = await query(
      'SELECT * FROM sites WHERE id = $1 AND is_active = true',
      [siteId]
    );
    const site = siteResult.rows[0];
    if (!site) return { skipped: true, reason: 'not found' };

    // Skip if status hasn't changed — avoid audit log noise
    if (site.status === newStatus) {
      return { skipped: true, reason: 'no change', status: newStatus };
    }

    const previousStatus = site.status;

    await withTransaction(async (client) => {
      // 1. Update site status
      await client.query(
        'UPDATE sites SET status = $1, updated_at = NOW() WHERE id = $2',
        [newStatus, siteId]
      );

      // 2. Write operational event
      await client.query(
        `INSERT INTO operational_events
           (site_id, category, event_type, source,
            previous_value, new_value, payload, correlation_id)
         VALUES ($1, 'status_change', 'site_status_auto_reported', $2,
                 $3, $4, $5, $6)`,
        [
          siteId, source,
          previousStatus, newStatus,
          JSON.stringify({
            auto_reported: true,
            reported_at:   new Date().toISOString(),
            source,
          }),
          correlationId,
        ]
      );

      // 3. Append-only audit record
      await client.query(
        `INSERT INTO audit_logs
           (site_id, action_type, entity_type, entity_id,
            previous_value, new_value, correlation_id)
         VALUES ($1, 'site_status_auto_reported', 'site', $1, $2, $3, $4)`,
        [
          siteId,
          JSON.stringify({ status: previousStatus }),
          JSON.stringify({ status: newStatus, source }),
          correlationId,
        ]
      );
    });

    // 4. Real-time WebSocket broadcast (after DB commit)
    emitEvent('site:status_updated', {
      siteId,
      siteName:       site.name,
      previousStatus,
      status:         newStatus,
      updatedBy:      source,
      correlationId,
      timestamp:      new Date().toISOString(),
    });

    // 5. Async anomaly check
    triggerAnomalyCheck(siteId, 'status_change', correlationId).catch(() => {});

    console.log(`[AutoReport] ${site.name}: ${previousStatus} → ${newStatus} (corr: ${correlationId.slice(0, 8)})`);
    return { success: true, siteId, previousStatus, newStatus, correlationId };

  } catch (err) {
    console.error(`[AutoReport] Error updating site ${siteId}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────
// Run all active sites through the scheduler
// ─────────────────────────────────────────────────────────
async function runSchedulerCycle() {
  const now        = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  try {
    const result = await query(
      'SELECT * FROM sites WHERE is_active = true ORDER BY name'
    );
    const sites = result.rows;

    const results = { updated: 0, skipped: 0, errors: 0 };

    for (const site of sites) {
      const expected = computeExpectedStatus(site, nowMinutes);
      const outcome  = await reportSiteStatus(site.id, expected, 'scheduler');

      if (outcome.success) results.updated++;
      else if (outcome.skipped) results.skipped++;
      else results.errors++;
    }

    console.log(
      `[Scheduler] Cycle complete — ${sites.length} sites | ` +
      `updated: ${results.updated} | skipped: ${results.skipped} | errors: ${results.errors}`
    );
    return results;

  } catch (err) {
    console.error('[Scheduler] Cycle error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────
// Start background scheduler
// ─────────────────────────────────────────────────────────
let schedulerTimer = null;

function startScheduler(intervalSeconds = 60) {
  if (schedulerTimer) return;
  console.log(`[Scheduler] Starting — cycle every ${intervalSeconds}s`);

  // Run immediately on start
  runSchedulerCycle();

  schedulerTimer = setInterval(runSchedulerCycle, intervalSeconds * 1000);
}

function stopScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
}

module.exports = { reportSiteStatus, runSchedulerCycle, startScheduler, stopScheduler, computeExpectedStatus };
