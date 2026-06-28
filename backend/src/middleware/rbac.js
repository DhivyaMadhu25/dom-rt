/**
 * DOM-RT Role-Based Access Control (RBAC) Middleware
 *
 * Roles:  admin > manager > auditor > viewer
 * Each route declares the minimum role(s) allowed.
 */

const ROLE_HIERARCHY = {
  admin:   4,
  manager: 3,
  auditor: 2,
  viewer:  1,
};

/**
 * Require one of the listed roles (exact match).
 * Usage: router.post('/sites/:id/status', authenticate, requireRole('admin','manager'), handler)
 */
const requireRole = (...allowedRoles) => (req, res, next) => {
  const userRole = req.user?.role;
  if (!userRole || !allowedRoles.includes(userRole)) {
    return res.status(403).json({
      error: `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${userRole || 'none'}`,
    });
  }
  next();
};

/**
 * Require minimum hierarchy level.
 * Usage: requireMinRole('manager') allows manager + admin
 */
const requireMinRole = (minRole) => (req, res, next) => {
  const userLevel = ROLE_HIERARCHY[req.user?.role] || 0;
  const minLevel  = ROLE_HIERARCHY[minRole] || 99;
  if (userLevel < minLevel) {
    return res.status(403).json({
      error: `Insufficient privileges. Minimum required: ${minRole}`,
    });
  }
  next();
};

/**
 * Region-scoped access: managers can only update sites in their region.
 * Admins bypass region restriction.
 */
const requireSiteRegionAccess = (siteRegion, userRegion, userRole) => {
  if (userRole === 'admin') return true;
  return siteRegion === userRegion;
};

module.exports = { requireRole, requireMinRole, requireSiteRegionAccess };
