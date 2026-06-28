/**
 * DOM-RT k6 Load Test
 * Usage: k6 run --vus 25 --duration 60s scripts/loadtest.js
 */

import http   from 'k6/http';
import ws     from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics matching paper evaluation
const apiLatency     = new Trend('api_latency_ms');
const wsLatency      = new Trend('ws_latency_ms');
const throughput     = new Counter('events_processed');
const errorRate      = new Rate('error_rate');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  stages: [
    { duration:'30s', target: 25  },  // ramp up
    { duration:'60s', target: 100 },  // sustained load
    { duration:'30s', target: 0   },  // ramp down
  ],
  thresholds: {
    api_latency_ms:     ['p(95)<500'],   // paper target: P95 < 500ms
    ws_latency_ms:      ['p(95)<1000'],  // paper target: P95 < 1s
    error_rate:         ['rate<0.005'],  // < 0.5%
  },
};

// Login once per VU
export function setup() {
  const res = http.post(`${BASE_URL}/api/auth/login`,
    JSON.stringify({ username:'admin', password:'DomRT_Demo_2026!' }),
    { headers: { 'Content-Type':'application/json' } }
  );
  check(res, { 'login ok': r => r.status === 200 });
  return { token: res.json('token') };
}

export default function(data) {
  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${data.token}`,
  };

  // ── REST: GET sites ─────────────────────────────────────
  const t0 = Date.now();
  const sitesRes = http.get(`${BASE_URL}/api/sites`, { headers });
  apiLatency.add(Date.now() - t0);
  errorRate.add(sitesRes.status !== 200);
  check(sitesRes, { 'GET /sites 200': r => r.status === 200 });
  throughput.add(1);

  // ── REST: Record activity ────────────────────────────────
  const sites = sitesRes.json();
  if (sites && sites.length > 0) {
    const siteId = sites[Math.floor(Math.random() * sites.length)].id;
    const t1 = Date.now();
    const actRes = http.post(
      `${BASE_URL}/api/activity`,
      JSON.stringify({
        site_id:       siteId,
        activity_type: 'transaction',
        amount:        (Math.random() * 5000).toFixed(2),
        unit:          'USD',
        description:   'k6 benchmark transaction',
      }),
      { headers }
    );
    apiLatency.add(Date.now() - t1);
    errorRate.add(actRes.status !== 201);
    throughput.add(1);

    // ── REST: PATCH site status ──────────────────────────
    const statuses = ['open','closed','delayed'];
    const t2 = Date.now();
    const statusRes = http.patch(
      `${BASE_URL}/api/sites/${siteId}/status`,
      JSON.stringify({ status: statuses[Math.floor(Math.random() * statuses.length)] }),
      { headers }
    );
    apiLatency.add(Date.now() - t2);
    errorRate.add(statusRes.status !== 200);
    throughput.add(1);
  }

  // ── REST: Audit logs ────────────────────────────────────
  const t3 = Date.now();
  http.get(`${BASE_URL}/api/audit?limit=20`, { headers });
  apiLatency.add(Date.now() - t3);

  // ── REST: Alerts ────────────────────────────────────────
  http.get(`${BASE_URL}/api/alerts?status=open&limit=10`, { headers });

  sleep(0.5);
}

export function teardown(data) {
  console.log('k6 benchmark complete. Review thresholds above.');
}
