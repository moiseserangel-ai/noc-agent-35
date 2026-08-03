import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArchiveRestore, BarChart3, CalendarClock, CheckCircle2, ChevronDown, Clock3, DatabaseBackup, Gauge, ListTodo, RefreshCw, Server, ShieldCheck, TerminalSquare, TrendingDown, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { PriorityBadge, StatusBadge } from '../components/StatusBadge.jsx';

const sourceLabel = source => String(source).startsWith('dashboard:') ? 'dashboard' : source;
const time = value => value ? new Date(value).toLocaleString('pt-BR') : '—';

function HealthCard({ icon:Icon, label, value, detail, tone='neutral', to }) {
  const content=<><div className={`executive-health-icon ${tone}`}><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></>;
  return to?<Link to={to} className={`executive-health-card ${tone}`}>{content}</Link>:<div className={`executive-health-card ${tone}`}>{content}</div>;
}

function Section({ id, title, subtitle, icon:Icon, collapsed, onToggle, action, children }) {
  return <section className={`dashboard-section ${collapsed?'collapsed':''}`}><header><div className="dashboard-section-heading"><div className="dashboard-section-icon"><Icon size={18}/></div><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="dashboard-section-actions">{action}<button className="btn btn-ghost btn-sm" aria-label={collapsed?'Expandir':'Recolher'} onClick={()=>onToggle(id)}><ChevronDown size={17}/></button></div></header>{!collapsed&&<div className="dashboard-section-body">{children}</div>}</section>;
}

function Empty({ children }) { return <div className="dashboard-empty"><CheckCircle2 size={22}/><span>{children}</span></div>; }

export default function Dashboard({ showBackup=false }) {
  const [stats,setStats]=useState(null);
  const [tasks,setTasks]=useState([]);
  const [backupStatus,setBackupStatus]=useState(null);
  const [compliance,setCompliance]=useState(null);
  const [lifecycle,setLifecycle]=useState(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [updatedAt,setUpdatedAt]=useState(null);
  const [collapsed,setCollapsed]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem('noc_dashboard_collapsed')||'[]'));}catch{return new Set();}});

  const load=useCallback(async(initial=false)=>{
    if(initial)setLoading(true);else setRefreshing(true);
    try{
      const [statsRes,tasksRes,backupRes,complianceRes,lifecycleRes]=await Promise.all([
        api.getTaskStats(),api.getTasks({limit:10}),
        showBackup?api.getBackupStatus().catch(()=>null):Promise.resolve(null),
        showBackup?api.getComplianceDashboard().catch(()=>null):Promise.resolve(null),
        showBackup?api.getLifecycle().catch(()=>null):Promise.resolve(null),
      ]);
      setStats(statsRes.data);setTasks(tasksRes.data);
      if(backupRes)setBackupStatus(backupRes.data);
      if(complianceRes)setCompliance(complianceRes.data);
      if(lifecycleRes)setLifecycle(lifecycleRes.data);
      setUpdatedAt(new Date());
    }catch{}finally{setLoading(false);setRefreshing(false);}
  },[showBackup]);

  useEffect(()=>{
    load(true);
    const interval=setInterval(()=>load(false),30000);
    const resume=()=>{if(document.visibilityState==='visible')load(false);};
    document.addEventListener('visibilitychange',resume);
    return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',resume);};
  },[load]);

  const toggle=id=>setCollapsed(current=>{
    const next=new Set(current);next.has(id)?next.delete(id):next.add(id);
    localStorage.setItem('noc_dashboard_collapsed',JSON.stringify([...next]));
    return next;
  });
  const openTasks=(stats?.pending||0)+(stats?.inProgress||0)+(stats?.diagnosing||0)+(stats?.awaiting||0);
  const slaBreached=stats?.slaBreached||0;
  const criticalFindings=compliance?.summary.criticalFindings||0;
  const lifecycleRisk=lifecycle?.summary.highRisk||0;
  const systemTone=slaBreached>0||criticalFindings>0||lifecycleRisk>0?'danger':openTasks>0?'warning':'success';
  const systemDetail=slaBreached>0?`${slaBreached} SLA(s) violado(s)`:criticalFindings>0?`${criticalFindings} desvio(s) crítico(s) de compliance`:lifecycleRisk>0?`${lifecycleRisk} ativo(s) com alto risco de ciclo de vida`:openTasks>0?`${openTasks} Task(s) em aberto`:'Serviço do NOC online';
  const quickLinks=useMemo(()=>[
    {to:'/tasks',label:'Tasks',icon:ListTodo,detail:'Gerenciar atividades'},
    {to:'/devices',label:'Equipamentos',icon:Server,detail:'Inventário e acesso'},
    {to:'/terminal',label:'Terminal CLI',icon:TerminalSquare,detail:'Sessões interativas'},
    ...(showBackup?[{to:'/compliance',label:'Compliance',icon:ShieldCheck,detail:'Riscos e políticas'},{to:'/device-backups',label:'Backups',icon:ArchiveRestore,detail:'Configurações salvas'}]:[]),
    {to:'/reports',label:'Relatórios',icon:BarChart3,detail:'Indicadores e SLA'},
  ],[showBackup]);

  if(loading)return <div className="loading-screen"><div className="spinner"/></div>;
  const trendMax=Math.max(...(compliance?.trend||[]).map(item=>item.score),100);

  return <div className="executive-dashboard">
    <div className="page-header dashboard-titlebar"><div><div className="dashboard-eyebrow"><span className={`dashboard-health-dot ${systemTone}`}/> Central de operações</div><h2>Dashboard executivo</h2><p>Saúde do NOC, riscos e atividades em uma única visão</p></div><div className="dashboard-refresh"><span>Atualizado em<br/><strong>{updatedAt?updatedAt.toLocaleTimeString('pt-BR'):'—'}</strong></span><button className="btn btn-secondary" onClick={()=>load(false)} disabled={refreshing}><RefreshCw size={15} className={refreshing?'dashboard-spinning':''}/> Atualizar</button></div></div>

    <div className="executive-health-grid">
      <HealthCard icon={Activity} label="Saúde geral" value={systemTone==='success'?'Normal':systemTone==='warning'?'Atenção':'Crítica'} detail={systemDetail} tone={systemTone}/>
      <HealthCard icon={ListTodo} label="Tasks abertas" value={openTasks} detail={`${stats?.awaiting||0} aguardando aprovação`} tone={openTasks?'warning':'success'} to="/tasks"/>
      <HealthCard icon={AlertTriangle} label="SLA violado" value={stats?.slaBreached||0} detail={`${stats?.completedToday||0} resolvidas hoje`} tone={stats?.slaBreached?'danger':'success'} to="/reports"/>
      {showBackup&&<HealthCard icon={ShieldCheck} label="Compliance" value={`${compliance?.summary.averageScore||0}%`} detail={`${compliance?.summary.belowTarget||0} abaixo da meta`} tone={(compliance?.summary.criticalFindings||0)?'danger':(compliance?.summary.belowTarget||0)?'warning':'success'} to="/compliance"/>}
      {showBackup&&<HealthCard icon={DatabaseBackup} label="Último backup" value={backupStatus?.lastBackup?new Date(backupStatus.lastBackup.createdAt).toLocaleDateString('pt-BR'):'Pendente'} detail={backupStatus?.lastBackup?'Backup do sistema disponível':'Execute o primeiro backup'} tone={backupStatus?.lastBackup?'success':'warning'} to="/backups"/>}
      {showBackup&&<HealthCard icon={CalendarClock} label="Ciclo de vida" value={lifecycleRisk?`${lifecycleRisk} em risco`:'Controlado'} detail={`${lifecycle?.summary.expired||0} vencido(s) · ${lifecycle?.summary.unknown||0} incompleto(s)`} tone={lifecycleRisk?'danger':(lifecycle?.summary.unknown||0)?'warning':'success'} to="/lifecycle"/>}
    </div>

    <div className="dashboard-main-grid">
      <Section id="operation" title="Operação do NOC" subtitle="Fila atual e desempenho operacional" icon={Gauge} collapsed={collapsed.has('operation')} onToggle={toggle}>
        <div className="operation-metrics">
          {[['Novas',stats?.pending||0,'primary'],['Em atendimento',(stats?.inProgress||0)+(stats?.diagnosing||0),'warning'],['Aguardando aprovação',stats?.awaiting||0,'danger'],['Resolvidas hoje',stats?.completedToday||0,'success']].map(([label,value,tone])=><div key={label}><span className={tone}>{value}</span><small>{label}</small></div>)}
        </div>
        <div className="operation-progress"><div><span>Resolvidas</span><strong>{stats?.resolved||stats?.completed||0}</strong></div><div className="operation-progress-track"><i style={{width:`${stats?.total?Math.min(((stats.resolved||stats.completed||0)/stats.total)*100,100):0}%`}}/></div><small>de {stats?.total||0} Tasks registradas</small></div>
      </Section>

      <Section id="shortcuts" title="Atalhos rápidos" subtitle="Acesso direto às principais ferramentas" icon={Zap} collapsed={collapsed.has('shortcuts')} onToggle={toggle}>
        <div className="dashboard-shortcuts">{quickLinks.map(item=><Link to={item.to} key={item.to}><item.icon size={19}/><div><strong>{item.label}</strong><span>{item.detail}</span></div></Link>)}</div>
      </Section>
    </div>

    {showBackup&&compliance&&<Section id="compliance" title="Compliance e segurança" subtitle="Pontuação, riscos e exceções dos últimos 30 dias" icon={ShieldCheck} collapsed={collapsed.has('compliance')} onToggle={toggle} action={<Link className="btn btn-secondary btn-sm" to="/compliance">Detalhes</Link>}>
      <div className="compliance-executive-grid">
        <div className="compliance-gauge-card"><div className="dashboard-ring" style={{'--score':`${compliance.summary.averageScore*3.6}deg`}}><div><strong>{compliance.summary.averageScore}%</strong><span>pontuação geral</span></div></div><div className="compliance-gauge-details"><div><span>Avaliados</span><strong>{compliance.summary.monitored}</strong></div><div><span>Abaixo da meta</span><strong className="warning">{compliance.summary.belowTarget}</strong></div><div><span>Desvios críticos</span><strong className="danger">{compliance.summary.criticalFindings}</strong></div><div><span>Exceções vencendo</span><strong>{compliance.summary.expiringExceptions}</strong></div></div></div>
        <div className="dashboard-trend-card"><h4>Evolução da pontuação</h4><div className="executive-trend">{compliance.trend.map(day=><div key={day.date} title={`${day.date}: ${day.score}%`}><span>{day.score}%</span><i style={{height:`${day.score/trendMax*100}%`}}/><small>{day.date.slice(5)}</small></div>)}{!compliance.trend.length&&<Empty>Sem verificações no período.</Empty>}</div></div>
        <div className="dashboard-risk-card"><h4>Equipamentos em risco</h4><div>{compliance.riskDevices.slice(0,5).map(item=><Link to="/compliance" key={item.id}><span className={`risk-indicator ${item.score<60?'danger':'warning'}`}/><div><strong>{item.name}</strong><small>{item.hostname} · meta {item.target}%</small></div><b>{item.score}%</b></Link>)}{!compliance.riskDevices.length&&<Empty>Todos estão dentro da meta.</Empty>}</div></div>
      </div>
    </Section>}

    {showBackup&&compliance?.expiring.length>0&&<Section id="exceptions" title="Exceções próximas do vencimento" subtitle="Revisão necessária nos próximos sete dias" icon={CalendarClock} collapsed={collapsed.has('exceptions')} onToggle={toggle} action={<Link className="btn btn-secondary btn-sm" to="/compliance">Gerenciar</Link>}>
      <div className="dashboard-expiring-list">{compliance.expiring.map(item=><div key={item.id}><CalendarClock size={18}/><div><strong>{item.device}</strong><span>{item.ruleKey} · aprovado por {item.approvedBy}</span></div><time>{time(item.expiresAt)}</time></div>)}</div>
    </Section>}

    <Section id="recent" title="Atividades recentes" subtitle="Últimas Tasks registradas no sistema" icon={Clock3} collapsed={collapsed.has('recent')} onToggle={toggle} action={<Link className="btn btn-secondary btn-sm" to="/tasks">Ver todas</Link>}>
      {!tasks.length?<Empty>Nenhuma Task registrada.</Empty>:<div className="dashboard-recent-table"><table><thead><tr><th>Task</th><th>Origem</th><th>Equipamento</th><th>Status</th><th>Prioridade</th><th>Atualização</th></tr></thead><tbody>{tasks.map(task=><tr key={task.id}><td><Link to="/tasks">#{task.taskNumber}</Link></td><td><span className={`badge ${task.source==='zabbix'?'badge-warning':task.source==='compliance'?'badge-info':'badge-success'}`}>{sourceLabel(task.source)}</span></td><td>{task.device?.name||'—'}</td><td><StatusBadge status={task.status}/></td><td><PriorityBadge priority={task.priority}/></td><td>{time(task.updatedAt||task.createdAt)}</td></tr>)}</tbody></table></div>}
    </Section>
  </div>;
}
