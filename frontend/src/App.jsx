import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Devices from './pages/Devices.jsx';
import Tasks from './pages/Tasks.jsx';
import Chat from './pages/Chat.jsx';
import Settings from './pages/Settings.jsx';
import Docs from './pages/Docs.jsx';
import Vpn from './pages/Vpn.jsx';
import Users from './pages/Users.jsx';
import Audit from './pages/Audit.jsx';
import Reports from './pages/Reports.jsx';
import Backups from './pages/Backups.jsx';
import Security from './pages/Security.jsx';
import AiUsage from './pages/AiUsage.jsx';
import Knowledge from './pages/Knowledge.jsx';
import DeviceBackups from './pages/DeviceBackups.jsx';
import Compliance from './pages/Compliance.jsx';
import Changes from './pages/Changes.jsx';
import Discovery from './pages/Discovery.jsx';
import Capacity from './pages/Capacity.jsx';
import Topology from './pages/Topology.jsx';
import Runbooks from './pages/Runbooks.jsx';

const Terminal = React.lazy(() => import('./pages/Terminal.jsx'));

const ToastContext = createContext();
export const useToast = () => useContext(ToastContext);

const themePrimary = (color, light) => {
  const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!light || !match) return color || '#00d4ff';
  const rgb = [0, 2, 4].map(index => parseInt(match[1].slice(index, index + 2), 16));
  const luminance = (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) / 255;
  if (luminance < .48) return color;
  return `#${rgb.map(value => Math.round(value * .58).toString(16).padStart(2, '0')).join('')}`;
};

const applyPrimary = (color, light = document.documentElement.dataset.theme === 'light') => {
  const primary = themePrimary(color, light);
  document.documentElement.style.setProperty('--primary', primary);
  document.documentElement.style.setProperty('--primary-glow', `${primary}1c`);
  document.documentElement.style.setProperty('--primary-strong', `${primary}33`);
  document.documentElement.style.setProperty('--border-accent', `${primary}38`);
};

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [user, setUser] = useState(null);
  const [branding, setBranding] = useState({ name:'NOC Agent 35', subtitle:'AI Monitoring', loginSubtitle:'Sistema de Monitoramento NOC com IA', primaryColor:'#00d4ff', logo:null, favicon:null });
  const [theme, setTheme] = useState(() => localStorage.getItem('noc_theme') || 'dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => {
      const resolved = theme === 'auto' ? (media.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      applyPrimary(branding.primaryColor || '#00d4ff', resolved === 'light');
    };
    localStorage.setItem('noc_theme', theme);
    applyTheme();
    media.addEventListener?.('change', applyTheme);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [theme, branding.primaryColor]);

  useEffect(() => {
    const apply = next => {
      setBranding(next);
      const color = next.primaryColor || '#00d4ff';
      applyPrimary(color);
      document.title = `${next.name || 'NOC Agent 35'} - Dashboard`;
      const favicon = document.querySelector("link[rel='icon']");
      if (favicon) favicon.href = next.favicon || '/favicon.svg';
    };
    api.getBranding().then(result => apply(result.data)).catch(() => {});
    const changed = event => apply(event.detail);
    window.addEventListener('noc:branding-updated', changed);
    return () => window.removeEventListener('noc:branding-updated', changed);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('noc_token');
    if (!token) { setAuthed(false); return; }
    api.verify().then(result => { setUser(result.user); setAuthed(true); }).catch(() => {
      localStorage.removeItem('noc_token');
      setAuthed(false);
    });
  }, []);

  useEffect(() => {
    if (!authed) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || !localStorage.getItem('noc_token')) return;
      refreshing = true;
      try {
        const result = await api.refreshSession();
        if (result.token) {
          localStorage.setItem('noc_token', result.token);
          if (result.user) setUser(result.user);
          window.dispatchEvent(new Event('noc:token-refreshed'));
        }
      } catch {
        localStorage.removeItem('noc_token');
        setAuthed(false);
      } finally { refreshing = false; }
    };
    const interval = setInterval(refresh, 30 * 60 * 1000);
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', refresh);
    };
  }, [authed]);

  if (authed === null) {
    return <div className="loading-screen"><div className="spinner" /> Carregando...</div>;
  }

  if (authed && user?.mustChangePassword) {
    return <ToastProvider><BrowserRouter><Routes><Route path="*" element={<Security forcePasswordChange user={user} onUser={setUser} />} /></Routes></BrowserRouter></ToastProvider>;
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {!authed ? (
            <>
              <Route path="/login" element={<Login branding={branding} theme={theme} onTheme={setTheme} onLogin={loggedUser => { setUser(loggedUser); setAuthed(true); }} />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route element={<Layout branding={branding} user={user} theme={theme} onTheme={setTheme} onLogout={async () => { try { await api.logout(); } catch {} localStorage.removeItem('noc_token'); setUser(null); setAuthed(false); }} />}>
              <Route index element={<Dashboard showBackup={user?.role === 'admin'} />} />
              <Route path="devices" element={<Devices canManage={user?.role === 'admin'} />} />
              <Route path="tasks" element={<Tasks canOperate={['admin', 'operator'].includes(user?.role)} isAdmin={user?.role === 'admin'} />} />
              <Route path="chat" element={['admin', 'operator'].includes(user?.role) ? <Chat /> : <Navigate to="/" replace />} />
              <Route path="terminal" element={<React.Suspense fallback={<div className="loading-screen"><div className="spinner" /> Carregando terminal...</div>}><Terminal user={user} /></React.Suspense>} />
              <Route path="settings" element={user?.role === 'admin' ? <Settings /> : <Navigate to="/" replace />} />
              <Route path="vpn" element={user?.role === 'admin' ? <Vpn /> : <Navigate to="/" replace />} />
              <Route path="users" element={user?.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
              <Route path="audit" element={user?.role === 'admin' ? <Audit /> : <Navigate to="/" replace />} />
              <Route path="reports" element={<Reports />} />
              <Route path="ai-usage" element={user?.role === 'admin' ? <AiUsage /> : <Navigate to="/" replace />} />
              <Route path="knowledge" element={user?.role === 'admin' ? <Knowledge /> : <Navigate to="/" replace />} />
              <Route path="backups" element={user?.role === 'admin' ? <Backups /> : <Navigate to="/" replace />} />
              <Route path="device-backups" element={user?.role === 'admin' ? <DeviceBackups /> : <Navigate to="/" replace />} />
              <Route path="compliance" element={user?.role === 'admin' ? <Compliance /> : <Navigate to="/" replace />} />
              <Route path="changes" element={['admin','operator'].includes(user?.role) ? <Changes isAdmin={user?.role==='admin'} /> : <Navigate to="/" replace />} />
              <Route path="discovery" element={user?.role==='admin' ? <Discovery /> : <Navigate to="/" replace />} />
              <Route path="capacity" element={<Capacity isAdmin={user?.role==='admin'} />} />
              <Route path="topology" element={<Topology isAdmin={user?.role==='admin'} />} />
              <Route path="runbooks" element={['admin','operator'].includes(user?.role) ? <Runbooks isAdmin={user?.role==='admin'} /> : <Navigate to="/" replace />} />
              <Route path="security" element={<Security user={user} onUser={setUser} />} />
              <Route path="docs" element={<Docs />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
