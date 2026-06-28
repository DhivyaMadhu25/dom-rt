import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSites, getAlerts, getAlertStats, getMetrics, updateSiteStatus } from '../services/api';
import AlertPanel   from './AlertPanel';
import AuditLog     from './AuditLog';
import MetricsBar   from './MetricsBar';

const STATUS_COLORS = {
  open:      '#22c55e',
  closed:    '#64748b',
  inactive:  '#94a3b8',
  delayed:   '#f59e0b',
  degraded:  '#f97316',
  failed:    '#ef4444',
};

const SiteCard = ({ site, onStatusChange, canEdit }) => {
  const [updating, setUpdating] = useState(false);
  const [flash,    setFlash]    = useState(false);

  useEffect(() => {
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1000);
    return () => clearTimeout(t);
  }, [site.status]);

  const handleStatusChange = async (e) => {
    setUpdating(true);
    try { await onStatusChange(site.id, e.target.value); }
    finally { setUpdating(false); }
  };

  return (
    <div style={{
      background:   '#1e293b',
      border:       `2px solid ${STATUS_COLORS[site.status] || '#334155'}`,
      borderRadius: 12,
      padding:      '16px 20px',
      transition:   'border-color 0.4s, box-shadow 0.4s',
      boxShadow:    flash ? `0 0 16px ${STATUS_COLORS[site.status]}55` : 'none',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ color:'#f1f5f9', fontWeight:700, fontSize:15 }}>{site.name}</div>
          <div style={{ color:'#64748b', fontSize:12, marginTop:2 }}>
            {site.domain_type} · {site.region}
          </div>
        </div>
        <span style={{
          background: `${STATUS_COLORS[site.status]}22`,
          color:      STATUS_COLORS[site.status],
          padding:    '3px 10px',
          borderRadius: 20,
          fontSize:   11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {site.status}
        </span>
      </div>

      {site.open_alert_count > 0 && (
        <div style={{ marginTop:8, color:'#f59e0b', fontSize:12 }}>
          ⚠ {site.open_alert_count} open alert{site.open_alert_count > 1 ? 's' : ''}
        </div>
      )}

      {canEdit && (
        <select
          disabled={updating}
          value={site.status}
          onChange={handleStatusChange}
          style={{
            marginTop: 12, width:'100%', padding:'6px 10px',
            background:'#0f172a', color:'#94a3b8', border:'1px solid #334155',
            borderRadius: 6, fontSize:13, cursor:'pointer',
          }}
        >
          {['inactive','open','closed','delayed','degraded','failed'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  );
};

export default function Dashboard() {
  const { user, socket, logout } = useAuth();
  const [sites,       setSites]       = useState([]);
  const [alerts,      setAlerts]      = useState([]);
  const [alertStats,  setAlertStats]  = useState(null);
  const [metrics,     setMetrics]     = useState(null);
  const [activeTab,   setActiveTab]   = useState('sites');
  const [statusFilter, setStatusFilter] = useState('all');
  const [wsEvents,    setWsEvents]    = useState([]);
  const [loading,     setLoading]     = useState(true);

  const canEdit = ['admin', 'manager'].includes(user?.role);
  const canAudit = ['admin', 'auditor'].includes(user?.role);

  const loadAll = useCallback(async () => {
    try {
      const [sitesRes, alertsRes, statsRes] = await Promise.all([
        getSites(),
        getAlerts({ status: 'open', limit: 50 }),
        getAlertStats(),
      ]);
      setSites(sitesRes.data);
      setAlerts(alertsRes.data);
      setAlertStats(statsRes.data);
    } catch (err) {
      console.error('Load error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try { const m = await getMetrics(); setMetrics(m); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadAll();
    loadMetrics();
    const interval = setInterval(loadMetrics, 15000);
    return () => clearInterval(interval);
  }, [loadAll, loadMetrics]);

  // Real-time WebSocket event handlers
  useEffect(() => {
    if (!socket) return;

    const handleSiteUpdate = (data) => {
      setSites(prev => prev.map(s =>
        s.id === data.siteId ? { ...s, status: data.status } : s
      ));
      setWsEvents(prev => [{ ...data, _ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]);
    };

    const handleAlertCreated = (data) => {
      setAlerts(prev => [data, ...prev]);
      setWsEvents(prev => [{ ...data, _type: 'ALERT', _ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]);
    };

    const handleAlertReviewed = (data) => {
      setAlerts(prev => prev.filter(a => a.id !== data.alertId));
    };

    socket.on('site:status_updated', handleSiteUpdate);
    socket.on('alert:created',       handleAlertCreated);
    socket.on('alert:reviewed',      handleAlertReviewed);
    socket.on('activity:recorded',   (d) => setWsEvents(prev => [{ ...d, _type: 'ACTIVITY', _ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]));

    return () => {
      socket.off('site:status_updated', handleSiteUpdate);
      socket.off('alert:created',       handleAlertCreated);
      socket.off('alert:reviewed',      handleAlertReviewed);
      socket.off('activity:recorded');
    };
  }, [socket]);

  const handleStatusChange = async (siteId, status) => {
    try { await updateSiteStatus(siteId, status); }
    catch (err) { alert('Update failed: ' + err.response?.data?.error || err.message); }
  };

  const filteredSites = statusFilter === 'all'
    ? sites
    : sites.filter(s => s.status === statusFilter);

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#f1f5f9', fontFamily:'system-ui, sans-serif' }}>
      {/* Top Nav */}
      <nav style={{ background:'#1e293b', borderBottom:'1px solid #334155', padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:56 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ fontWeight:800, fontSize:18, color:'#38bdf8' }}>DOM-RT</span>
          <span style={{ color:'#475569', fontSize:13 }}>Distributed Operational Monitor</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ color:'#94a3b8', fontSize:13 }}>
            {user?.username} <span style={{ color:'#38bdf8' }}>({user?.role})</span>
          </span>
          <div style={{ width:8, height:8, borderRadius:'50%', background: socket?.connected ? '#22c55e' : '#ef4444' }}
               title={socket?.connected ? 'WebSocket connected' : 'WebSocket disconnected'} />
          <button onClick={logout} style={{ background:'#334155', border:'none', color:'#94a3b8', padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:13 }}>
            Logout
          </button>
        </div>
      </nav>

      {/* Metrics Bar */}
      {metrics && <MetricsBar metrics={metrics} alertStats={alertStats} />}

      {/* Tabs */}
      <div style={{ borderBottom:'1px solid #334155', padding:'0 24px', display:'flex', gap:4, background:'#1e293b' }}>
        {['sites', 'alerts', ...(canAudit ? ['audit'] : []), 'live_events'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding:'10px 18px', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            background:'transparent',
            color: activeTab === tab ? '#38bdf8' : '#64748b',
            borderBottom: activeTab === tab ? '2px solid #38bdf8' : '2px solid transparent',
          }}>
            {tab === 'live_events' ? '⚡ Live Events' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'alerts' && alerts.length > 0 && (
              <span style={{ marginLeft:6, background:'#ef4444', color:'#fff', borderRadius:10, padding:'1px 7px', fontSize:11 }}>
                {alerts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding:24 }}>
        {/* SITES TAB */}
        {activeTab === 'sites' && (
          <>
            {/* Status filter */}
            <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
              {['all','open','closed','inactive','delayed','degraded','failed'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  padding:'5px 14px', borderRadius:20, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:600,
                  background: statusFilter === s ? (STATUS_COLORS[s] || '#38bdf8') : '#1e293b',
                  color: statusFilter === s ? '#fff' : '#64748b',
                }}>
                  {s === 'all' ? `All (${sites.length})` : `${s} (${sites.filter(x => x.status === s).length})`}
                </button>
              ))}
            </div>
            {loading ? (
              <div style={{ color:'#64748b', textAlign:'center', padding:40 }}>Loading sites...</div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
                {filteredSites.map(site => (
                  <SiteCard key={site.id} site={site} canEdit={canEdit} onStatusChange={handleStatusChange} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ALERTS TAB */}
        {activeTab === 'alerts' && (
          <AlertPanel alerts={alerts} onReviewed={loadAll} />
        )}

        {/* AUDIT TAB */}
        {activeTab === 'audit' && canAudit && (
          <AuditLog />
        )}

        {/* LIVE EVENTS TAB */}
        {activeTab === 'live_events' && (
          <div>
            <h3 style={{ color:'#94a3b8', fontSize:14, marginBottom:12, fontWeight:600 }}>
              Real-Time WebSocket Events (last 20)
            </h3>
            {wsEvents.length === 0 ? (
              <div style={{ color:'#475569', padding:20 }}>No events received yet. Make a status change to see live updates.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {wsEvents.map((ev, i) => (
                  <div key={i} style={{
                    background:'#1e293b', borderRadius:8, padding:'10px 16px',
                    display:'flex', gap:16, alignItems:'center',
                    borderLeft:`3px solid ${ev._type === 'ALERT' ? '#ef4444' : '#22c55e'}`,
                  }}>
                    <span style={{ color:'#475569', fontSize:12, minWidth:80 }}>{ev._ts}</span>
                    <span style={{ color:'#38bdf8', fontSize:12, minWidth:130 }}>{ev._event || ev._type}</span>
                    <span style={{ color:'#94a3b8', fontSize:12 }}>
                      {ev.siteName || ev.site_name} {ev.status ? `→ ${ev.status}` : ''} {ev.alert_type || ''}
                    </span>
                    <span style={{ color:'#475569', fontSize:11, marginLeft:'auto' }}>
                      corr: {(ev.correlationId || ev.correlation_id || '').slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
