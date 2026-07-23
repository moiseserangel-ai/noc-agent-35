import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, ListTodo, MessageSquare, Settings, LogOut, Menu, X, Activity, BookOpen, Shield, Users, ScrollText, BarChart3, DatabaseBackup, Gauge, TerminalSquare
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/devices', label: 'Equipamentos', icon: Server },
  { path: '/tasks', label: 'Tasks', icon: ListTodo },
  { path: '/chat', label: 'Chat IA', icon: MessageSquare, roles: ['admin', 'operator'] },
  { path: '/terminal', label: 'Terminal CLI', icon: TerminalSquare },
  { path: '/settings', label: 'Configurações', icon: Settings, roles: ['admin'] },
  { path: '/vpn', label: 'VPN L2TP/IPsec', icon: Shield, roles: ['admin'] },
  { path: '/docs', label: 'Documentação', icon: BookOpen },
  { path: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
  { path: '/audit', label: 'Auditoria', icon: ScrollText, roles: ['admin'] },
  { path: '/reports', label: 'Relatórios', icon: BarChart3 },
  { path: '/ai-usage', label: 'Consumo de IA', icon: Gauge, roles: ['admin'] },
  { path: '/backups', label: 'Backup e restauração', icon: DatabaseBackup, roles: ['admin'] },
  { path: '/security', label: 'Minha segurança', icon: Shield },
];

export default function Layout({ onLogout, user, branding }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const visibleItems = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(user?.role));
  const currentItem = visibleItems.find(item => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path));
  const initials = String(user?.name || user?.username || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="app-layout">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            {branding?.logo ? <img className="brand-logo-image" src={branding.logo} alt="" /> : <Activity size={22} />}
          </div>
          <div className="sidebar-brand-text">
            <h1>{branding?.name || 'NOC Agent 35'}</h1>
            <span>{branding?.subtitle || 'AI Monitoring'}</span>
          </div>
          <button className="btn-ghost" onClick={() => setSidebarOpen(false)}
            style={{ display: sidebarOpen ? 'block' : 'none', marginLeft: 'auto' }}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleItems.map(item => (
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

      <div className="content-shell">
        <header className="topbar">
          <button className="mobile-menu-btn" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="topbar-title"><span>Área atual</span><strong>{currentItem?.label || 'NOC Agent'}</strong></div>
          <div className="topbar-status"><span className="status-pulse" /> Sistema online</div>
          <div className="topbar-user" title={`${user?.name} · ${user?.role}`}><div className="user-avatar">{initials}</div><div><strong>{user?.name}</strong><span>{user?.role === 'admin' ? 'Administrador' : user?.role === 'operator' ? 'Operador NOC' : 'Visualização'}</span></div></div>
        </header>
        <main className="main-content"><div className="page-container"><Outlet /></div></main>
      </div>
    </div>
  );
}
