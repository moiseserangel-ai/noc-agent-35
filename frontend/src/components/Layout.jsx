import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, ListTodo, MessageSquare, Settings, LogOut, Menu, X, Activity, BookOpen, Shield, Users
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/devices', label: 'Equipamentos', icon: Server },
  { path: '/tasks', label: 'Tasks', icon: ListTodo },
  { path: '/chat', label: 'Chat IA', icon: MessageSquare, roles: ['admin', 'operator'] },
  { path: '/settings', label: 'Configurações', icon: Settings, roles: ['admin'] },
  { path: '/vpn', label: 'VPN L2TP/IPsec', icon: Shield, roles: ['admin'] },
  { path: '/docs', label: 'Documentação', icon: BookOpen },
  { path: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
];

export default function Layout({ onLogout, user }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="app-layout">
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
        <Menu size={20} />
      </button>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <Activity size={22} />
          </div>
          <div className="sidebar-brand-text">
            <h1>NOC Agent 35</h1>
            <span>AI Monitoring</span>
          </div>
          <button className="btn-ghost" onClick={() => setSidebarOpen(false)}
            style={{ display: sidebarOpen ? 'block' : 'none', marginLeft: 'auto' }}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(item => !item.roles || item.roles.includes(user?.role)).map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user?.name}</div>
            {user?.role === 'admin' ? 'Administrador' : user?.role === 'operator' ? 'Operador NOC' : 'Visualização'}
          </div>
          <button className="sidebar-link" onClick={onLogout} style={{ color: 'var(--danger)' }}>
            <LogOut size={20} />
            Sair
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
