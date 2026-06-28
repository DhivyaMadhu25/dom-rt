const express = require('express');
const bcrypt  = require('bcrypt');
const { query }         = require('../db/pool');
const { generateToken, authenticate } = require('../middleware/auth');
const { writeAuditLog } = require('../services/audit');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  try {
    const result = await query(
      `SELECT u.*, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.username = $1 AND u.is_active = true`,
      [username]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    await writeAuditLog({
      userId:      user.id,
      actionType:  'user_login',
      entityType:  'user',
      entityId:    user.id,
      newValue:    { username: user.username, role: user.role_name },
      sourceIp:    req.ip,
      userAgent:   req.headers['user-agent'],
      correlationId: req.correlationId,
    });

    res.json({
      token,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
        role:     user.role_name,
        region:   user.region,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.region, r.name AS role
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await writeAuditLog({
    userId:       req.user.id,
    actionType:   'user_logout',
    entityType:   'user',
    entityId:     req.user.id,
    sourceIp:     req.ip,
    correlationId: req.correlationId,
  });
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
