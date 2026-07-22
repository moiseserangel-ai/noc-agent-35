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

const ToastContext = createContext();
export const useToast = () => useContext(ToastContext);

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

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {!authed ? (
            <>
              <Route path="/login" element={<Login onLogin={loggedUser => { setUser(loggedUser); setAuthed(true); }} />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route element={<Layout user={user} onLogout={async () => { try { await api.logout(); } catch {} localStorage.removeItem('noc_token'); setUser(null); setAuthed(false); }} />}>
              <Route index element={<Dashboard />} />
              <Route path="devices" element={<Devices canManage={user?.role === 'admin'} />} />
              <Route path="tasks" element={<Tasks canOperate={['admin', 'operator'].includes(user?.role)} />} />
              <Route path="chat" element={['admin', 'operator'].includes(user?.role) ? <Chat /> : <Navigate to="/" replace />} />
              <Route path="settings" element={user?.role === 'admin' ? <Settings /> : <Navigate to="/" replace />} />
              <Route path="vpn" element={user?.role === 'admin' ? <Vpn /> : <Navigate to="/" replace />} />
              <Route path="users" element={user?.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
              <Route path="audit" element={user?.role === 'admin' ? <Audit /> : <Navigate to="/" replace />} />
              <Route path="reports" element={<Reports />} />
              <Route path="docs" element={<Docs />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
