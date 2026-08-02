import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, ListTodo, MessageSquare, Settings, LogOut, Menu, X, Activity, BookOpen, Shield, Users, ScrollText, BarChart3, DatabaseBackup, Gauge, TerminalSquare, Library, ArchiveRestore, ClipboardCheck, ClipboardList, Radar, Network, PanelLeftClose, PanelLeftOpen, Workflow, Bell, CalendarClock, RadioTower, Building2, Boxes
} from 'lucide-react';
import ThemeSelector from './ThemeSelector.jsx';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/devices', label: 'Equipamentos', icon: Server },
  { path: '/cmdb', label: 'CMDB e Inventário', icon: Boxes, roles: ['admin'] },
  { path: '/discovery', label: 'Descoberta de rede', icon: Radar, roles: ['admin'] },
  { path: '/capacity', label: 'Capacidade', icon: Gauge },
  { path: '/topology', label: 'Mapa de rede', icon: Network },
  { path: '/tasks', label: 'Tasks', icon: ListTodo },
  { path: '/notifications', label: 'Notificações', icon: Bell },
  { path: '/on-call', label: 'Plantão NOC', icon: CalendarClock, roles: ['admin'] },
  { path: '/status-page', label: 'Status Page', icon: RadioTower, roles: ['admin'] },
  { path: '/clients', label: 'Clientes', icon: Building2, roles: ['admin'] },
  { path: '/tenant-contracts', label: 'Contratos e Portais', icon: ClipboardList, roles: ['admin'] },
  { path: '/on-call-scopes', label: 'Escopos de Plantão', icon: Shield, roles: ['admin'] },
  { path: '/runbooks', label: 'Runbooks', icon: Workflow, roles: ['admin', 'operator'] },
  { path: '/chat', label: 'Chat IA', icon: MessageSquare, roles: ['admin', 'operator'] },
  { path: '/terminal', label: 'Terminal CLI', icon: TerminalSquare },
  { path: '/settings', label: 'Configurações', icon: Settings, roles: ['admin'] },
  { path: '/vpn', label: 'VPN L2TP/IPsec', icon: Shield, roles: ['admin'] },
  { path: '/docs', label: 'Documentação', icon: BookOpen },
  { path: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
  { path: '/audit', label: 'Auditoria', icon: ScrollText, roles: ['admin'] },
  { path: '/reports', label: 'Relatórios', icon: BarChart3 },
  { path: '/ai-usage', label: 'Consumo de IA', icon: Gauge, roles: ['admin'] },
  { path: '/knowledge', label: 'Base de conhecimento', icon: Library, roles: ['admin'] },
  { path: '/backups', label: 'Backup e restauração', icon: DatabaseBackup, roles: ['admin'] },
  { path: '/device-backups', label: 'Backup de equipamentos', icon: ArchiveRestore, roles: ['admin'] },
  { path: '/compliance', label: 'Compliance', icon: ClipboardCheck, roles: ['admin'] },
  { path: '/vulnerabilities', label: 'Vulnerabilidades', icon: Shield, roles: ['admin'] },
  { path: '/changes', label: 'Mudanças', icon: ClipboardList, roles: ['admin','operator'] },
  { path: '/security', label: 'Minha segurança', icon: Shield },
];

export default function Layout({ onLogout, user, branding, theme, onTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('noc_sidebar_collapsed') === 'true');
  const location = useLocation();
  const tenantPaths=['/','/devices','/tasks','/reports','/security','/docs'];
  const visibleItems = NAV_ITEMS.filter(item => (!user?.tenantId||tenantPaths.includes(item.path))&&(!item.roles || item.roles.includes(user?.role)));
  const currentItem = visibleItems.find(item => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path));
  const initials = String(user?.name || user?.username || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location.pathname]);

  const toggleSidebar = () => {
    setSidebarCollapsed(value => {
      const next = !value;
      localStorage.setItem('noc_sidebar_collapsed', String(next));
      return next;
    });
  };

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
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
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon size={20} />
              <span className="sidebar-link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user?.name}</div>
            {user?.tenantId?'Portal do cliente':user?.role === 'admin' ? 'Administrador' : user?.role === 'operator' ? 'Operador NOC' : 'Visualização'}
          </div>
          <button className="sidebar-link" onClick={onLogout} style={{ color: 'var(--danger)' }} title={sidebarCollapsed ? 'Sair' : undefined}>
            <LogOut size={20} />
            <span className="sidebar-link-label">Sair</span>
          </button>
        </div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <button className="mobile-menu-btn" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <button className="desktop-sidebar-toggle" aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} title={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}
          </button>
          <div className="topbar-title"><span>Área atual</span><strong>{currentItem?.label || 'NOC Agent'}</strong></div>
          <ThemeSelector value={theme} onChange={onTheme}/>
          <div className="topbar-status"><span className="status-pulse" /> Sistema online</div>
          <div className="topbar-user" title={`${user?.name} · ${user?.role}`}><div className="user-avatar">{initials}</div><div><strong>{user?.name}</strong><span>{user?.role === 'admin' ? 'Administrador' : user?.role === 'operator' ? 'Operador NOC' : 'Visualização'}</span></div></div>
        </header>
        <main className="main-content"><div className="page-container"><Outlet /></div></main>
      </div>
    </div>
  );
}
