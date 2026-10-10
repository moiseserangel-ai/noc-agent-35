import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, ListTodo, MessageSquare, Settings, LogOut, Menu, X, Activity, BookOpen, Shield, Users, ScrollText, BarChart3, DatabaseBackup, Gauge, TerminalSquare, Library, ArchiveRestore, ClipboardCheck, ClipboardList, Radar, Network, PanelLeftClose, PanelLeftOpen, Workflow, Bell, CalendarClock, RadioTower, Building2, Boxes, KeyRound
} from 'lucide-react';
import ThemeSelector from './ThemeSelector.jsx';
import ConnectionStatus from './ConnectionStatus.jsx';

const NAV_GROUPS = [
  { label: 'Operação', paths: ['/', '/tasks', '/notifications', '/on-call', '/status-page', '/reports'] },
  { label: 'Infraestrutura', paths: ['/devices', '/cmdb', '/discovery', '/capacity', '/topology', '/flow-inspector', '/device-backups', '/vpn'] },
  { label: 'Automação e segurança', paths: ['/chat', '/runbooks', '/terminal', '/knowledge', '/changes', '/compliance', '/vulnerabilities', '/lifecycle'] },
  { label: 'Gestão', paths: ['/clients', '/tenant-contracts', '/suppliers', '/commercial-dashboard', '/commercial-contracts', '/software-licenses', '/commercial-expiries', '/commercial-costs', '/commercial-reports'] },
  { label: 'Administração', paths: ['/settings', '/users', '/on-call-scopes', '/audit', '/ai-usage', '/backups', '/docs', '/security'] },
];

const NAV_ITEMS = [
  { path: '/', label: 'Visão geral', icon: LayoutDashboard },
  { path: '/devices', label: 'Equipamentos', icon: Server },
  { path: '/cmdb', label: 'CMDB e Inventário', icon: Boxes, roles: ['admin','tenant_admin'] },
  { path: '/discovery', label: 'Descoberta de rede', icon: Radar, roles: ['admin'] },
  { path: '/capacity', label: 'Capacidade', icon: Gauge },
  { path: '/topology', label: 'Mapa de rede', icon: Network },
  { path: '/flow-inspector', label: 'Inspeção de tráfego', icon: Activity, roles: ['admin','operator'] },
  { path: '/tasks', label: 'Tarefas', icon: ListTodo },
  { path: '/notifications', label: 'Notificações', icon: Bell },
  { path: '/on-call', label: 'Plantão NOC', icon: CalendarClock, roles: ['admin'] },
  { path: '/status-page', label: 'Página de status', icon: RadioTower, roles: ['admin'] },
  { path: '/clients', label: 'Clientes', icon: Building2, roles: ['admin'] },
  { path: '/tenant-contracts', label: 'Contratos e Portais', icon: ClipboardList, roles: ['admin'] },
  { path: '/suppliers', label: 'Fornecedores', icon: Building2, roles: ['admin'] },
  { path: '/commercial-dashboard', label: 'Visão comercial', icon: LayoutDashboard, roles: ['admin'] },
  { path: '/commercial-contracts', label: 'Contratos comerciais', icon: ClipboardList, roles: ['admin'] },
  { path: '/software-licenses', label: 'Licenças e assinaturas', icon: KeyRound, roles: ['admin'] },
  { path: '/commercial-expiries', label: 'Vencimentos e renovações', icon: CalendarClock, roles: ['admin'] },
  { path: '/commercial-costs', label: 'Custos comerciais', icon: BarChart3, roles: ['admin'] },
  { path: '/commercial-reports', label: 'Relatórios comerciais', icon: ScrollText, roles: ['admin'] },
  { path: '/on-call-scopes', label: 'Escopos de Plantão', icon: Shield, roles: ['admin'] },
  { path: '/runbooks', label: 'Runbooks', icon: Workflow, roles: ['admin','operator','tenant_admin','tenant_operator'] },
  { path: '/chat', label: 'Chat IA', icon: MessageSquare, roles: ['admin','operator','tenant_admin','tenant_operator'] },
  { path: '/terminal', label: 'Terminal CLI', icon: TerminalSquare },
  { path: '/settings', label: 'Configurações', icon: Settings, roles: ['admin'] },
  { path: '/vpn', label: 'VPN L2TP/IPsec', icon: Shield, roles: ['admin'] },
  { path: '/docs', label: 'Documentação', icon: BookOpen },
  { path: '/users', label: 'Usuários', icon: Users, roles: ['admin','tenant_admin'] },
  { path: '/audit', label: 'Auditoria', icon: ScrollText, roles: ['admin'] },
  { path: '/reports', label: 'Relatórios', icon: BarChart3 },
  { path: '/ai-usage', label: 'Consumo de IA', icon: Gauge, roles: ['admin'] },
  { path: '/knowledge', label: 'Base de conhecimento', icon: Library, roles: ['admin','tenant_admin'] },
  { path: '/backups', label: 'Backup e restauração', icon: DatabaseBackup, roles: ['admin'] },
  { path: '/device-backups', label: 'Backup de equipamentos', icon: ArchiveRestore, roles: ['admin'] },
  { path: '/compliance', label: 'Compliance', icon: ClipboardCheck, roles: ['admin','tenant_admin'] },
  { path: '/vulnerabilities', label: 'Vulnerabilidades', icon: Shield, roles: ['admin','tenant_admin'] },
  { path: '/lifecycle', label: 'Ciclo de vida', icon: CalendarClock, roles: ['admin'] },
  { path: '/changes', label: 'Mudanças', icon: ClipboardList, roles: ['admin','operator','tenant_admin','tenant_operator'] },
  { path: '/security', label: 'Minha segurança', icon: Shield },
];

export default function Layout({ onLogout, user, branding, theme, onTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('noc_sidebar_collapsed') === 'true');
  const location = useLocation();
  const [menuSearch, setMenuSearch] = useState('');
  const tenantPaths=['/','/devices','/tasks','/reports','/security','/docs','/users','/vulnerabilities','/cmdb','/capacity','/topology','/compliance','/changes','/runbooks','/chat','/knowledge'];
  const visibleItems = NAV_ITEMS.filter(item => (!user?.tenantId||tenantPaths.includes(item.path))&&(!item.roles || item.roles.includes(user?.role)));
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const groups = NAV_GROUPS.map(group => ({ ...group, items: group.paths.map(path => visibleItems.find(item => item.path === path)).filter(item => item && normalize(item.label).includes(normalize(menuSearch))) })).filter(group => group.items.length);
  const currentItem = visibleItems.find(item => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path));
  const initials = String(user?.name || user?.username || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [location.pathname]);

  const toggleSidebar = () => {
    setMenuSearch('');
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
          <button className="btn-ghost" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)}
            style={{ display: sidebarOpen ? 'block' : 'none', marginLeft: 'auto' }}>
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-search"><input type="search" aria-label="Buscar no menu" placeholder="Buscar módulo…" value={menuSearch} onChange={event => setMenuSearch(event.target.value)} /></div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {groups.map(group => <section className="nav-group" key={group.label} aria-label={group.label}>
          <h2 className="nav-group-title">{group.label}</h2>
          {group.items.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => { setSidebarOpen(false); setMenuSearch(''); }}
              aria-label={item.label}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon size={20} />
              <span className="sidebar-link-label">{item.label}</span>
            </NavLink>
          ))}</section>)}
          {!groups.length && <p className="nav-empty">Nenhum módulo encontrado.</p>}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user?.name}</div>
            {user?.tenantId?'Portal da empresa':user?.role === 'admin' ? 'Administrador' : user?.role === 'operator' ? 'Operador NOC' : 'Visualização'}
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
          <ConnectionStatus />
          <div className="topbar-user" title={`${user?.name} · ${user?.role}`}><div className="user-avatar">{initials}</div><div><strong>{user?.name}</strong><span>{{admin:'Administrador global',operator:'Operador NOC',viewer:'Visualização',tenant_admin:'Administrador da empresa',tenant_operator:'Operador da empresa',tenant_viewer:'Visualização da empresa'}[user?.role]||user?.role}</span></div></div>
        </header>
        <main className="main-content"><div className="page-container"><Outlet /></div></main>
      </div>
    </div>
  );
}
