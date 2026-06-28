const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;

/**
 * Initialize Socket.IO on the HTTP server.
 * Clients authenticate via JWT in handshake auth.
 */
const initWebSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
    pingTimeout:  10000,
    pingInterval: 25000,
  });

  // JWT authentication on WebSocket handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dom-rt-dev-secret');
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Connected: ${socket.user.username} (${socket.id})`);

    // Join role and region rooms for targeted broadcasts
    socket.join(`role:${socket.user.role}`);
    if (socket.user.region) socket.join(`region:${socket.user.region}`);
    socket.join('all');

    socket.on('subscribe:site', (siteId) => {
      socket.join(`site:${siteId}`);
    });

    socket.on('unsubscribe:site', (siteId) => {
      socket.leave(`site:${siteId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[WS] Disconnected: ${socket.user.username} — reason: ${reason}`);
    });
  });

  console.log('[WS] Socket.IO initialized');
  return io;
};

/**
 * Emit a real-time event to all connected authorized clients.
 * Called AFTER successful database commit to prevent dashboard inconsistency.
 */
const emitEvent = (eventName, payload) => {
  if (!io) {
    console.warn('[WS] Socket.IO not initialized — skipping emit:', eventName);
    return;
  }
  const emission = {
    ...payload,
    _event:    eventName,
    _emittedAt: new Date().toISOString(),
  };
  io.to('all').emit(eventName, emission);
  console.debug(`[WS] Emitted: ${eventName}`);
};

/**
 * Emit to a specific site room (e.g. site-level subscribers).
 */
const emitToSite = (siteId, eventName, payload) => {
  if (!io) return;
  io.to(`site:${siteId}`).emit(eventName, { ...payload, _event: eventName });
};

/**
 * Emit only to a specific role room.
 */
const emitToRole = (role, eventName, payload) => {
  if (!io) return;
  io.to(`role:${role}`).emit(eventName, { ...payload, _event: eventName });
};

const getConnectedCount = () => (io ? io.engine.clientsCount : 0);

module.exports = { initWebSocket, emitEvent, emitToSite, emitToRole, getConnectedCount };
