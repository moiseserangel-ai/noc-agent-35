import { useState } from 'react';
import { Activity, Lock, User } from 'lucide-react';
import { api } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token, user } = await api.login(username, password);
      localStorage.setItem('noc_token', token);
      onLogin(user);
    } catch (err) {
      setError('Senha incorreta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
          <div className="sidebar-brand-icon" style={{ width: 56, height: 56 }}>
            <Activity size={28} />
          </div>
        </div>
        <h1>NOC Agent 35</h1>
        <p>Sistema de Monitoramento NOC com IA</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-input" style={{ paddingLeft: 40 }} placeholder="Usuário" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" />
            </div>
          </div>
          <div className="form-group">
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="password"
                className="form-input"
                style={{ paddingLeft: 40 }}
                placeholder="Senha do dashboard"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: '16px' }}>{error}</div>
          )}

          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
            {loading ? <><div className="spinner" /> Entrando...</> : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
