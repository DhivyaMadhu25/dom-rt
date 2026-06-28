-- DOM-RT Database Schema
-- PostgreSQL 16+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- ROLES
-- ─────────────────────────────────────────
CREATE TABLE roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) UNIQUE NOT NULL,  -- admin | manager | auditor | viewer
    description TEXT
);

INSERT INTO roles (name, description) VALUES
  ('admin',   'Full system access including user management'),
  ('manager', 'Operational site management and status updates'),
  ('auditor', 'Read-only access to audit logs and reports'),
  ('viewer',  'Dashboard and summary read access');

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(100) UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INTEGER NOT NULL REFERENCES roles(id),
    region        VARCHAR(100),
    is_active     BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- OPERATIONAL SITES (domain-neutral nodes)
-- ─────────────────────────────────────────
CREATE TABLE sites (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    domain_type     VARCHAR(50) NOT NULL,   -- branch | store | depot | clinic | cell | hub
    location        VARCHAR(200),
    region          VARCHAR(100),
    timezone        VARCHAR(50) DEFAULT 'America/New_York',
    scheduled_open  TIME,
    scheduled_close TIME,
    status          VARCHAR(50) DEFAULT 'inactive',
    -- status: inactive | open | closed | delayed | degraded | failed
    responsible_user_id UUID REFERENCES users(id),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sites_region  ON sites(region);
CREATE INDEX idx_sites_status  ON sites(status);
CREATE INDEX idx_sites_domain  ON sites(domain_type);

-- ─────────────────────────────────────────
-- OPERATIONAL EVENTS (normalized schema)
-- ─────────────────────────────────────────
CREATE TABLE operational_events (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id          UUID NOT NULL REFERENCES sites(id),
    category         VARCHAR(50) NOT NULL,
    -- category: status_change | activity | exception | compliance | report
    event_type       VARCHAR(100) NOT NULL,
    -- e.g. site_opened, site_closed, transaction_recorded, exception_raised
    actor_id         UUID REFERENCES users(id),
    source           VARCHAR(100),          -- user | system | sensor | integration
    previous_value   VARCHAR(200),
    new_value        VARCHAR(200),
    payload          JSONB DEFAULT '{}',
    correlation_id   UUID NOT NULL DEFAULT uuid_generate_v4(),
    -- links API request → DB commit → WebSocket emission → dashboard update → AI alert
    recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_site       ON operational_events(site_id);
CREATE INDEX idx_events_category   ON operational_events(category);
CREATE INDEX idx_events_corr       ON operational_events(correlation_id);
CREATE INDEX idx_events_recorded   ON operational_events(recorded_at DESC);

-- ─────────────────────────────────────────
-- ACTIVITY RECORDS
-- ─────────────────────────────────────────
CREATE TABLE activity_records (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id        UUID NOT NULL REFERENCES sites(id),
    activity_type  VARCHAR(100) NOT NULL,
    actor_id       UUID REFERENCES users(id),
    amount         NUMERIC(18,4),
    unit           VARCHAR(50),
    description    TEXT,
    metadata       JSONB DEFAULT '{}',
    correlation_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    recorded_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_site ON activity_records(site_id);
CREATE INDEX idx_activity_at   ON activity_records(recorded_at DESC);

-- ─────────────────────────────────────────
-- AUDIT LOG (append-only, never updated)
-- ─────────────────────────────────────────
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id         UUID REFERENCES sites(id),
    user_id         UUID REFERENCES users(id),
    action_type     VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50),           -- site | user | alert | event
    entity_id       UUID,
    previous_value  JSONB,
    new_value       JSONB,
    source_ip       VARCHAR(45),
    user_agent      VARCHAR(500),
    correlation_id  UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce append-only: prevent UPDATE and DELETE
CREATE RULE audit_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

CREATE INDEX idx_audit_site  ON audit_logs(site_id);
CREATE INDEX idx_audit_user  ON audit_logs(user_id);
CREATE INDEX idx_audit_corr  ON audit_logs(correlation_id);
CREATE INDEX idx_audit_at    ON audit_logs(created_at DESC);

-- ─────────────────────────────────────────
-- ALERTS
-- ─────────────────────────────────────────
CREATE TABLE alerts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id             UUID NOT NULL REFERENCES sites(id),
    alert_type          VARCHAR(100) NOT NULL,
    -- delayed_opening | missing_activity | abnormal_volume | repeated_exception | ai_anomaly
    severity            VARCHAR(20) DEFAULT 'medium',
    -- low | medium | high | critical
    detection_method    VARCHAR(50),
    -- rule_based | statistical | isolation_forest | hybrid
    anomaly_score       NUMERIC(6,4),
    contributing_features JSONB DEFAULT '{}',
    model_version       VARCHAR(50),
    message             TEXT,
    correlation_id      UUID NOT NULL,
    status              VARCHAR(20) DEFAULT 'open',
    -- open | acknowledged | resolved | dismissed
    reviewed_by         UUID REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_site   ON alerts(site_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_at     ON alerts(created_at DESC);

-- ─────────────────────────────────────────
-- BENCHMARK METRICS
-- ─────────────────────────────────────────
CREATE TABLE benchmark_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          UUID NOT NULL,
    metric_name     VARCHAR(100) NOT NULL,
    metric_value    NUMERIC(18,6),
    unit            VARCHAR(50),
    workload_size   VARCHAR(20),
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- UTILITY VIEWS
-- ─────────────────────────────────────────
CREATE VIEW site_daily_summary AS
SELECT
    s.id                              AS site_id,
    s.name                            AS site_name,
    s.region,
    s.status,
    COUNT(ar.id)                      AS activity_count,
    COALESCE(SUM(ar.amount), 0)       AS total_amount,
    COUNT(DISTINCT ar.activity_type)  AS distinct_activity_types,
    MAX(ar.recorded_at)               AS last_activity_at
FROM sites s
LEFT JOIN activity_records ar
    ON ar.site_id = s.id
    AND ar.recorded_at >= CURRENT_DATE
    AND ar.recorded_at <  CURRENT_DATE + INTERVAL '1 day'
GROUP BY s.id, s.name, s.region, s.status;
