# Security Policy — DOM-RT

## Sensitive Data Handling

### What is NEVER stored in this repository

| Type | Where to put it instead |
|------|------------------------|
| Database passwords | `.env` file (git-ignored) |
| JWT secrets | `.env` file (git-ignored) |
| API keys | `.env` file (git-ignored) |
| Trained model binaries (`.pkl`) | Release artifacts or cloud storage |
| Actual user data | Never in this research repo |

### Environment variable pattern

Every service uses environment variables loaded from `.env` files.
Template files (`.env.example`) are committed — actual `.env` files are not.

```
backend/.env.example    ← committed  (shows required vars, no values)
backend/.env            ← git-ignored (your real values)
frontend/.env.example   ← committed
frontend/.env           ← git-ignored
.env.docker.example     ← committed  (for Docker Compose)
.env.docker             ← git-ignored
```

---

## Setup for Local Development

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env and fill in your values

# Frontend
cp frontend/.env.example frontend/.env
# Defaults work for local development

# Generate a secure JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Paste output into backend/.env as JWT_SECRET
```

---

## Demo Credentials (Local Development Only)

The setup script (`fix-passwords.js`) creates demo accounts for local
development and research reproducibility. These accounts use the password
defined in `DEMO_PASSWORD` env var (default: `DomRT_Demo_2026!`).

**These credentials are for local research use only.**
Change all passwords before any non-local deployment.

| Username | Role |
|----------|------|
| admin | Full access |
| manager1 | Site operations |
| auditor1 | Audit logs |
| viewer1 | Read-only |

---

## Reporting Security Issues

This is a research prototype. If you find a security issue relevant to
the architecture described in the paper, please open a GitHub Issue
labeled `security` or contact the corresponding author directly.

---

## Production Deployment Checklist

Before deploying DOM-RT in any non-research environment:

- [ ] Generate unique JWT_SECRET (64+ random bytes)
- [ ] Use strong database passwords
- [ ] Change all demo account passwords
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS / TLS termination
- [ ] Restrict CORS_ORIGIN to your actual frontend domain
- [ ] Set up PostgreSQL with proper user permissions (not superuser)
- [ ] Enable database connection SSL
- [ ] Review and tighten RBAC roles for your domain
- [ ] Set up log rotation and monitoring
- [ ] Enable rate limiting on authentication endpoints
