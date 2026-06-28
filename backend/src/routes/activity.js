const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db/pool');
const { authenticate }           = require('../middleware/auth');
const { requireRole }            = require('../middleware/rbac');
const { emitEvent }              = require('../services/websocket');
const { triggerAnomalyCheck }    = require('../services/anomaly');

const router = express.Router();

// POST /api/activity — Record a new operational activity
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const { site_id, activity_type, amount, unit, description, metadata } = req.body;

  if (!site_id || !activity_type) {
    return res.status(400).json({ error: 'site_id and activity_type required' });
  }

  try {
    const correlationId = req.correlationId || uuidv4();

    const result = await withTransaction(async (client) => {
      const site = await client.query('SELECT * FROM sites WHERE id = $1', [site_id]);
      if (!site.rows[0]) throw new Error('Site not found');

      const record = await client.query(
        `INSERT INTO activity_records
           (site_id, activity_type, actor_id, amount, unit, description, metadata, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [site_id, activity_type, req.user.id, amount, unit,
         description, JSON.stringify(metadata || {}), correlationId]
      );

      await client.query(
        `INSERT INTO audit_logs
           (site_id, user_id, action_type, entity_type, entity_id,
            new_value, source_ip, correlation_id)
         VALUES ($1,$2,'activity_recorded','activity',$3,$4,$5,$6)`,
        [site_id, req.user.id, record.rows[0].id,
         JSON.stringify({ activity_type, amount, unit }),
         req.ip, correlationId]
      );

      return record.rows[0];
    });

    // Broadcast real-time activity event
    emitEvent('activity:recorded', {
      siteId:        site_id,
      activityType:  activity_type,
      amount,
      unit,
      recordedBy:    req.user.username,
      correlationId,
      timestamp:     new Date().toISOString(),
    });

    // Async anomaly check — non-blocking
    triggerAnomalyCheck(site_id, 'activity_recorded', correlationId).catch(console.error);

    res.status(201).json({ ...result, correlationId });
  } catch (err) {
    console.error('[Activity] POST error:', err.message);
    if (err.message === 'Site not found') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Failed to record activity' });
  }
});

// GET /api/activity?site_id=&date=&limit=
router.get('/', authenticate, async (req, res) => {
  try {
    const { site_id, date, limit = 100 } = req.query;
    const params = [];
    let sql = `
      SELECT ar.*, u.username AS actor_username, s.name AS site_name
      FROM activity_records ar
      LEFT JOIN users u ON u.id = ar.actor_id
      LEFT JOIN sites s ON s.id = ar.site_id
      WHERE 1=1
    `;
    if (site_id) { params.push(site_id); sql += ` AND ar.site_id = $${params.length}`; }
    if (date)    { params.push(date);    sql += ` AND ar.recorded_at::date = $${params.length}`; }
    params.push(parseInt(limit));
    sql += ` ORDER BY ar.recorded_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch activity records' });
  }
});

module.exports = router;
