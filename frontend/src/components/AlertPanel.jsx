import React, { useState } from 'react';
import { reviewAlert } from '../services/api';

const SEVERITY_COLORS = { low:'#22c55e', medium:'#f59e0b', high:'#f97316', critical:'#ef4444' };
const METHOD_LABELS   = { rule_based:'Rule', statistical:'Stat', isolation_forest:'AI·IF', hybrid:'Hybrid' };

export default function AlertPanel({ alerts, onReviewed }) {
  const [reviewingId, setReviewingId] = useState(null);
  const [notes,       setNotes]       = useState('');

  const handleReview = async (alertId, action) => {
    try {
      await reviewAlert(alertId, action, notes);
      setReviewingId(null);
      setNotes('');
      onReviewed?.();
    } catch (err) {
      alert('Review failed: ' + (err.response?.data?.error || err.message));
    }
  };

  if (alerts.length === 0) {
    return (
      <div style={{ color:'#22c55e', padding:40, textAlign:'center', fontSize:16 }}>
        ✓ No open alerts
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ color:'#94a3b8', fontSize:13, marginBottom:4 }}>
        {alerts.length} open alert{alerts.length > 1 ? 's' : ''}
      </div>
      {alerts.map(alert => (
        <div key={alert.id} style={{
          background:'#1e293b', borderRadius:10, padding:'16px 20px',
          borderLeft:`4px solid ${SEVERITY_COLORS[alert.severity] || '#64748b'}`,
        }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:4 }}>
                <span style={{ color:'#f1f5f9', fontWeight:700, fontSize:14 }}>
                  {alert.alert_type?.replace(/_/g, ' ').toUpperCase()}
                </span>
                <span style={{
                  background:`${SEVERITY_COLORS[alert.severity]}22`,
                  color: SEVERITY_COLORS[alert.severity],
                  padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:700,
                }}>
                  {alert.severity}
                </span>
                <span style={{
                  background:'#0f172a', color:'#38bdf8',
                  padding:'2px 8px', borderRadius:10, fontSize:11,
                }}>
                  {METHOD_LABELS[alert.detection_method] || alert.detection_method}
                </span>
              </div>
              <div style={{ color:'#94a3b8', fontSize:13 }}>{alert.site_name} · {alert.region}</div>
              <div style={{ color:'#64748b', fontSize:13, marginTop:4 }}>{alert.message}</div>

              {alert.anomaly_score && (
                <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ color:'#475569', fontSize:12 }}>AI Score:</span>
                  <div style={{ width:100, height:6, background:'#0f172a', borderRadius:3 }}>
                    <div style={{
                      width:`${(alert.anomaly_score * 100).toFixed(0)}%`,
                      height:'100%',
                      background: alert.anomaly_score > 0.8 ? '#ef4444' : alert.anomaly_score > 0.6 ? '#f59e0b' : '#22c55e',
                      borderRadius:3,
                    }} />
                  </div>
                  <span style={{ color:'#94a3b8', fontSize:12 }}>{(alert.anomaly_score * 100).toFixed(0)}%</span>
                </div>
              )}

              {alert.contributing_features && Object.keys(alert.contributing_features).length > 0 && (
                <div style={{ marginTop:8, color:'#475569', fontSize:12 }}>
                  Features: {Object.entries(alert.contributing_features)
                    .map(([k, v]) => `${k.replace(/_/g,' ')}: ${v}`)
                    .join(' · ')}
                </div>
              )}
            </div>

            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              {reviewingId === alert.id ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6, minWidth:200 }}>
                  <textarea
                    placeholder="Review notes (optional)"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    style={{
                      background:'#0f172a', border:'1px solid #334155', color:'#f1f5f9',
                      borderRadius:6, padding:8, fontSize:12, resize:'vertical', minHeight:60,
                    }}
                  />
                  <div style={{ display:'flex', gap:4 }}>
                    {['acknowledged','resolved','dismissed'].map(action => (
                      <button key={action} onClick={() => handleReview(alert.id, action)} style={{
                        padding:'4px 10px', fontSize:11, cursor:'pointer', borderRadius:6, border:'none',
                        background: action === 'resolved' ? '#22c55e' : action === 'dismissed' ? '#64748b' : '#38bdf8',
                        color:'#fff', fontWeight:600,
                      }}>
                        {action}
                      </button>
                    ))}
                    <button onClick={() => { setReviewingId(null); setNotes(''); }} style={{
                      padding:'4px 10px', fontSize:11, cursor:'pointer', borderRadius:6,
                      border:'1px solid #334155', background:'transparent', color:'#64748b',
                    }}>
                      cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setReviewingId(alert.id)} style={{
                  padding:'6px 14px', fontSize:12, cursor:'pointer', borderRadius:6, border:'none',
                  background:'#334155', color:'#94a3b8', fontWeight:600,
                }}>
                  Review
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop:8, color:'#475569', fontSize:11 }}>
            {new Date(alert.created_at).toLocaleString()} · corr: {alert.correlation_id?.slice(0, 8)} · model: {alert.model_version}
          </div>
        </div>
      ))}
    </div>
  );
}
