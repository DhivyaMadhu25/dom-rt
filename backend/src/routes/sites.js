const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db/pool');
const { authenticate }           = require('../middleware/auth');
const { requireRole, requireSiteRegionAccess } = require('../middleware/rbac');
const { writeAuditLog }          = require('../services/audit');
const { emitEvent }              = require('../services/websocket');

const router = express.Router();

// ─── GET /api/sites ─── List all sites (viewer+)
router.get('/', authenticate, async (req, res) => {
  try {
    const { region, status, domain_type } = req.query;
    let sql = `
      SELECT s.*, u.username AS responsible_username,
             COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open') AS open_alert_count
      FROM sites s
      LEFT JOIN users u  ON u.id  = s.responsible_user_id
      LEFT JOIN alerts a ON a.site_id = s.id
      WHERE s.is_active = true
    `;
    const params = [];
    if (region)      { params.push(region);      sql += ` AND s.region = $${params.length}`; }
    if (status)      { params.push(status);      sql += ` AND s.status = $${params.length}`; }
    if (domain_type) { params.push(domain_type); sql += ` AND s.domain_type = $${params.length}`; }
    sql += ' GROUP BY s.id, u.username ORDER BY s.name';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Sites] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

// ─── GET /api/sites/:id ─── Site detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT s.*, u.username AS responsible_username
       FROM sites s
       LEFT JOIN users u ON u.id = s.responsible_user_id
       WHERE s.id = $1 AND s.is_active = true`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Site not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch site' });
  }
});

// ─── POST /api/sites ─── Create site (admin only)
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { name, domain_type, location, region, timezone,
          scheduled_open, scheduled_close, responsible_user_id } = req.body;

  if (!name || !domain_type) {
    return res.status(400).json({ error: 'name and domain_type are required' });
  }

  try {
    const correlationId = req.correlationId || uuidv4();
    const result = await withTransaction(async (client) => {
      const site = await client.query(
        `INSERT INTO sites (name, domain_type, location, region, timezone,
                            scheduled_open, scheduled_close, responsible_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [name, domain_type, location, region, timezone || 'America/New_York',
         scheduled_open, scheduled_close, responsible_user_id]
      );
      await client.query(
        `INSERT INTO audit_logs (site_id, user_id, action_type, entity_type, entity_id,
                                  new_value, source_ip, correlation_id)
         VALUES ($1,$2,'site_created','site',$3,$4,$5,$6)`,
        [site.rows[0].id, req.user.id, site.rows[0].id,
         JSON.stringify({ name, domain_type, region }), req.ip, correlationId]
      );
      return site.rows[0];
    });

    emitEvent('site:created', result);
    res.status(201).json(result);
  } catch (err) {
    console.error('[Sites] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create site' });
  }
});

// ─── PATCH /api/sites/:id/status ─── Update site status (core DOM-RT operation)
router.patch('/:id/status', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const { status, notes } = req.body;
  const VALID_STATUSES = ['inactive', 'open', 'closed', 'delayed', 'degraded', 'failed'];

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const siteResult = await query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    const site = siteResult.rows[0];
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Region-scoped access check
    if (!requireSiteRegionAccess(site.region, req.user.region, req.user.role)) {
      return res.status(403).json({ error: 'Access denied: site is outside your region' });
    }

    const correlationId = req.correlationId || uuidv4();
    const previousStatus = site.status;

    // Atomic: update site + write operational event + write audit log
    const updated = await withTransaction(async (client) => {
      const updatedSite = await client.query(
        `UPDATE sites SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, site.id]
      );

      await client.query(
        `INSERT INTO operational_events
           (site_id, category, event_type, actor_id, source,
            previous_value, new_value, payload, correlation_id)
         VALUES ($1,'status_change','site_status_updated',$2,'user',$3,$4,$5,$6)`,
        [site.id, req.user.id, previousStatus, status,
         JSON.stringify({ notes, timestamp: new Date().toISOString() }), correlationId]
      );

      await client.query(
        `INSERT INTO audit_logs
           (site_id, user_id, action_type, entity_type, entity_id,
            previous_value, new_value, source_ip, correlation_id)
         VALUES ($1,$2,'site_status_updated','site',$3,$4,$5,$6,$7)`,
        [site.id, req.user.id, site.id,
         JSON.stringify({ status: previousStatus }),
         JSON.stringify({ status, notes }),
         req.ip, correlationId]
      );

      return updatedSite.rows[0];
    });

    // Real-time WebSocket broadcast after successful DB commit
    emitEvent('site:status_updated', {
      siteId:         site.id,
      siteName:       site.name,
      previousStatus,
      status,
      updatedBy:      req.user.username,
      correlationId,
      timestamp:      new Date().toISOString(),
    });

    res.json({ ...updated, correlationId });
  } catch (err) {
    console.error('[Sites] PATCH status error:', err.message);
    res.status(500).json({ error: 'Failed to update site status' });
  }
});

// ─── GET /api/sites/:id/summary ─── Daily operational summary
router.get('/:id/summary', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM site_daily_summary WHERE site_id = $1',
      [req.params.id]
    );
    res.json(result.rows[0] || { site_id: req.params.id, activity_count: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ─── GET /api/sites/summary/regional ─── Regional overview
router.get('/summary/regional', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT region,
             COUNT(*)                                     AS total_sites,
             COUNT(*) FILTER (WHERE status = 'open')     AS open_sites,
             COUNT(*) FILTER (WHERE status = 'closed')   AS closed_sites,
             COUNT(*) FILTER (WHERE status = 'delayed')  AS delayed_sites,
             COUNT(*) FILTER (WHERE status = 'failed')   AS failed_sites
      FROM sites
      WHERE is_active = true
      GROUP BY region
      ORDER BY region
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch regional summary' });
  }
});

module.exports = router;
