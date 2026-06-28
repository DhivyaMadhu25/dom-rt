const { query } = require('../db/pool');

/**
 * Write an immutable audit record.
 * Called within transactions wherever possible.
 */
const writeAuditLog = async ({
  siteId,
  userId,
  actionType,
  entityType,
  entityId,
  previousValue,
  newValue,
  sourceIp,
  userAgent,
  correlationId,
}, client = null) => {
  const db = client || { query: (sql, params) => query(sql, params) };
  try {
    await db.query(
      `INSERT INTO audit_logs
         (site_id, user_id, action_type, entity_type, entity_id,
          previous_value, new_value, source_ip, user_agent, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        siteId       || null,
        userId       || null,
        actionType,
        entityType   || null,
        entityId     || null,
        previousValue ? JSON.stringify(previousValue) : null,
        newValue      ? JSON.stringify(newValue)      : null,
        sourceIp     || null,
        userAgent    || null,
        correlationId,
      ]
    );
  } catch (err) {
    // Audit write failure should never crash the main operation — log it
    console.error('[Audit] Failed to write audit log:', err.message);
  }
};

module.exports = { writeAuditLog };
