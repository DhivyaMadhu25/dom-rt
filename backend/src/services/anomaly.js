const { query }     = require('../db/pool');
const { emitEvent } = require('./websocket');
const { v4: uuidv4 } = require('uuid');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:5001';
const MODEL_VERSION  = '1.0.0';

// ─────────────────────────────────────────────────────────
// Rule-based detection (Tier 1)
// ─────────────────────────────────────────────────────────
const RULES = {
  delayed_opening: async (siteId) => {
    const result = await query(
      `SELECT s.scheduled_open, s.status, s.updated_at, s.name
       FROM sites s WHERE s.id = $1`,
      [siteId]
    );
    const site = result.rows[0];
    if (!site || !site.scheduled_open) return null;

    const now          = new Date();
    const [h, m]       = site.scheduled_open.split(':').map(Number);
    const scheduledTs  = new Date(now);
    scheduledTs.setHours(h, m, 0, 0);
    const delayMinutes = (now - scheduledTs) / 60000;

    if (site.status === 'inactive' && delayMinutes > 30) {
      return {
        alert_type: 'delayed_opening',
        severity:   delayMinutes > 60 ? 'high' : 'medium',
        message:    `${site.name} has not opened. Delay: ${Math.round(delayMinutes)} minutes.`,
        contributing_features: { delay_minutes: Math.round(delayMinutes), scheduled_open: site.scheduled_open },
      };
    }
    return null;
  },

  missing_activity: async (siteId) => {
    const result = await query(
      `SELECT COUNT(*) AS cnt FROM activity_records
       WHERE site_id = $1
       AND recorded_at >= NOW() - INTERVAL '2 hours'`,
      [siteId]
    );
    const count = parseInt(result.rows[0].cnt);
    const siteStatus = await query('SELECT status FROM sites WHERE id = $1', [siteId]);

    if (siteStatus.rows[0]?.status === 'open' && count === 0) {
      return {
        alert_type: 'missing_activity',
        severity:   'medium',
        message:    'Site is open but no activity recorded in the last 2 hours.',
        contributing_features: { activity_count_2h: count },
      };
    }
    return null;
  },

  repeated_exceptions: async (siteId) => {
    const result = await query(
      `SELECT COUNT(*) AS cnt FROM operational_events
       WHERE site_id = $1 AND category = 'exception'
       AND recorded_at >= NOW() - INTERVAL '1 hour'`,
      [siteId]
    );
    const count = parseInt(result.rows[0].cnt);
    if (count >= 5) {
      return {
        alert_type: 'repeated_exception',
        severity:   count >= 10 ? 'critical' : 'high',
        message:    `${count} exceptions recorded in the last hour.`,
        contributing_features: { exception_count_1h: count },
      };
    }
    return null;
  },
};

// ─────────────────────────────────────────────────────────
// Statistical baseline check (Tier 2)
// ─────────────────────────────────────────────────────────
const statisticalBaselineCheck = async (siteId) => {
  try {
    // Compare today's activity volume vs 7-day rolling average
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE recorded_at >= CURRENT_DATE) AS today_count,
         AVG(daily_cnt) AS baseline_avg,
         STDDEV(daily_cnt) AS baseline_std
       FROM (
         SELECT recorded_at::date AS day, COUNT(*) AS daily_cnt
         FROM activity_records
         WHERE site_id = $1
           AND recorded_at >= NOW() - INTERVAL '8 days'
           AND recorded_at < CURRENT_DATE
         GROUP BY recorded_at::date
       ) sub, activity_records ar2
       WHERE ar2.site_id = $1`,
      [siteId]
    );

    const row = result.rows[0];
    if (!row || !row.baseline_avg) return null;

    const todayCount = parseFloat(row.today_count);
    const avg        = parseFloat(row.baseline_avg);
    const std        = parseFloat(row.baseline_std) || 1;
    const zScore     = (todayCount - avg) / std;

    if (Math.abs(zScore) > 2.5) {
      return {
        alert_type: 'abnormal_volume',
        severity:   Math.abs(zScore) > 3.5 ? 'high' : 'medium',
        message:    `Abnormal activity volume detected. Z-score: ${zScore.toFixed(2)}`,
        contributing_features: {
          today_count: todayCount,
          baseline_avg: avg.toFixed(1),
          z_score: zScore.toFixed(2),
        },
      };
    }
    return null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────
// Isolation Forest check via Python AI service (Tier 3)
// ─────────────────────────────────────────────────────────
const isolationForestCheck = async (siteId) => {
  try {
    // Build feature vector for the site
    const features = await query(
      `SELECT
         COALESCE(AVG(EXTRACT(EPOCH FROM (ar.recorded_at - s.updated_at))/60), 0) AS avg_open_delay,
         COUNT(ar.id)       AS activity_count,
         COALESCE(SUM(ar.amount), 0) AS total_amount,
         COUNT(a.id) FILTER (WHERE a.status = 'open')     AS open_alerts,
         COUNT(oe.id) FILTER (WHERE oe.category = 'exception') AS exception_count
       FROM sites s
       LEFT JOIN activity_records ar ON ar.site_id = s.id AND ar.recorded_at >= CURRENT_DATE
       LEFT JOIN alerts a            ON a.site_id  = s.id AND a.created_at  >= CURRENT_DATE
       LEFT JOIN operational_events oe ON oe.site_id = s.id AND oe.recorded_at >= CURRENT_DATE
       WHERE s.id = $1
       GROUP BY s.id`,
      [siteId]
    );

    if (!features.rows[0]) return null;

    const response = await fetch(`${AI_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, features: features.rows[0] }),
    });

    if (!response.ok) return null;
    const prediction = await response.json();

    if (prediction.is_anomaly && prediction.anomaly_score > 0.6) {
      return {
        alert_type:  'ai_anomaly',
        severity:    prediction.anomaly_score > 0.85 ? 'high' : 'medium',
        detection_method: 'isolation_forest',
        anomaly_score: prediction.anomaly_score,
        model_version: prediction.model_version,
        message:     `Isolation Forest detected anomalous operational pattern. Score: ${prediction.anomaly_score.toFixed(3)}`,
        contributing_features: prediction.top_features,
      };
    }
    return null;
  } catch {
    // AI service unavailable — degrade gracefully
    return null;
  }
};

// ─────────────────────────────────────────────────────────
// Main entry point — called after every operational event
// ─────────────────────────────────────────────────────────
const triggerAnomalyCheck = async (siteId, eventType, correlationId) => {
  const detectedAlerts = [];

  // Tier 1: Rule-based
  for (const [ruleName, ruleCheck] of Object.entries(RULES)) {
    const alert = await ruleCheck(siteId).catch(() => null);
    if (alert) {
      detectedAlerts.push({ ...alert, detection_method: 'rule_based' });
    }
  }

  // Tier 2: Statistical
  const statAlert = await statisticalBaselineCheck(siteId);
  if (statAlert) detectedAlerts.push({ ...statAlert, detection_method: 'statistical' });

  // Tier 3: Isolation Forest (only every 5th call to avoid overhead)
  if (Math.random() < 0.2) {
    const aiAlert = await isolationForestCheck(siteId);
    if (aiAlert) detectedAlerts.push(aiAlert);
  }

  // Persist and broadcast all detected alerts
  for (const alert of detectedAlerts) {
    try {
      const result = await query(
        `INSERT INTO alerts
           (site_id, alert_type, severity, detection_method, anomaly_score,
            contributing_features, model_version, message, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          siteId, alert.alert_type, alert.severity,
          alert.detection_method || 'rule_based',
          alert.anomaly_score || null,
          JSON.stringify(alert.contributing_features || {}),
          alert.model_version || MODEL_VERSION,
          alert.message, correlationId,
        ]
      );

      emitEvent('alert:created', {
        ...result.rows[0],
        correlationId,
      });
    } catch (err) {
      console.error('[Anomaly] Failed to persist alert:', err.message);
    }
  }

  return detectedAlerts;
};

module.exports = { triggerAnomalyCheck };
