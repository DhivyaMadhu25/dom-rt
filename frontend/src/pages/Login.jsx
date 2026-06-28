import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [form, setForm]   = useState({ username:'admin', password:'DomRT_Demo_2026!' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await login(form.username, form.password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight:'100vh', background:'#0f172a',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:'system-ui, sans-serif',
    }}>
      <div style={{ width:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:32, fontWeight:800, color:'#38bdf8' }}>DOM-RT</div>
          <div style={{ color:'#64748b', fontSize:14, marginTop:4 }}>
            Distributed Operational Monitor
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{
          background:'#1e293b', borderRadius:12, padding:32,
          border:'1px solid #334155',
        }}>
          <div style={{ marginBottom:16 }}>
            <label style={{ color:'#94a3b8', fontSize:13, display:'block', marginBottom:6 }}>Username</label>
            <input
              type="text" value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', color:'#f1f5f9', padding:'10px 14px', borderRadius:8, fontSize:14, boxSizing:'border-box' }}
            />
          </div>
          <div style={{ marginBottom:24 }}>
            <label style={{ color:'#94a3b8', fontSize:13, display:'block', marginBottom:6 }}>Password</label>
            <input
              type="password" value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', color:'#f1f5f9', padding:'10px 14px', borderRadius:8, fontSize:14, boxSizing:'border-box' }}
            />
          </div>

          {error && (
            <div style={{ color:'#ef4444', fontSize:13, marginBottom:16, background:'#ef444420', padding:'8px 12px', borderRadius:6 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            width:'100%', padding:'12px', background:'#38bdf8', border:'none',
            color:'#0f172a', fontWeight:700, fontSize:15, borderRadius:8, cursor:'pointer',
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <div style={{ marginTop:20, color:'#475569', fontSize:12, textAlign:'center', lineHeight:1.6 }}>
            Demo accounts:<br />
            admin / manager1 / auditor1 / viewer1<br />
            Password: DomRT_Demo_2026!
          </div>
        </form>
      </div>
    </div>
  );
}
