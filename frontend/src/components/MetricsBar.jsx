import React from 'react';

export default function MetricsBar({ metrics, alertStats }) {
  const items = [
    { label:'Active Sites',      value: metrics?.active_sites,        color:'#38bdf8' },
    { label:'Events / hr',       value: metrics?.events_last_hour,    color:'#22c55e' },
    { label:'Open Alerts',       value: metrics?.open_alerts,         color: metrics?.open_alerts > 0 ? '#f59e0b' : '#22c55e' },
    { label:'WS Clients',        value: metrics?.websocket_clients,   color:'#a78bfa' },
    { label:'AI Alerts (24h)',   value: alertStats?.ai_generated,     color:'#38bdf8' },
    { label:'Critical',          value: alertStats?.critical,         color: alertStats?.critical > 0 ? '#ef4444' : '#64748b' },
  ];

  return (
    <div style={{
      background:'#0f172a', borderBottom:'1px solid #1e293b',
      padding:'0 24px', display:'flex', gap:0, overflowX:'auto',
    }}>
      {items.map((item, i) => (
        <div key={i} style={{
          padding:'10px 20px', borderRight:'1px solid #1e293b',
          display:'flex', flexDirection:'column', minWidth:110,
        }}>
          <span style={{ color:'#475569', fontSize:11, fontWeight:600, letterSpacing:0.3 }}>
            {item.label}
          </span>
          <span style={{ color: item.color, fontSize:22, fontWeight:700, marginTop:2 }}>
            {item.value ?? '—'}
          </span>
        </div>
      ))}
      <div style={{ padding:'10px 20px', marginLeft:'auto', display:'flex', alignItems:'center' }}>
        <span style={{ color:'#334155', fontSize:11 }}>
          Updated {metrics ? new Date(metrics.timestamp).toLocaleTimeString() : '—'}
        </span>
      </div>
    </div>
  );
}
