import { useState, useEffect } from 'react';
import { ListTodo, ChevronDown, ChevronUp, RefreshCw, CheckCircle, UserCheck, ShieldCheck, Archive, RotateCcw, MessageSquare, XCircle, Workflow, Eye, GitBranch } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge.jsx';
import AgentResponse from '../components/AgentResponse.jsx';
import { useToast } from '../App.jsx';

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
  const toast = useToast();

  useEffect(() => { api.getDevices().then(r => setDevices(r.data)).catch(() => {}); }, []);

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

  const approve = async (task, approved) => {
    const question=approved?'Aprovar e executar esta configuração no equipamento?':'Rejeitar esta configuração sem executar comandos?';
    if(!window.confirm(question))return;
    setProcessing(task.id);
    try{const result=await api.approveTask(task.id,approved);toast(result.message,approved?'success':'info');const detail=await api.getTask(task.id);setTasks(items=>items.map(item=>item.id===task.id?detail.data:item));}
    catch(error){toast(error.message,'error');}
    finally{setProcessing(null);}
  };

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
  }, [filter]);

  return (
    <div>
      <div className="page-header"><h2>Tasks</h2><p>Histórico de diagnósticos e ações</p></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 150 }} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos Status</option>
            <option value="pending">Novo</option><option value="in_progress">Em atendimento</option><option value="diagnosing">Em análise</option>
            <option value="awaiting_approval">Aguardando aprovação</option><option value="resolved">Resolvido</option>
            <option value="validated">Validado</option><option value="closed">Encerrado</option>
            <option value="failed">Falhou</option><option value="cancelled">Cancelado</option>
          </select>
          <select className="form-select" style={{ width: 130 }} value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}>
            <option value="">Todas Fontes</option><option value="whatsapp">WhatsApp</option>
            <option value="zabbix">Zabbix</option><option value="dashboard">Dashboard</option><option value="compliance">Compliance</option>
          </select>
          <select className="form-select" style={{ width: 150 }} value={filter.sla} onChange={e => setFilter(f => ({ ...f, sla: e.target.value }))}>
            <option value="">Todos SLA</option><option value="breached">SLA violado</option>
          </select>
        </div>
      </div>
      {loading ? <div className="loading-screen" style={{ minHeight: 200 }}><div className="spinner" /></div> :
      tasks.length === 0 ? <div className="card"><div className="empty-state"><ListTodo size={48} /><p>Nenhuma task encontrada.</p></div></div> :
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map(t => (
          <div key={t.id} className="card" style={{ cursor: 'pointer', padding: 0 }} onClick={() => loadTaskDetail(t.id)}>
            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--primary)', fontWeight: 700, minWidth: 60 }}>#{t.taskNumber}</span>
              <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
              {slaState(t) && <span className={`badge ${slaState(t).className}`}>{slaState(t).label}</span>}
              <span className={`badge ${t.workType === 'incident' ? 'badge-danger' : t.workType === 'configuration' ? 'badge-warning' : 'badge-info'}`}>{workTypeLabel(t.workType)}</span>
              <span className={`badge ${t.source === 'zabbix' ? 'badge-warning' : 'badge-success'}`}>{sourceLabel(t.source)}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.device?.name || t.originalMessage?.substring(0, 50)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{new Date(t.createdAt).toLocaleString('pt-BR')}</span>
              {expanded === t.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {expanded === t.id && (
              <div onClick={e => e.stopPropagation()} style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)' }}>
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
                    {['resolved', 'completed', 'validated', 'closed', 'cancelled', 'failed'].includes(t.status) && <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'reopen')}><RotateCcw size={15} /> Reabrir</button>}
                    {workflowForms[t.id]?.note && <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => workflow(t, 'comment')}><MessageSquare size={15} /> Comentar</button>}
                  </div>
                </div>}
                {canOperate && ['pending', 'in_progress', 'failed', 'awaiting_approval'].includes(t.status) && <div onClick={e => e.stopPropagation()} style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isAdmin&&t.status==='awaiting_approval'&&<><button className="btn btn-success" disabled={processing===t.id} onClick={()=>approve(t,true)}><ShieldCheck size={15}/> Aprovar e executar</button><button className="btn btn-secondary" disabled={processing===t.id} onClick={()=>approve(t,false)}><XCircle size={15}/> Rejeitar</button></>}
                  <select className="form-select" style={{ maxWidth: 300 }} value={selectedDevices[t.id] || t.deviceId || ''} onChange={e => setSelectedDevices(v => ({ ...v, [t.id]: e.target.value }))}>
                    <option value="">Selecione o equipamento</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name} — {d.hostname}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={processing === t.id} onClick={() => reprocess(t)}>
                    <RefreshCw size={15} /> {processing === t.id ? 'Processando...' : 'Reprocessar com agente'}
                  </button>
                  <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => complete(t)}>
                    <CheckCircle size={15} /> Concluir manualmente
                  </button>
                </div>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}
