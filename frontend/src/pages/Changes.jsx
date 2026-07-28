import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Eye, Play, Plus, RefreshCw, RotateCcw, Send, ShieldCheck, X, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const statusLabel={draft:'Rascunho',awaiting_approval:'Aguardando aprovação',approved:'Aprovada',in_progress:'Em execução',validating:'Validando',completed:'Concluída',failed_validation:'Falha na validação',rollback_requested:'Rollback solicitado',rolled_back:'Rollback concluído',rejected:'Rejeitada',cancelled:'Cancelada'};
const typeLabel={standard:'Padrão',normal:'Normal',emergency:'Emergencial'};
const riskLabel={low:'Baixo',medium:'Médio',high:'Alto',critical:'Crítico'};
const fmt=value=>value?new Date(value).toLocaleString('pt-BR'):'Não definida';
const initial={title:'',description:'',reason:'',changeType:'normal',impact:'',executionPlan:'',validationPlan:'',rollbackPlan:'',windowStart:'',windowEnd:'',assignedTo:'',deviceIds:[]};

export default function Changes({isAdmin=false}){
  const [data,setData]=useState({rows:[],summary:{}});
  const [devices,setDevices]=useState([]);
  const [filter,setFilter]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(null);
  const [form,setForm]=useState(null);
  const [detail,setDetail]=useState(null);
  const toast=useToast();

  const load=async()=>{
    setLoading(true);
    try{
      const [changes,deviceRows]=await Promise.all([api.getChanges(filter?{status:filter}:{}),api.getDevices()]);
      setData(changes.data);setDevices(deviceRows.data.filter(item=>item.isActive&&['mikrotik','huawei_vrp'].includes(item.type)));
    }catch(error){toast(error.message,'error');}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[filter]);
  const openDetail=async id=>{try{setDetail((await api.getChange(id)).data);}catch(error){toast(error.message,'error');}};
  const save=async()=>{
    setBusy('save');
    try{const result=await api.createChange(form);toast(result.message,'success');setForm(null);await load();await openDetail(result.data.id);}
    catch(error){toast(error.message,'error');}finally{setBusy(null);}
  };
  const action=async(name,request,confirmText)=>{
    if(confirmText&&!window.confirm(confirmText))return;
    setBusy(name);
    try{const result=await request();toast(result.message||'Operação concluída.','success');setDetail(result.data);await load();}
    catch(error){toast(error.message,'error');}finally{setBusy(null);}
  };
  const reject=()=>{
    const reason=window.prompt('Informe o motivo da rejeição:');
    if(reason)action('reject',()=>api.approveChange(detail.id,false,reason));
  };
  const toggleDevice=id=>setForm(value=>({...value,deviceIds:value.deviceIds.includes(id)?value.deviceIds.filter(item=>item!==id):[...value.deviceIds,id]}));
  const total=data.rows.length;
  const approved=(data.summary.approved||0)+(data.summary.in_progress||0);
  const failed=data.summary.failed_validation||0;

  return <div>
    <div className="page-header page-header-actions"><div><h2>Gestão de Mudanças</h2><p>Planejamento, risco, aprovação, execução controlada e evidências pós-mudança</p></div><div><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button><button className="btn btn-primary" onClick={()=>setForm({...initial})}><Plus size={16}/> Nova mudança</button></div></div>
    <div className="stats-grid change-stats">
      <div className="stat-card"><ClipboardList/><div><span className="stat-label">Total</span><div className="stat-value">{total}</div></div></div>
      <div className="stat-card"><CalendarClock/><div><span className="stat-label">Aguardando aprovação</span><div className="stat-value">{data.summary.awaiting_approval||0}</div></div></div>
      <div className="stat-card"><Play/><div><span className="stat-label">Aprovadas/em execução</span><div className="stat-value">{approved}</div></div></div>
      <div className="stat-card"><AlertTriangle/><div><span className="stat-label">Falhas de validação</span><div className="stat-value">{failed}</div></div></div>
    </div>
    <div className="card change-filter"><div><label className="form-label">Estado</label><select className="form-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><div className="change-legend"><span><i className="risk-low"/>Baixo</span><span><i className="risk-medium"/>Médio</span><span><i className="risk-high"/>Alto</span><span><i className="risk-critical"/>Crítico</span></div></div>
    {loading?<div className="loading-screen" style={{minHeight:240}}><div className="spinner"/></div>:!data.rows.length?<div className="card empty-state"><ClipboardList/><p>Nenhuma mudança encontrada.</p></div>:<div className="change-grid">{data.rows.map(item=><article className={`card change-card risk-${item.riskLevel}`} key={item.id} onClick={()=>openDetail(item.id)}>
      <div className="change-card-top"><span className="change-number">RFC-{String(item.number).padStart(5,'0')}</span><span className={`status-badge change-status-${item.status}`}>{statusLabel[item.status]||item.status}</span></div>
      <h3>{item.title}</h3><p>{item.description}</p>
      <div className="change-meta"><span>{typeLabel[item.changeType]}</span><span className={`change-risk risk-${item.riskLevel}`}>{riskLabel[item.riskLevel]} · {item.riskScore}</span><span>{item.devices.length} equipamento(s)</span></div>
      <div className="change-window"><CalendarClock size={14}/><span>{item.changeType==='emergency'?'Execução emergencial':`${fmt(item.windowStart)} — ${fmt(item.windowEnd)}`}</span><Eye size={15}/></div>
    </article>)}</div>}

    {form&&<div className="modal-overlay" onClick={()=>setForm(null)}><div className="modal change-create-modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><div><h3>Nova solicitação de mudança</h3><p>Documente a RFC antes de submetê-la para aprovação</p></div><button className="btn btn-ghost" onClick={()=>setForm(null)}><X size={18}/></button></div><div className="change-form">
      <div className="form-row"><div className="form-group"><label className="form-label">Título</label><input className="form-input" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div><div className="form-group"><label className="form-label">Tipo</label><select className="form-select" value={form.changeType} onChange={e=>setForm({...form,changeType:e.target.value})}><option value="standard">Padrão</option><option value="normal">Normal</option><option value="emergency">Emergencial</option></select></div></div>
      <div className="form-group"><label className="form-label">Descrição e objetivo</label><textarea className="form-textarea" rows="3" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
      <div className="form-row"><div className="form-group"><label className="form-label">Motivo</label><textarea className="form-textarea" rows="3" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></div><div className="form-group"><label className="form-label">Impacto esperado</label><textarea className="form-textarea" rows="3" value={form.impact} onChange={e=>setForm({...form,impact:e.target.value})}/></div></div>
      <div className="form-group"><label className="form-label">Equipamentos</label><div className="change-device-picker">{devices.map(device=><label key={device.id}><input type="checkbox" checked={form.deviceIds.includes(device.id)} onChange={()=>toggleDevice(device.id)}/><span><strong>{device.name}</strong><small>{device.hostname} · {device.type}</small></span></label>)}</div></div>
      {form.changeType!=='emergency'&&<div className="form-row"><div className="form-group"><label className="form-label">Início da janela</label><input className="form-input" type="datetime-local" value={form.windowStart} onChange={e=>setForm({...form,windowStart:e.target.value})}/></div><div className="form-group"><label className="form-label">Fim da janela</label><input className="form-input" type="datetime-local" value={form.windowEnd} onChange={e=>setForm({...form,windowEnd:e.target.value})}/></div></div>}
      <div className="form-group"><label className="form-label">Plano de execução</label><textarea className="form-textarea" rows="5" value={form.executionPlan} onChange={e=>setForm({...form,executionPlan:e.target.value})} placeholder="Etapas, comandos previstos, responsáveis e critérios de interrupção..."/></div>
      <div className="form-row"><div className="form-group"><label className="form-label">Plano de validação</label><textarea className="form-textarea" rows="4" value={form.validationPlan} onChange={e=>setForm({...form,validationPlan:e.target.value})}/></div><div className="form-group"><label className="form-label">Plano de rollback</label><textarea className="form-textarea" rows="4" value={form.rollbackPlan} onChange={e=>setForm({...form,rollbackPlan:e.target.value})}/></div></div>
      <div className="form-group"><label className="form-label">Responsável</label><input className="form-input" value={form.assignedTo} onChange={e=>setForm({...form,assignedTo:e.target.value})}/></div>
    </div><div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setForm(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy==='save'} onClick={save}>{busy==='save'?<span className="spinner"/>:<Plus size={15}/>} Criar RFC</button></div></div></div>}

    {detail&&<div className="modal-overlay" onClick={()=>setDetail(null)}><div className="modal change-detail-modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><div><h3>RFC-{String(detail.number).padStart(5,'0')} · {detail.title}</h3><p>{typeLabel[detail.changeType]} · solicitada por {detail.requestedBy}</p></div><button className="btn btn-ghost" onClick={()=>setDetail(null)}><X size={18}/></button></div>
      <div className="change-detail-head"><div className={`change-risk-panel risk-${detail.riskLevel}`}><strong>{riskLabel[detail.riskLevel]}</strong><span>Risco calculado {detail.riskScore}/100</span></div><div><span className={`status-badge change-status-${detail.status}`}>{statusLabel[detail.status]}</span><small>Janela: {detail.changeType==='emergency'?'emergencial':`${fmt(detail.windowStart)} — ${fmt(detail.windowEnd)}`}</small></div></div>
      <div className="change-detail-grid">{[['Objetivo',detail.description],['Motivo',detail.reason],['Impacto',detail.impact],['Plano de execução',detail.executionPlan],['Plano de validação',detail.validationPlan],['Plano de rollback',detail.rollbackPlan]].map(([label,value])=><section key={label}><h4>{label}</h4><pre>{value}</pre></section>)}</div>
      <h4 className="change-section-title">Equipamentos e evidências</h4><div className="change-device-results">{detail.devices.map(item=><div key={item.id}><div><strong>{item.device.name}</strong><span>{item.device.hostname} · {item.device.type}</span></div><small>Antes: {item.beforeBackupId?'capturado':'pendente'} · Depois: {item.afterBackupId?'capturado':'pendente'} · Compliance: {item.validationStatus||'pendente'}</small>{item.validationDetail&&<p>{item.validationDetail}</p>}</div>)}</div>
      {detail.validationSummary&&<div className={`change-validation-summary ${detail.status==='completed'?'success':'danger'}`}><strong>Resultado da validação</strong><pre>{detail.validationSummary}</pre></div>}
      <h4 className="change-section-title">Linha do tempo</h4><div className="change-timeline">{detail.events.map(event=><div key={event.id}><i/><div><strong>{event.action.replaceAll('_',' ')}</strong><span>{event.actor} · {fmt(event.createdAt)}</span></div></div>)}</div>
      <div className="modal-footer change-actions">
        {['draft','rejected'].includes(detail.status)&&<button className="btn btn-primary" disabled={busy} onClick={()=>action('submit',()=>api.submitChange(detail.id))}><Send size={15}/> Enviar para aprovação</button>}
        {isAdmin&&detail.status==='awaiting_approval'&&<><button className="btn btn-secondary" disabled={busy} onClick={reject}><XCircle size={15}/> Rejeitar</button><button className="btn btn-primary" disabled={busy} onClick={()=>action('approve',()=>api.approveChange(detail.id,true),'Aprovar a mudança e capturar backups prévios?')}><ShieldCheck size={15}/> Aprovar e preparar</button></>}
        {detail.status==='approved'&&<button className="btn btn-primary" disabled={busy} onClick={()=>action('start',()=>api.startChange(detail.id),'Iniciar a janela desta mudança?')}><Play size={15}/> Iniciar execução</button>}
        {['in_progress','failed_validation'].includes(detail.status)&&<button className="btn btn-primary" disabled={busy} onClick={()=>action('validate',()=>api.validateChange(detail.id),'Capturar configuração posterior e executar validação de Compliance?')}><CheckCircle2 size={15}/> Validar mudança</button>}
        {isAdmin&&['in_progress','failed_validation','completed'].includes(detail.status)&&<button className="btn btn-danger" disabled={busy} onClick={()=>action('rollback',()=>api.rollbackChange(detail.id),'Criar Tasks críticas de rollback? Nenhum comando será executado sem nova aprovação.')}><RotateCcw size={15}/> Solicitar rollback</button>}
      </div>
    </div></div>}
  </div>;
}
