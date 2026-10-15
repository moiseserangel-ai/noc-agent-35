import { useState, useEffect } from 'react';
import { ListTodo, ChevronDown, ChevronUp, RefreshCw, CheckCircle, UserCheck, ShieldCheck, Archive, RotateCcw, MessageSquare, XCircle, Workflow, Eye, GitBranch, Pencil, Sparkles, FileDiff, LayoutGrid, List, Search, AlertTriangle, UserX, Clock3, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge.jsx';
import AgentResponse from '../components/AgentResponse.jsx';
import { useToast } from '../contexts/ToastContext.jsx';

const formatDuration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
};

const slaState = task => {
  if (task.slaResolveBreachedAt) return { label: 'SLA violado', className: 'badge-danger' };
  if (task.slaAckBreachedAt) return { label: 'Reconhecimento atrasado', className: 'badge-warning' };
  if (task.slaWarningSentAt) return { label: 'SLA em atenção', className: 'badge-warning' };
  return null;
};
const sourceLabel = source => String(source).startsWith('dashboard:') ? 'dashboard' : source;
const workTypeLabel = value => ({ incident: 'Incidente', consultation: 'Consulta', configuration: 'Configuração' }[value] || value);
const closedStatuses = new Set(['resolved','completed','validated','closed','cancelled']);
const kanbanColumns = [
  { id:'new', label:'Novas', statuses:['pending'], tone:'primary' },
  { id:'working', label:'Em atendimento', statuses:['in_progress','diagnosing','failed'], tone:'warning' },
  { id:'approval', label:'Aguardando aprovação', statuses:['awaiting_approval'], tone:'danger' },
  { id:'execution', label:'Em execução', statuses:['executing'], tone:'info' },
  { id:'done', label:'Concluídas', statuses:['resolved','completed','validated','closed','cancelled'], tone:'success' },
];
const taskTitle = task => task.device?.name || String(task.originalMessage || 'Tarefa sem descrição').split('\n')[0];

export default function Tasks({ canOperate = false, isAdmin = false }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', source: '', priority: '', sla: '' });
  const [expanded, setExpanded] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [processing, setProcessing] = useState(null);
  const [workflowForms, setWorkflowForms] = useState({});
  const [taskRunbooks,setTaskRunbooks]=useState({});
  const [cmdbContexts,setCmdbContexts]=useState({});
  const [proposalForms,setProposalForms]=useState({});
  const [proposalComparisons,setProposalComparisons]=useState({});
  const [view,setView]=useState(()=>localStorage.getItem('noc_tasks_view')||'board');
  const [search,setSearch]=useState('');
  const [onlyUnassigned,setOnlyUnassigned]=useState(false);
  const [onlyOpen,setOnlyOpen]=useState(false);
  const [refreshNonce,setRefreshNonce]=useState(0);
  const toast = useToast();

  useEffect(() => { api.getDevices().then(r => setDevices(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (view !== 'board' || !expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [view, expanded]);

  const reprocess = async (task) => {
    const deviceId = selectedDevices[task.id] || task.deviceId;
    if (!deviceId) { toast('Selecione o equipamento relacionado à Task', 'error'); return; }
    setProcessing(task.id);
    try {
      await api.reprocessTask(task.id, deviceId);
      toast('Task analisada novamente pelo agente', 'success');
      const r = await api.getTasks(filter); setTasks(r.data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setProcessing(null); }
  };

  const complete = async task => {
    const note = window.prompt('Descreva como o incidente foi resolvido:', 'Resolvido manualmente pelo administrador');
    if (note === null) return;
    setProcessing(task.id);
    try {
      await api.completeTask(task.id, note);
      toast('Task marcada como resolvida; agora ela pode ser validada e encerrada', 'success');
      setTasks(items => items.map(item => item.id === task.id ? { ...item, status: 'resolved', executionResult: note, resolutionSummary: note, resolvedAt: new Date().toISOString() } : item));
    } catch (e) { toast(e.message, 'error'); }
    finally { setProcessing(null); }
  };

  const loadTaskDetail = async id => {
    setExpanded(expanded === id ? null : id);
    if (expanded === id) return;
    try {
      const [r,context] = await Promise.all([api.getTask(id),api.getTaskCmdbImpact(id)]);
      setTasks(items => items.map(item => item.id === id ? r.data : item));
      setCmdbContexts(items=>({...items,[id]:context.data}));
      setWorkflowForms(forms => ({ ...forms, [id]: { assignedTo: r.data.assignedTo || '', dueAt: r.data.dueAt ? new Date(r.data.dueAt).toISOString().slice(0, 16) : '', note: '' } }));
      setProposalForms(forms=>({...forms,[id]:{feedback:forms[id]?.feedback||'',content:r.data.proposedSolution||''}}));
      if(r.data.deviceId&&r.data.workType==='incident')loadRunbooks(r.data);
    } catch (e) { toast(e.message, 'error'); }
  };

  const loadRunbooks=async task=>{
    setTaskRunbooks(value=>({...value,[task.id]:{...(value[task.id]||{}),loading:true}}));
    try{const result=await api.getTaskRunbooks(task.id);setTaskRunbooks(value=>({...value,[task.id]:{...result.data,loading:false,values:value[task.id]?.values||{},preview:value[task.id]?.preview||null}}));}
    catch(error){setTaskRunbooks(value=>({...value,[task.id]:{...(value[task.id]||{}),loading:false,error:error.message}}));}
  };
  const setRunbookValue=(taskId,runbookId,key,value)=>setTaskRunbooks(state=>({...state,[taskId]:{...state[taskId],preview:null,values:{...state[taskId]?.values,[runbookId]:{...state[taskId]?.values?.[runbookId],[key]:value}}}}));
  const simulateRunbook=async(task,runbook)=>{
    setProcessing(`runbook:${task.id}`);
    try{const defaults=Object.fromEntries(runbook.variables.map(variable=>[variable.key,variable.default||'']));const variables={...defaults,...taskRunbooks[task.id]?.values?.[runbook.id]};const result=await api.simulateTaskRunbook(task.id,runbook.id,variables);toast(result.message,'success');setTaskRunbooks(state=>({...state,[task.id]:{...state[task.id],preview:{...result.data,runbookId:runbook.id,runbookName:runbook.name,variables}}}));const detail=await api.getTask(task.id);setTasks(items=>items.map(item=>item.id===task.id?detail.data:item));}
    catch(error){toast(error.message,'error');}finally{setProcessing(null);}
  };
  const executeTaskRunbook=async task=>{
    const preview=taskRunbooks[task.id]?.preview;if(!preview)return;
    if(!window.confirm(`Executar o Runbook "${preview.runbookName}" no equipamento ${task.device?.name}? Os comandos exibidos na simulação serão aplicados.`))return;
    setProcessing(`runbook:${task.id}`);
    try{const result=await api.executeTaskRunbook(task.id,preview.runbookId,preview.variables);toast(result.message,result.data.status==='completed'?'success':'error');const detail=await api.getTask(task.id);setTasks(items=>items.map(item=>item.id===task.id?detail.data:item));await loadRunbooks(detail.data);}
    catch(error){toast(error.message,'error');}finally{setProcessing(null);}
  };

  const workflow = async (task, action, extra = {}) => {
    const form = workflowForms[task.id] || {};
    setProcessing(task.id);
    try {
      const r = await api.updateTaskWorkflow(task.id, { action, note: form.note || '', ...extra });
      setTasks(items => items.map(item => item.id === task.id ? r.data : item));
      setWorkflowForms(forms => ({ ...forms, [task.id]: { ...form, note: '' } }));
      toast('Ciclo do incidente atualizado', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setProcessing(null); }
  };

  const rollbackAssist = async task => { setProcessing(task.id); try { const result=await api.rollbackAssist(task.id); toast(result.message,'success'); await load(); } catch(error){ toast(error.message,'error'); } finally { setProcessing(null); } };

  const approve = async (task, approved) => {
    const question=approved?'Aprovar e executar esta configuração no equipamento?':'Rejeitar esta configuração sem executar comandos?';
    if(!window.confirm(question))return;
    setProcessing(task.id);
    try{const result=await api.approveTask(task.id,approved);toast(result.message,approved?'success':'info');const detail=await api.getTask(task.id);setTasks(items=>items.map(item=>item.id===task.id?detail.data:item));}
    catch(error){toast(error.message,'error');}
    finally{setProcessing(null);}
  };

  const reviseProposal=async(task,mode)=>{const form=proposalForms[task.id]||{};if(mode==='suggest'&&!form.feedback?.trim()){toast('Descreva a correção que o agente deve considerar','error');return}if(mode==='edit'&&!window.confirm('Salvar sua edição como uma nova versão da proposta? Ela ainda precisará de aprovação antes da execução.'))return;setProcessing(`proposal:${task.id}`);try{const result=await api.reviseTaskProposal(task.id,{mode,feedback:form.feedback||'',content:form.content||''});toast(result.message,'success');setTasks(items=>items.map(item=>item.id===task.id?result.data:item));setProposalForms(forms=>({...forms,[task.id]:{feedback:'',content:result.data.proposedSolution||''}}))}catch(error){toast(error.message,'error')}finally{setProcessing(null)}};
  const compareProposal=async task=>{setProcessing(`compare:${task.id}`);try{const result=await api.compareTaskProposal(task.id);setProposalComparisons(value=>({...value,[task.id]:result.data}));toast(result.message,'success')}catch(error){toast(error.message,'error')}finally{setProcessing(null)}};

  useEffect(() => {
    let active = true;
    const load = (showLoading = false) => {
    if (showLoading) setLoading(true);
    const p = {};
    if (filter.status) p.status = filter.status;
    if (filter.source) p.source = filter.source;
    if (filter.priority) p.priority = filter.priority;
    if (filter.sla) p.sla = filter.sla;
    api.getTasks(p).then(r => {
      if (!active) return;
      setTasks(current => r.data.map(fresh => {
        const detailed = current.find(item => item.id === fresh.id && item.messages);
        return detailed ? { ...detailed, ...fresh, messages: detailed.messages } : fresh;
      }));
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    };
    load(true);
    const interval = setInterval(() => load(false), 15000);
    const resume = () => { if (document.visibilityState === 'visible') load(false); };
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', resume); };
  }, [filter,refreshNonce]);

  const changeView=value=>{setView(value);localStorage.setItem('noc_tasks_view',value);if(value==='list')setExpanded(null);};
  const normalizedSearch=search.trim().toLocaleLowerCase('pt-BR');
  const visibleTasks=tasks.filter(task=>{
    if(onlyOpen&&closedStatuses.has(task.status))return false;
    if(onlyUnassigned&&task.assignedTo)return false;
    if(!normalizedSearch)return true;
    return [`${task.taskNumber}`,task.originalMessage,task.device?.name,task.device?.hostname,task.assignedTo,sourceLabel(task.source)]
      .some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(normalizedSearch));
  });
  const summary={
    open:tasks.filter(task=>!closedStatuses.has(task.status)).length,
    critical:tasks.filter(task=>task.priority==='critical'&&!closedStatuses.has(task.status)).length,
    approval:tasks.filter(task=>task.status==='awaiting_approval').length,
    breached:tasks.filter(task=>Boolean(task.slaResolveBreachedAt||task.slaAckBreachedAt)).length,
    unassigned:tasks.filter(task=>!task.assignedTo&&!closedStatuses.has(task.status)).length,
    resolvedToday:tasks.filter(task=>task.resolvedAt&&new Date(task.resolvedAt).toDateString()===new Date().toDateString()).length,
  };
  const applyQuickFilter=kind=>{
    if(kind==='critical')setFilter(value=>({...value,priority:'critical'}));
    else if(kind==='approval')setFilter(value=>({...value,status:'awaiting_approval'}));
    else if(kind==='breached')setFilter(value=>({...value,sla:'breached'}));
    else if(kind==='unassigned')setOnlyUnassigned(true);
    else if(kind==='open'){setFilter(value=>({...value,status:''}));setOnlyOpen(true);}
  };
  const clearFilters=()=>{setFilter({status:'',source:'',priority:'',sla:''});setSearch('');setOnlyUnassigned(false);setOnlyOpen(false);};
  const listTasks=view==='board'?(expanded?visibleTasks.filter(task=>task.id===expanded):[]):visibleTasks;

  return (
    <div className={`tasks-workspace tasks-view-${view}`}>
      <div className="page-header page-header-actions tasks-titlebar"><div><h2>Tarefas</h2><p>Acompanhe diagnósticos, aprovações e ações da operação</p></div><div className="tasks-title-actions"><button className="btn btn-secondary" onClick={()=>setRefreshNonce(value=>value+1)}><RefreshCw size={15}/> Atualizar</button><div className="tasks-view-toggle" aria-label="Modo de visualização"><button className={view==='board'?'active':''} aria-label="Visualização em quadro" onClick={()=>changeView('board')}><LayoutGrid size={16}/> Quadro</button><button className={view==='list'?'active':''} aria-label="Visualização em lista" onClick={()=>changeView('list')}><List size={16}/> Lista</button></div></div></div>
      <div className="tasks-summary-grid">
        <button onClick={()=>applyQuickFilter('open')}><ListTodo/><span><strong>{summary.open}</strong>Em aberto</span></button>
        <button onClick={()=>applyQuickFilter('critical')}><AlertTriangle/><span><strong>{summary.critical}</strong>Críticas</span></button>
        <button onClick={()=>applyQuickFilter('approval')}><ShieldCheck/><span><strong>{summary.approval}</strong>Aguardando aprovação</span></button>
        <button onClick={()=>applyQuickFilter('breached')}><Clock3/><span><strong>{summary.breached}</strong>SLA vencido</span></button>
        <button onClick={()=>applyQuickFilter('unassigned')}><UserX/><span><strong>{summary.unassigned}</strong>Sem responsável</span></button>
        <button><CheckCircle/><span><strong>{summary.resolvedToday}</strong>Resolvidas hoje</span></button>
      </div>
      <div className="card tasks-filter-card">
        <div className="tasks-filter-grid">
          <label className="tasks-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar número, equipamento, mensagem ou responsável…"/></label>
          <select className="form-select" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos Status</option>
            <option value="pending">Novo</option><option value="in_progress">Em atendimento</option><option value="diagnosing">Em análise</option>
            <option value="awaiting_approval">Aguardando aprovação</option><option value="resolved">Resolvido</option>
            <option value="validated">Validado</option><option value="closed">Encerrado</option>
            <option value="failed">Falhou</option><option value="cancelled">Cancelado</option>
          </select>
          <select className="form-select" value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}>
            <option value="">Todas Fontes</option><option value="whatsapp">WhatsApp</option>
            <option value="zabbix">Zabbix</option><option value="dashboard">Dashboard</option><option value="compliance">Compliance</option>
          </select>
          <select className="form-select" value={filter.priority} onChange={e=>setFilter(f=>({...f,priority:e.target.value}))}><option value="">Todas prioridades</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select>
          <select className="form-select" value={filter.sla} onChange={e => setFilter(f => ({ ...f, sla: e.target.value }))}>
            <option value="">Todos SLA</option><option value="breached">SLA violado</option>
          </select>
          <button className={`btn ${onlyUnassigned?'btn-primary':'btn-secondary'}`} onClick={()=>setOnlyUnassigned(value=>!value)}><UserX size={14}/> Sem responsável</button>
          <button className="btn btn-ghost" onClick={clearFilters}><X size={14}/> Limpar filtros</button>
        </div>
        <div className="tasks-filter-result"><strong>{visibleTasks.length}</strong> de {tasks.length} tarefa(s) exibida(s)</div>
      </div>
      {loading ? <div className="loading-screen" style={{ minHeight: 200 }}><div className="spinner" /></div> :
      visibleTasks.length === 0 ? <div className="card"><div className="empty-state"><ListTodo size={48} /><p>Nenhuma tarefa encontrada.</p><button className="btn btn-secondary" onClick={clearFilters}>Limpar filtros</button></div></div> : <>
      {view==='board'&&<div className="tasks-kanban">{kanbanColumns.map(column=>{const rows=visibleTasks.filter(task=>column.statuses.includes(task.status));return <section className={`tasks-kanban-column tone-${column.tone}`} key={column.id}><header><div><span/><strong>{column.label}</strong></div><b>{rows.length}</b></header><div className="tasks-kanban-cards">{rows.map(task=>{const sla=slaState(task);return <button className={`task-kanban-card ${task.priority==='critical'?'critical':''}`} key={task.id} onClick={()=>loadTaskDetail(task.id)}><div className="task-kanban-card-head"><strong>#{task.taskNumber}</strong><PriorityBadge priority={task.priority}/></div><h3>{taskTitle(task)}</h3><p>{task.originalMessage||'Sem descrição'}</p><div className="task-kanban-tags"><span>{workTypeLabel(task.workType)}</span><span>{sourceLabel(task.source)}</span>{sla&&<span className={sla.className}>{sla.label}</span>}</div><footer><span>{task.assignedTo||'Não atribuído'}</span><time>{new Date(task.createdAt).toLocaleDateString('pt-BR')}</time></footer></button>})}{!rows.length&&<div className="task-kanban-empty">Nenhuma tarefa</div>}</div></section>})}</div>}
      {view==='board'&&expanded&&<div className="task-drawer-backdrop" onClick={()=>setExpanded(null)}/>}
      <div className="tasks-list">
        {listTasks.map(t => (
          <div key={t.id} className={`card task-list-card ${expanded===t.id?'task-detail-expanded':''}`} onClick={() => loadTaskDetail(t.id)}>
            <div className="task-list-summary">
              <span style={{ color: 'var(--primary)', fontWeight: 700, minWidth: 60 }}>#{t.taskNumber}</span>
              <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
              {slaState(t) && <span className={`badge ${slaState(t).className}`}>{slaState(t).label}</span>}
              <span className={`badge ${t.workType === 'incident' ? 'badge-danger' : t.workType === 'configuration' ? 'badge-warning' : 'badge-info'}`}>{workTypeLabel(t.workType)}</span>
              <span className={`badge ${t.source === 'zabbix' ? 'badge-warning' : 'badge-success'}`}>{sourceLabel(t.source)}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.device?.name || t.originalMessage?.substring(0, 50)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{new Date(t.createdAt).toLocaleString('pt-BR')}</span>
              {view==='board'&&expanded===t.id?<button className="btn-ghost task-drawer-close" aria-label="Fechar detalhes" onClick={e=>{e.stopPropagation();setExpanded(null)}}><X size={18}/></button>:expanded === t.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {expanded === t.id && (
              <div className="task-detail-body" onClick={e => e.stopPropagation()} style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)' }}>
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>RESPONSÁVEL</div><strong>{t.assignedTo || 'Não atribuído'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>PRAZO</div><strong>{t.dueAt ? new Date(t.dueAt).toLocaleString('pt-BR') : 'Sem prazo'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>RECONHECIDO EM</div><strong>{t.acknowledgedAt ? new Date(t.acknowledgedAt).toLocaleString('pt-BR') : '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>VALIDADO EM</div><strong>{t.validatedAt ? new Date(t.validatedAt).toLocaleString('pt-BR') : '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ENCERRADO EM</div><strong>{t.closedAt ? new Date(t.closedAt).toLocaleString('pt-BR') : '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>SLA RECONHECIMENTO</div><strong>{t.slaAckDueAt ? new Date(t.slaAckDueAt).toLocaleString('pt-BR') : '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>SLA RESOLUÇÃO</div><strong>{t.slaResolveDueAt ? new Date(t.slaResolveDueAt).toLocaleString('pt-BR') : '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ESCALONAMENTO</div><strong>Nível {t.escalationLevel || 0}</strong></div>
                </div>
                {t.source === 'zabbix' && <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>EVENT.ID</div><strong>{t.zabbixEventId || '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ESTADO ZABBIX</div><strong>{t.zabbixStatus || '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>OCORRÊNCIAS</div><strong>{t.occurrenceCount || 1}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>DUPLICADAS IGNORADAS</div><strong>{t.duplicateCount || 0}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>DURAÇÃO</div><strong>{formatDuration(t.durationSeconds)}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>RESOLVIDO EM</div><strong>{t.resolvedAt ? new Date(t.resolvedAt).toLocaleString('pt-BR') : '—'}</strong></div>
                </div>}
                {t.deviceId&&<div className="task-cmdb-context"><div className="task-cmdb-title"><GitBranch size={16}/><strong>Contexto CMDB e impacto</strong></div><div className="task-cmdb-summary"><span><strong>{cmdbContexts[t.id]?.summary?.mapped||0}</strong> ativo relacionado</span><span><strong>{cmdbContexts[t.id]?.summary?.impacted||0}</strong> dependentes</span><span><strong>{cmdbContexts[t.id]?.summary?.critical||0}</strong> críticos</span><span><strong>{cmdbContexts[t.id]?.summary?.services||0}</strong> serviços</span><span><strong>{cmdbContexts[t.id]?.summary?.clients||0}</strong> clientes</span></div>{cmdbContexts[t.id]?.services?.map(service=><div className={`task-business-service ${service.criticality}`} key={service.id}><span>{service.criticality}</span><div><strong>{service.code} · {service.name}</strong><small>{service.tenant?.name||'Serviço global'} · {service.assets.length} ativo(s) afetado(s)</small></div></div>)}{cmdbContexts[t.id]?.roots?.map(asset=><div className="task-cmdb-root" key={asset.id}><strong>{asset.assetTag} · {asset.name}</strong><small>{asset.manufacturer} {asset.model} · criticidade {asset.criticality}</small></div>)}{cmdbContexts[t.id]?.impacted?.map(item=><div className="task-cmdb-dependent" key={item.asset.id}><span>Nível {item.depth}</span><div><strong>{item.asset.assetTag} · {item.asset.name}</strong><small>Pode ser afetado por este incidente</small></div></div>)}{Boolean(cmdbContexts[t.id]?.unmappedDeviceIds?.length)&&<small className="change-cmdb-warning">Este equipamento ainda não está vinculado a um ativo do CMDB.</small>}</div>}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>MENSAGEM</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}>{t.originalMessage}</pre>
                </div>
                {t.diagnosis && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>DIAGNÓSTICO</div>
                  <div style={{ fontSize: '0.8rem', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}><AgentResponse content={t.diagnosis} /></div>
                </div>}
                {t.proposedSolution && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>PLANO PROPOSTO — REVISE ANTES DE APROVAR</div>
                  <div style={{ fontSize: '0.8rem', background: 'var(--warning-dim)', border:'1px solid color-mix(in srgb,var(--warning) 35%,transparent)', padding: 12, borderRadius: 8 }}><AgentResponse content={t.proposedSolution} /></div>
                  {canOperate&&t.deviceId&&<div className="task-proposal-compare-action"><button className="btn btn-secondary" disabled={processing===`compare:${t.id}`} onClick={()=>compareProposal(t)}>{processing===`compare:${t.id}`?<span className="spinner"/>:<FileDiff size={14}/>} Coletar e comparar com estado atual</button><small>Somente leitura; nenhum comando da proposta será executado.</small></div>}
                  {proposalComparisons[t.id]&&<div className="task-proposal-comparison"><div className="task-proposal-comparison-head"><div><strong>Comparação pré-aprovação</strong><small>Coleta {new Date(proposalComparisons[t.id].baseline.createdAt).toLocaleString('pt-BR')} · SHA-256 {proposalComparisons[t.id].baseline.sha256?.slice(0,12)}</small></div><span>{proposalComparisons[t.id].baseline.deviceType} {proposalComparisons[t.id].baseline.osVersion||''}</span></div><div className="task-proposal-comparison-summary"><span><strong>{proposalComparisons[t.id].summary.commands}</strong> comandos</span><span className="proposal-present"><strong>{proposalComparisons[t.id].summary.present}</strong> já presentes</span><span className="proposal-change"><strong>{proposalComparisons[t.id].summary.changes}</strong> novos/alterações</span><span className="proposal-removal"><strong>{proposalComparisons[t.id].summary.removals}</strong> remoções/risco</span></div>{proposalComparisons[t.id].warnings.map(text=><p className="task-proposal-warning" key={text}>⚠️ {text}</p>)}<div className="task-proposal-comparison-rows">{proposalComparisons[t.id].rows.map((row,index)=><details key={`${row.command}-${index}`} className={`proposal-row ${row.status}`}><summary><span>{row.status==='present'?'PRESENTE':row.status==='removal'?'REMOÇÃO':'ALTERAÇÃO'}</span><code>{row.command}</code></summary>{row.matches.length?<pre>{row.matches.join('\n')}</pre>:<p>Nenhuma correspondência suficiente encontrada na configuração atual.</p>}</details>)}</div></div>}
                  {canOperate&&t.status==='awaiting_approval'&&<div className="task-proposal-review"><div><label className="form-label">Sugestão para o agente</label><textarea className="form-input" rows="3" placeholder="Ex.: preserve a rota padrão e use a VLAN 410..." value={proposalForms[t.id]?.feedback||''} onChange={e=>setProposalForms(f=>({...f,[t.id]:{...f[t.id],feedback:e.target.value}}))}/><button className="btn btn-secondary" disabled={processing===`proposal:${t.id}`} onClick={()=>reviseProposal(t,'suggest')}><Sparkles size={14}/> Solicitar nova proposta</button></div><details><summary><Pencil size={14}/> Editar comandos e texto diretamente</summary><textarea className="form-input task-proposal-editor" rows="12" value={proposalForms[t.id]?.content??t.proposedSolution} onChange={e=>setProposalForms(f=>({...f,[t.id]:{...f[t.id],content:e.target.value}}))}/><button className="btn btn-secondary" disabled={processing===`proposal:${t.id}`} onClick={()=>reviseProposal(t,'edit')}><Pencil size={14}/> Salvar como nova versão</button></details>{t.proposalRevisions?.length>0&&<details className="task-proposal-history"><summary>Histórico de versões ({t.proposalRevisions.length})</summary>{t.proposalRevisions.map(r=><article key={r.id}><strong>v{r.version} · {r.type==='manual_edit'?'Edição humana':r.type==='agent_revision'?'Revisão do agente':'Proposta original'}</strong><small>{r.createdBy} ({r.createdByRole}) · {new Date(r.createdAt).toLocaleString('pt-BR')}</small>{r.feedback&&<p>Orientação: {r.feedback}</p>}<pre>{r.content}</pre></article>)}</details>}</div>}
                </div>}
                {t.executionResult && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>RESULTADO</div>
                  <div style={{ fontSize: '0.8rem', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}><AgentResponse content={t.executionResult} /></div>
                </div>}
                {t.workType==='incident'&&t.deviceId&&<div className="task-runbook-panel">
                  <div className="task-runbook-title"><div><Workflow size={17}/><strong>Runbooks sugeridos</strong></div><button className="btn btn-ghost" disabled={taskRunbooks[t.id]?.loading} onClick={()=>loadRunbooks(t)}><RefreshCw size={14}/> Atualizar</button></div>
                  {taskRunbooks[t.id]?.loading?<div className="task-runbook-loading"><span className="spinner"/> Analisando compatibilidade...</div>:taskRunbooks[t.id]?.error?<p className="task-runbook-empty">{taskRunbooks[t.id].error}</p>:!taskRunbooks[t.id]?.suggestions?.length?<p className="task-runbook-empty">Nenhum Runbook publicado é compatível. Importe, revise e publique um modelo no Catálogo de Runbooks.</p>:<div className="task-runbook-suggestions">{taskRunbooks[t.id].suggestions.map(runbook=><article key={runbook.id}>
                    <div className="task-runbook-head"><div><strong>{runbook.name}</strong><small>v{runbook.version} · {runbook.deviceType}</small></div><span>{runbook.recommendationScore}% compatível</span></div>
                    <p>{runbook.description}</p><div className="task-runbook-reasons">{runbook.recommendationReasons.map(reason=><span key={reason}>{reason}</span>)}</div>
                    {runbook.variables.length>0&&<div className="task-runbook-variables">{runbook.variables.map(variable=><label key={variable.key}><span>{variable.label}{variable.required?' *':''}</span><input className="form-input" value={taskRunbooks[t.id]?.values?.[runbook.id]?.[variable.key]??variable.default??''} onChange={e=>setRunbookValue(t.id,runbook.id,variable.key,e.target.value)}/></label>)}</div>}
                    <button className="btn btn-secondary" disabled={processing===`runbook:${t.id}`} onClick={()=>simulateRunbook(t,runbook)}><Eye size={14}/> Simular na Task</button>
                  </article>)}</div>}
                  {taskRunbooks[t.id]?.preview&&<div className="task-runbook-preview"><strong>Prévia · {taskRunbooks[t.id].preview.runbookName}</strong><span>Nenhum comando executado</span>{taskRunbooks[t.id].preview.renderedSteps.map((step,index)=><div key={step.id}><small>{index+1}. {step.name} · {step.commandType==='change'?'ALTERAÇÃO':'CONSULTA'}</small><pre>{step.command}</pre></div>)}{isAdmin&&<button className="btn btn-primary" disabled={processing===`runbook:${t.id}`} onClick={()=>executeTaskRunbook(t)}><ShieldCheck size={14}/> Confirmar e executar</button>}</div>}
                  {taskRunbooks[t.id]?.executions?.length>0&&<div className="task-runbook-linked"><strong>Atividade vinculada</strong>{taskRunbooks[t.id].executions.slice(0,5).map(execution=><span key={execution.id}>{new Date(execution.createdAt).toLocaleString('pt-BR')} · {execution.runbook?.name} · {execution.mode==='simulation'?'Simulação':execution.mode}</span>)}</div>}
                </div>}
                {t.messages?.length > 0 && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>LINHA DO TEMPO</div>
                  <div style={{ borderLeft: '2px solid var(--border-primary)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {t.messages.map(m => <div key={m.id}><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(m.createdAt).toLocaleString('pt-BR')} · {m.agentName || m.role}</div><div style={{ fontSize: '0.8rem' }}><AgentResponse content={m.content} /></div></div>)}
                  </div>
                </div>}
                {canOperate && <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                  <div className="workflow-assignment-grid">
                    <div><label className="form-label">Responsável</label><input className="form-input" value={workflowForms[t.id]?.assignedTo || ''} onChange={e => setWorkflowForms(f => ({ ...f, [t.id]: { ...f[t.id], assignedTo: e.target.value } }))} placeholder="Nome do operador" /></div>
                    <div><label className="form-label">Prazo</label><input className="form-input" type="datetime-local" value={workflowForms[t.id]?.dueAt || ''} onChange={e => setWorkflowForms(f => ({ ...f, [t.id]: { ...f[t.id], dueAt: e.target.value } }))} /></div>
                    <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'assign', { assignedTo: workflowForms[t.id]?.assignedTo, dueAt: workflowForms[t.id]?.dueAt || null })}><UserCheck size={15} /> Atribuir</button>
                  </div>
                  <div style={{ marginTop: 8 }}><label className="form-label">Comentário / observação</label><textarea className="form-input" rows={2} value={workflowForms[t.id]?.note || ''} onChange={e => setWorkflowForms(f => ({ ...f, [t.id]: { ...f[t.id], note: e.target.value } }))} placeholder="Registre o andamento ou a resolução..." /></div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['pending', 'failed'].includes(t.status) && <button className="btn btn-primary" disabled={processing === t.id} onClick={() => workflow(t, 'acknowledge')}><UserCheck size={15} /> Reconhecer e atender</button>}
                    {!['resolved', 'completed', 'validated', 'closed', 'cancelled'].includes(t.status) && <button className="btn btn-success" disabled={processing === t.id} onClick={() => workflow(t, 'resolve', { resolutionType: 'manual' })}><CheckCircle size={15} /> Resolver</button>}
                    {['resolved', 'completed'].includes(t.status) && <button className="btn btn-primary" disabled={processing === t.id} onClick={() => workflow(t, 'validate')}><ShieldCheck size={15} /> Validar</button>}
                  {['resolved', 'completed', 'validated'].includes(t.status) && <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'close')}><Archive size={15} /> Encerrar</button>}
                  {isAdmin&&['failed','resolved'].includes(t.status)&&<button className="btn btn-secondary" disabled={processing===t.id} onClick={()=>rollbackAssist(t)}><RotateCcw size={15}/> Rollback assistido</button>}
                    {['resolved', 'completed', 'validated', 'closed', 'cancelled', 'failed'].includes(t.status) && <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'reopen')}><RotateCcw size={15} /> Reabrir</button>}
                    {workflowForms[t.id]?.note && <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'comment')}><MessageSquare size={15} /> Comentar</button>}
                  </div>
                </div>}
                {canOperate && ['pending', 'in_progress', 'diagnosing', 'failed', 'awaiting_approval'].includes(t.status) && <div onClick={e => e.stopPropagation()} style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isAdmin&&t.status==='awaiting_approval'&&<><button className="btn btn-success" disabled={processing===t.id} onClick={()=>approve(t,true)}><ShieldCheck size={15}/> Aprovar e executar</button><button className="btn btn-secondary" disabled={processing===t.id} onClick={()=>approve(t,false)}><XCircle size={15}/> Rejeitar</button></>}
                  <select className="form-select" style={{ maxWidth: 300 }} value={selectedDevices[t.id] || t.deviceId || ''} onChange={e => setSelectedDevices(v => ({ ...v, [t.id]: e.target.value }))}>
                    <option value="">Selecione o equipamento</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name} — {d.hostname}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={processing === t.id || t.status === 'diagnosing'} onClick={() => reprocess(t)}>
                    <RefreshCw size={15} /> {processing === t.id || t.status === 'diagnosing' ? 'Processando...' : 'Reprocessar com agente'}
                  </button>
                  <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => complete(t)}>
                    <CheckCircle size={15} /> Concluir manualmente
                  </button>
                </div>}
              </div>
            )}
          </div>
        ))}
      </div></>}
    </div>
  );
}
