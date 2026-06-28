import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({ baseURL: `${API_URL}/api` });

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dom_rt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('dom_rt_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ────────────────────────────────────────────────
export const login  = (username, password) => api.post('/auth/login', { username, password });
export const getMe  = ()                   => api.get('/auth/me');
export const logout = ()                   => api.post('/auth/logout');

// ── Sites ───────────────────────────────────────────────
export const getSites         = (params)        => api.get('/sites', { params });
export const getSite          = (id)            => api.get(`/sites/${id}`);
export const createSite       = (data)          => api.post('/sites', data);
export const updateSiteStatus = (id, status, notes) =>
  api.patch(`/sites/${id}/status`, { status, notes });
export const getSiteSummary   = (id)            => api.get(`/sites/${id}/summary`);
export const getRegionalSummary = ()            => api.get('/sites/summary/regional');

// ── Activity ─────────────────────────────────────────────
export const recordActivity = (data)   => api.post('/activity', data);
export const getActivity    = (params) => api.get('/activity', { params });

// ── Audit ───────────────────────────────────────────────
export const getAuditLogs          = (params)        => api.get('/audit', { params });
export const reconstructEventChain = (correlationId) => api.get(`/audit/reconstruct/${correlationId}`);
export const getAuditCompleteness  = ()              => api.get('/audit/completeness');

// ── Alerts ──────────────────────────────────────────────
export const getAlerts    = (params)       => api.get('/alerts', { params });
export const reviewAlert  = (id, action, notes) => api.patch(`/alerts/${id}/review`, { action, notes });
export const getAlertStats = ()            => api.get('/alerts/stats');

// ── Metrics ─────────────────────────────────────────────
export const getMetrics = () => axios.get(`${API_URL}/metrics`).then(r => r.data);

export default api;
