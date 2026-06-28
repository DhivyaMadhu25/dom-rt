import React, { useState, useEffect } from 'react';
import { getAuditLogs, reconstructEventChain, getAuditCompleteness } from '../services/api';

export default function AuditLog() {
  const [logs,         setLogs]         = useState([]);
  const [completeness, setCompleteness] = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [chain,        setChain]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [filters,      setFilters]      = useState({ action_type:'', limit:100 });

  useEffect(() => {
    Promise.all([
      getAuditLogs(filters).then(r => setLogs(r.data)),
      getAuditCompleteness().then(r => setCompleteness(r.data)),
    ]).finally(() => setLoading(false));
  }, [filters]);

  const loadChain = async (correlationId) => {
    if (selected === correlationId) { setSelected(null); setChain(null); return; }
    try {
      const res = await reconstructEventChain(correlationId);
      setChain(res.data);
      setSelected(correlationId);
    } catch { /* ignore */ }
  };

  return (
    <div>
      {/* Completeness metrics */}
      {completeness && (
        <div style={{ display:'flex', gap:20, marginBottom:20, flexWrap:'wrap' }}>
          {[
            { label:'Total Records',          value: completeness.total_records },
            { label:'User ID Coverage',       value: `${completeness.user_completeness_pct}%` },
            { label:'Correlation Coverage',   value: `${completeness.correlation_completeness_pct}%` },
          ].map(m => (
            <div key={m.label} style={{ background:'#1e293b', borderRadius:8, padding:'12px 20px', minWidth:160 }}>
              <div style={{ color:'#64748b', fontSize:12 }}>{m.label}</div>
              <div style={{ color:'#38bdf8', fontSize:22, fontWeight:700, marginTop:4 }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16 }}>
        <input
          placeholder="Filter by action type"
          value={filters.action_type}
          onChange={e => setFilters(f => ({ ...f, action_type: e.target.value }))}
          style={{ background:'#1e293b', border:'1px solid #334155', color:'#f1f5f9', padding:'6px 12px', borderRadius:6, fontSize:13 }}
        />
        <select
          value={filters.limit}
          onChange={e => setFilters(f => ({ ...f, limit: e.target.value }))}
          style={{ background:'#1e293b', border:'1px solid #334155', color:'#94a3b8', padding:'6px 12px', borderRadius:6, fontSize:13 }}
        >
          {[50,100,200,500].map(n => <option key={n} value={n}>Last {n}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color:'#64748b', padding:20 }}>Loading audit logs...</div>
      ) : (
        <div style={{ fontFamily:'monospace' }}>
          <div style={{ display:'grid', gridTemplateColumns:'160px 120px 160px 140px 1fr', gap:8, padding:'6px 12px', color:'#475569', fontSize:11, fontWeight:700 }}>
            <span>TIMESTAMP</span><span>USER</span><span>ACTION</span><span>ENTITY</span><span>CORR ID</span>
          </div>
          {logs.map(log => (
            <React.Fragment key={log.id}>
              <div
                onClick={() => loadChain(log.correlation_id)}
                style={{
                  display:'grid', gridTemplateColumns:'160px 120px 160px 140px 1fr',
                  gap:8, padding:'8px 12px', borderRadius:6, cursor:'pointer',
                  background: selected === log.correlation_id ? '#1e3a5f' : 'transparent',
                  borderBottom:'1px solid #1e293b',
                  ':hover': { background:'#1e293b' },
                }}
              >
                <span style={{ color:'#64748b', fontSize:12 }}>{new Date(log.created_at).toLocaleString()}</span>
                <span style={{ color:'#38bdf8', fontSize:12 }}>{log.actor_username || '—'}</span>
                <span style={{ color:'#94a3b8', fontSize:12 }}>{log.action_type}</span>
                <span style={{ color:'#64748b', fontSize:12 }}>{log.entity_type} {log.site_name ? `· ${log.site_name}` : ''}</span>
                <span style={{ color:'#475569', fontSize:12 }}>{log.correlation_id?.slice(0, 16)}…</span>
              </div>

              {/* Correlation chain expansion */}
              {selected === log.correlation_id && chain && (
                <div style={{ background:'#1e293b', borderRadius:8, margin:'4px 0 8px', padding:16 }}>
                  <div style={{ color:'#38bdf8', fontWeight:700, fontSize:13, marginBottom:12 }}>
                    Event Chain — corr: {log.correlation_id.slice(0, 16)}…
                  </div>
                  <div style={{ display:'flex', gap:24 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#64748b', fontSize:11, fontWeight:700, marginBottom:6 }}>AUDIT RECORDS ({chain.audit_chain.length})</div>
                      {chain.audit_chain.map((a, i) => (
                        <div key={i} style={{ color:'#94a3b8', fontSize:12, padding:'4px 0', borderBottom:'1px solid #334155' }}>
                          {new Date(a.created_at).toLocaleTimeString()} · <span style={{ color:'#f1f5f9' }}>{a.action_type}</span> by {a.username}
                        </div>
                      ))}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ color:'#64748b', fontSize:11, fontWeight:700, marginBottom:6 }}>OPERATIONAL EVENTS ({chain.operational_events.length})</div>
                      {chain.operational_events.map((e, i) => (
                        <div key={i} style={{ color:'#94a3b8', fontSize:12, padding:'4px 0', borderBottom:'1px solid #334155' }}>
                          {new Date(e.recorded_at).toLocaleTimeString()} · <span style={{ color:'#f1f5f9' }}>{e.event_type}</span>
                          {e.previous_value && e.new_value && (
                            <span style={{ color:'#64748b' }}> {e.previous_value} → {e.new_value}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
