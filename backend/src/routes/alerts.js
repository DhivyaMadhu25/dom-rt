const express = require('express');
const { query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');
const { emitEvent }    = require('../services/websocket');

const router = express.Router();

// GET /api/alerts — List alerts
router.get('/', authenticate, async (req, res) => {
  try {
    const { site_id, status, severity, limit = 100 } = req.query;
    const params = [];
    let sql = `
      SELECT a.*, s.name AS site_name, s.region,
             u.username AS reviewed_by_username
      FROM alerts a
      JOIN sites s ON s.id = a.site_id
      LEFT JOIN users u ON u.id = a.reviewed_by
      WHERE 1=1
    `;
    if (site_id)  { params.push(site_id);  sql += ` AND a.site_id = $${params.length}`; }
    if (status)   { params.push(status);   sql += ` AND a.status = $${params.length}`; }
    if (severity) { params.push(severity); sql += ` AND a.severity = $${params.length}`; }
    params.push(parseInt(limit));
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// POST /api/alerts — Create alert (system/anomaly service)
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const { site_id, alert_type, severity, detection_method,
          anomaly_score, contributing_features, model_version,
          message, correlation_id } = req.body;

  if (!site_id || !alert_type) {
    return res.status(400).json({ error: 'site_id and alert_type required' });
  }

  try {
    const result = await query(
      `INSERT INTO alerts
         (site_id, alert_type, severity, detection_method, anomaly_score,
          contributing_features, model_version, message, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [site_id, alert_type, severity || 'medium', detection_method || 'rule_based',
       anomaly_score, JSON.stringify(contributing_features || {}),
       model_version || '1.0.0', message, correlation_id]
    );

    const alert = result.rows[0];

    // Get site info for the broadcast
    const siteResult = await query('SELECT name, region FROM sites WHERE id = $1', [site_id]);

    emitEvent('alert:created', {
      ...alert,
      siteName: siteResult.rows[0]?.name,
      region:   siteResult.rows[0]?.region,
    });

    res.status(201).json(alert);
  } catch (err) {
    console.error('[Alerts] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// PATCH /api/alerts/:id/review — Human review action
router.patch('/:id/review', authenticate, requireRole('admin', 'manager', 'auditor'), async (req, res) => {
  const { action, notes } = req.body;
  // action: acknowledged | resolved | dismissed | escalated
  const VALID_ACTIONS = ['acknowledged', 'resolved', 'dismissed', 'escalated'];
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Allowed: ${VALID_ACTIONS.join(', ')}` });
  }

  try {
    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE alerts SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
         WHERE id = $4 RETURNING *`,
        [action, req.user.id, notes, req.params.id]
      );
      if (!updated.rows[0]) throw new Error('Alert not found');

      await client.query(
        `INSERT INTO audit_logs
           (site_id, user_id, action_type, entity_type, entity_id, new_value, correlation_id)
         VALUES ($1,$2,'alert_reviewed','alert',$3,$4,$5)`,
        [updated.rows[0].site_id, req.user.id, updated.rows[0].id,
         JSON.stringify({ action, notes }), updated.rows[0].correlation_id]
      );
      return updated.rows[0];
    });

    emitEvent('alert:reviewed', { alertId: req.params.id, action, reviewedBy: req.user.username });
    res.json(result);
  } catch (err) {
    if (err.message === 'Alert not found') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// GET /api/alerts/stats — Alert statistics
router.get('/stats', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                           AS total,
        COUNT(*) FILTER (WHERE status = 'open')           AS open,
        COUNT(*) FILTER (WHERE severity = 'critical')     AS critical,
        COUNT(*) FILTER (WHERE detection_method = 'isolation_forest') AS ai_generated,
        AVG(anomaly_score) FILTER (WHERE anomaly_score IS NOT NULL)   AS avg_anomaly_score
      FROM alerts
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alert stats' });
  }
});

module.exports = router;
