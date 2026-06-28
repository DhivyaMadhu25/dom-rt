const express = require('express');
const { query }      = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');

const router = express.Router();

// GET /api/audit — Query audit logs (auditor+)
router.get('/', authenticate, requireRole('admin', 'auditor'), async (req, res) => {
  try {
    const { site_id, user_id, action_type, from, to, limit = 200 } = req.query;
    const params = [];
    let sql = `
      SELECT al.*,
             u.username   AS actor_username,
             s.name       AS site_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id  = al.user_id
      LEFT JOIN sites s ON s.id  = al.site_id
      WHERE 1=1
    `;
    if (site_id)     { params.push(site_id);     sql += ` AND al.site_id = $${params.length}`; }
    if (user_id)     { params.push(user_id);     sql += ` AND al.user_id = $${params.length}`; }
    if (action_type) { params.push(action_type); sql += ` AND al.action_type = $${params.length}`; }
    if (from)        { params.push(from);         sql += ` AND al.created_at >= $${params.length}`; }
    if (to)          { params.push(to);           sql += ` AND al.created_at <= $${params.length}`; }
    params.push(parseInt(limit));
    sql += ` ORDER BY al.created_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Audit] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/audit/reconstruct/:correlationId — Full event chain by correlation ID
router.get('/reconstruct/:correlationId', authenticate, requireRole('admin', 'auditor'), async (req, res) => {
  const { correlationId } = req.params;
  try {
    const [auditRows, eventRows] = await Promise.all([
      query(
        `SELECT al.*, u.username FROM audit_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.correlation_id = $1 ORDER BY al.created_at`,
        [correlationId]
      ),
      query(
        `SELECT oe.*, u.username AS actor_username FROM operational_events oe
         LEFT JOIN users u ON u.id = oe.actor_id
         WHERE oe.correlation_id = $1 ORDER BY oe.recorded_at`,
        [correlationId]
      ),
    ]);

    res.json({
      correlationId,
      audit_chain:       auditRows.rows,
      operational_events: eventRows.rows,
      reconstructed_at:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reconstruct event chain' });
  }
});

// GET /api/audit/completeness — Audit completeness metrics
router.get('/completeness', authenticate, requireRole('admin', 'auditor'), async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                         AS total_records,
        COUNT(user_id)                                   AS with_user_id,
        COUNT(site_id)                                   AS with_site_id,
        COUNT(correlation_id)                            AS with_correlation_id,
        ROUND(COUNT(user_id)::numeric / COUNT(*) * 100, 2)          AS user_completeness_pct,
        ROUND(COUNT(correlation_id)::numeric / COUNT(*) * 100, 2)   AS correlation_completeness_pct
      FROM audit_logs
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute completeness' });
  }
});

module.exports = router;
