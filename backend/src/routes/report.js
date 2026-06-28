/**
 * DOM-RT Site Reporting Routes
 * ─────────────────────────────────────────────────────────
 * Sites report their own status via REST — no admin needed.
 *
 * POST /api/report/status          — single site reports status
 * POST /api/report/batch           — multiple sites report at once
 * POST /api/report/simulate        — simulate all sites for N hours
 * POST /api/report/scheduler/start — start auto-scheduler
 * POST /api/report/scheduler/stop  — stop auto-scheduler
 * GET  /api/report/scheduler/status — scheduler state
 */

const express = require('express');
const { query }            = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { requireRole }      = require('../middleware/rbac');
const {
  reportSiteStatus,
  runSchedulerCycle,
  startScheduler,
  stopScheduler,
  computeExpectedStatus,
} = require('../services/auto-reporter');

const router = express.Router();
let schedulerRunning = false;

// ─────────────────────────────────────────────────────────
// POST /api/report/status
// A single site posts its own status
// Body: { site_id, status, source? }
// ─────────────────────────────────────────────────────────
router.post('/status', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const { site_id, status, source = 'api_report' } = req.body;

  const VALID = ['inactive', 'open', 'closed', 'delayed', 'degraded', 'failed'];
  if (!site_id)          return res.status(400).json({ error: 'site_id required' });
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${VALID.join(', ')}` });
  }

  const result = await reportSiteStatus(site_id, status, source);
  res.json(result);
});

// ─────────────────────────────────────────────────────────
// POST /api/report/batch
// Multiple sites report their status at once
// Body: { reports: [{ site_id, status, source? }, ...] }
// ─────────────────────────────────────────────────────────
router.post('/batch', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const { reports } = req.body;
  if (!Array.isArray(reports) || reports.length === 0) {
    return res.status(400).json({ error: 'reports array required' });
  }
  if (reports.length > 500) {
    return res.status(400).json({ error: 'Max 500 reports per batch' });
  }

  const results = await Promise.all(
    reports.map(r => reportSiteStatus(r.site_id, r.status, r.source || 'batch_api'))
  );

  const summary = {
    total:   results.length,
    updated: results.filter(r => r.success).length,
    skipped: results.filter(r => r.skipped).length,
    errors:  results.filter(r => r.error).length,
    results,
  };

  res.json(summary);
});

// ─────────────────────────────────────────────────────────
// POST /api/report/simulate
// Simulate all sites reporting based on time-of-day schedule
// Optional: { hour } to simulate a specific hour (0-23)
// ─────────────────────────────────────────────────────────
router.post('/simulate', authenticate, requireRole('admin'), async (req, res) => {
  const { hour } = req.body;  // optional: override current hour

  try {
    const sites = await query('SELECT * FROM sites WHERE is_active = true');
    const now   = new Date();
    const nowMinutes = hour !== undefined
      ? parseInt(hour) * 60
      : now.getHours() * 60 + now.getMinutes();

    const reports = sites.rows.map(site => ({
      site_id: site.id,
      status:  computeExpectedStatus(site, nowMinutes),
      source:  'simulate_api',
    }));

    const results = await Promise.all(
      reports.map(r => reportSiteStatus(r.site_id, r.status, r.source))
    );

    res.json({
      simulated_time: hour !== undefined ? `${hour}:00` : now.toTimeString().slice(0, 5),
      total:   results.length,
      updated: results.filter(r => r.success).length,
      skipped: results.filter(r => r.skipped).length,
      breakdown: reports.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// POST /api/report/simulate/day
// Simulate a full 24-hour day in fast-forward
// Useful for generating rich audit trail data
// ─────────────────────────────────────────────────────────
router.post('/simulate/day', authenticate, requireRole('admin'), async (req, res) => {
  const { hours = 24, delay_ms = 100 } = req.body;
  const results = [];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sites = await query('SELECT * FROM sites WHERE is_active = true');

  for (let h = 0; h < Math.min(hours, 24); h++) {
    const nowMinutes = h * 60;
    const hourResults = { hour: h, updated: 0, skipped: 0 };

    for (const site of sites.rows) {
      const status = computeExpectedStatus(site, nowMinutes);
      const outcome = await reportSiteStatus(site.id, status, `day_sim_h${h}`);
      if (outcome.success) hourResults.updated++;
      else hourResults.skipped++;
    }

    results.push(hourResults);

    // Small delay between hours to spread timestamps
    if (delay_ms > 0) await new Promise(r => setTimeout(r, delay_ms));
  }

  res.json({
    message:      `Simulated ${hours} hours for ${sites.rows.length} sites`,
    total_events: results.reduce((s, r) => s + r.updated, 0),
    by_hour:      results,
  });
});

// ─────────────────────────────────────────────────────────
// POST /api/report/scheduler/start
// Start the background auto-scheduler
// ─────────────────────────────────────────────────────────
router.post('/scheduler/start', authenticate, requireRole('admin'), (req, res) => {
  const { interval_seconds = 60 } = req.body;
  startScheduler(interval_seconds);
  schedulerRunning = true;
  res.json({ message: 'Scheduler started', interval_seconds });
});

// ─────────────────────────────────────────────────────────
// POST /api/report/scheduler/stop
// ─────────────────────────────────────────────────────────
router.post('/scheduler/stop', authenticate, requireRole('admin'), (req, res) => {
  stopScheduler();
  schedulerRunning = false;
  res.json({ message: 'Scheduler stopped' });
});

// ─────────────────────────────────────────────────────────
// POST /api/report/scheduler/run
// Trigger one immediate scheduler cycle
// ─────────────────────────────────────────────────────────
router.post('/scheduler/run', authenticate, requireRole('admin'), async (req, res) => {
  const result = await runSchedulerCycle();
  res.json(result);
});

// ─────────────────────────────────────────────────────────
// GET /api/report/scheduler/status
// ─────────────────────────────────────────────────────────
router.get('/scheduler/status', authenticate, async (req, res) => {
  const sites = await query(
    `SELECT status, COUNT(*) AS count
     FROM sites WHERE is_active = true
     GROUP BY status ORDER BY count DESC`
  );
  res.json({
    scheduler_running: schedulerRunning,
    current_time:      new Date().toTimeString().slice(0, 5),
    site_status_breakdown: sites.rows,
  });
});

module.exports = router;
