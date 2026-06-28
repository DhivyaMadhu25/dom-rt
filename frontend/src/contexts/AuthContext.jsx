import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { login as apiLogin, logout as apiLogout, getMe } from '../services/api';

const AuthContext  = createContext(null);
const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:4000';

export const AuthProvider = ({ children }) => {
  const [user,   setUser]   = useState(null);
  const [socket, setSocket] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('dom_rt_token');
    if (token) {
      getMe()
        .then(r => setUser(r.data))
        .catch(() => localStorage.removeItem('dom_rt_token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Connect WebSocket when user is set
  useEffect(() => {
    const token = localStorage.getItem('dom_rt_token');
    if (!user || !token) { socket?.disconnect(); setSocket(null); return; }

    const s = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    s.on('connect',    () => console.log('[WS] Connected'));
    s.on('disconnect', (r) => console.log('[WS] Disconnected:', r));
    s.on('connect_error', (e) => console.error('[WS] Error:', e.message));

    setSocket(s);
    return () => { s.disconnect(); setSocket(null); };
  }, [user]);

  const login = useCallback(async (username, password) => {
    const response = await apiLogin(username, password);
    const { token, user: userData } = response.data;
    localStorage.setItem('dom_rt_token', token);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    localStorage.removeItem('dom_rt_token');
    socket?.disconnect();
    setUser(null);
    setSocket(null);
  }, [socket]);

  return (
    <AuthContext.Provider value={{ user, socket, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
