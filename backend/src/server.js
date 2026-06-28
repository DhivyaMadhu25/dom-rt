require('dotenv').config();
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const { v4: uuidv4 } = require('uuid');

const { initWebSocket, getConnectedCount } = require('./services/websocket');
const { generateBenchmarkData }            = require('./benchmark/generator');
const { waitForDb }                        = require('./db/pool');

const reportRouter   = require('./routes/report');
const { startScheduler } = require('./services/auto-reporter');
const authRouter     = require('./routes/auth');
const sitesRouter    = require('./routes/sites');
const activityRouter = require('./routes/activity');
const auditRouter    = require('./routes/audit');
const alertsRouter   = require('./routes/alerts');

const app    = express();
const server = http.createServer(app);

// ── Middleware ───────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

// Attach correlation ID to every request (links API → DB → WebSocket → AI)
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} ${duration}ms corr=${req.correlationId}`);
  });
  next();
});

// ── Routes ───────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/api/sites',    sitesRouter);
app.use('/api/activity', activityRouter);
app.use('/api/audit',    auditRouter);
app.use('/api/alerts',   alertsRouter);
app.use('/api/report',   reportRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:     'ok',
    version:    '1.0.0',
    timestamp:  new Date().toISOString(),
    websockets: getConnectedCount(),
  });
});

// Observability metrics endpoint
app.get('/metrics', async (req, res) => {
  const { query } = require('./db/pool');
  const [sites, events, alerts, audits] = await Promise.all([
    query('SELECT COUNT(*) FROM sites WHERE is_active=true'),
    query('SELECT COUNT(*) FROM operational_events WHERE recorded_at >= NOW()-INTERVAL\'1 hour\''),
    query('SELECT COUNT(*) FROM alerts WHERE status=\'open\''),
    query('SELECT COUNT(*) FROM audit_logs WHERE created_at >= NOW()-INTERVAL\'1 hour\''),
  ]);
  res.json({
    active_sites:        parseInt(sites.rows[0].count),
    events_last_hour:    parseInt(events.rows[0].count),
    open_alerts:         parseInt(alerts.rows[0].count),
    audit_logs_last_hour: parseInt(audits.rows[0].count),
    websocket_clients:   getConnectedCount(),
    timestamp:           new Date().toISOString(),
  });
});

// Benchmark trigger endpoint
app.post('/api/benchmark/run', async (req, res) => {
  const { profile = 'small' } = req.body;
  try {
    const result = await generateBenchmarkData(profile);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');

async function start() {
  // Wait for PostgreSQL before accepting any requests
  await waitForDb(5, 3000);

  // WebSocket
  initWebSocket(server);

  // Auto-scheduler
  if (process.env.AUTO_SCHEDULER !== 'false') {
    startScheduler(60);
  }

  server.listen(PORT, () => {
    console.log(`\n  DOM-RT Backend running on http://localhost:${PORT}`);
    console.log(`  WebSocket ready on ws://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/health\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

module.exports = { app, server };
