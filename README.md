# DOM-RT
## A Domain-Neutral, Audit-Linked Reference Architecture for AI-Assisted Real-Time Distributed Operational Monitoring

Implementation of the DOM-RT architecture — IEEE Access submission.

---

## Quick Start (No Docker Required)

### Prerequisites
```bash
node --version    # 18+
python3 --version # 3.10+
psql --version    # 14+   (brew install postgresql@16)
```

### 1. PostgreSQL Setup
```bash
brew services start postgresql@16
psql postgres -c "CREATE USER domrt_user WITH PASSWORD 'domrt_secret';"
psql postgres -c "CREATE DATABASE domrt OWNER domrt_user;"
cd dom-rt/backend
psql -U domrt_user -d domrt -f src/db/schema.sql
```

### 2. Backend
```bash
cd dom-rt/backend
npm install
cat > .env << 'EOF'
PORT=4000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=domrt
DB_USER=domrt_user
DB_PASSWORD=domrt_secret
JWT_SECRET=dom-rt-dev-secret
JWT_EXPIRES_IN=8h
AI_SERVICE_URL=http://localhost:5001
CORS_ORIGIN=http://localhost:3000
AUTO_SCHEDULER=true
EOF
node fix-passwords.js
npm run dev
```

### 3. AI Service (new terminal)
```bash
cd dom-rt/ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

### 4. Frontend (new terminal)
```bash
cd dom-rt/frontend
npm install
cat > .env << 'EOF'
VITE_API_URL=http://localhost:4000
VITE_WS_URL=http://localhost:4000
EOF
npm run dev
```

Open http://localhost:3000

---

## Login Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | Password123! | Full access |
| manager1 | Password123! | Site operations |
| auditor1 | Password123! | Audit logs |
| viewer1 | Password123! | Read-only |

---

## Project Structure

```
dom-rt/
├── backend/
│   ├── fix-passwords.js          ← Run once after schema load
│   └── src/
│       ├── server.js             ← Express + Socket.IO + auto-scheduler
│       ├── db/                   ← pool.js, schema.sql, seed.sql
│       ├── middleware/           ← auth.js (JWT), rbac.js (roles)
│       ├── routes/
│       │   ├── auth.js           ← Login/logout
│       │   ├── sites.js          ← Site CRUD + status
│       │   ├── activity.js       ← Activity recording
│       │   ├── audit.js          ← Audit log + chain reconstruction
│       │   ├── alerts.js         ← Alerts + human review
│       │   └── report.js         ← Site self-reporting API
│       ├── services/
│       │   ├── websocket.js      ← Socket.IO broadcasts
│       │   ├── anomaly.js        ← 3-tier anomaly detection
│       │   ├── audit.js          ← Audit writer helper
│       │   └── auto-reporter.js  ← Schedule-based auto-reporting
│       └── benchmark/
│           └── generator.js      ← Synthetic workload generator
├── frontend/src/
│   ├── components/               ← Dashboard, AlertPanel, AuditLog, MetricsBar
│   ├── contexts/AuthContext.jsx  ← Auth + WebSocket
│   ├── pages/Login.jsx
│   └── services/api.js           ← Axios client
├── ai/
│   └── app.py                    ← Flask + Isolation Forest
├── scripts/loadtest.js           ← k6 benchmark
└── docker-compose.yml
```

---

## Site Self-Reporting API

Sites report their own status — no manual admin needed.

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Password123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Simulate all sites at current time
curl -X POST http://localhost:4000/api/report/simulate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'

# Simulate specific hour (9 = 9am business hours)
curl -X POST http://localhost:4000/api/report/simulate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"hour": 9}'

# Simulate full 24-hour day
curl -X POST http://localhost:4000/api/report/simulate/day \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"hours": 24, "delay_ms": 50}'

# Single site self-report
curl -X POST http://localhost:4000/api/report/status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"site_id": "<uuid>", "status": "open", "source": "site_sensor"}'

# Batch report
curl -X POST http://localhost:4000/api/report/batch \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reports": [{"site_id":"<id1>","status":"open"},{"site_id":"<id2>","status":"delayed"}]}'

# Start auto-scheduler (runs every 30s)
curl -X POST http://localhost:4000/api/report/scheduler/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"interval_seconds": 30}'
```

---

## Benchmark

```bash
# Generate synthetic data
node src/benchmark/generator.js small    # 50 sites
node src/benchmark/generator.js medium   # 250 sites
node src/benchmark/generator.js large    # 1000 sites

# k6 load test
k6 run --vus 25  --duration 120s scripts/loadtest.js
k6 run --vus 100 --duration 120s scripts/loadtest.js
k6 run --vus 500 --duration 120s scripts/loadtest.js

# Metrics
curl http://localhost:4000/metrics
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/audit/completeness
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/alerts/stats
curl http://localhost:5001/model
```

---

## Troubleshooting

```bash
# Kill ports
lsof -ti :4000 | xargs kill -9
lsof -ti :3000 | xargs kill -9
lsof -ti :5001 | xargs kill -9

# Fix DB permissions
psql domrt -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO domrt_user;"
psql domrt -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO domrt_user;"

# Fix login
cd backend && node fix-passwords.js
```

---

## License
MIT — Open source for research reproducibility.

---

## Security

All credentials are loaded from environment variables — no secrets are hardcoded.

```bash
# Backend setup
cp backend/.env.example backend/.env
# Edit backend/.env and fill in DB_USER, DB_PASSWORD, JWT_SECRET

# Generate a secure JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

See [SECURITY.md](SECURITY.md) for the full security policy, production checklist, and demo credential details.

---

## Citation

If you use DOM-RT in your research, please cite:

```bibtex
@article{guru2026domrt,
  title   = {DOM-RT: A Domain-Neutral, Audit-Linked Framework for
             AI-Assisted Real-Time Distributed Operational Monitoring},
  author  = {Guru, Dhivya},
  journal = {IEEE Access},
  year    = {2026},
  doi     = {<INSERT DOI AFTER ACCEPTANCE>}
}
```

---

## License

MIT License — open source for research reproducibility.
See [LICENSE](LICENSE) for full terms.
