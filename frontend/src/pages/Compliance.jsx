import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Download, Eye, FileText, Play, Plus, RefreshCw, Save, Settings2, ShieldAlert, ShieldCheck, Trash2, Wrench, X, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const week = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const date = value => value ? new Date(value).toLocaleString('pt-BR') : 'Nunca';
const typeLabel = { mikrotik: 'MikroTik RouterOS', huawei_vrp: 'Huawei VRP' };
const severityLabel = { critical:'Crítica', high:'Alta', medium:'Média', low:'Baixa' };
const exceptionState = { active:'Ativa', scheduled:'Agendada', expired:'Vencida', revoked:'Revogada' };
const localDateTime = value => {
  const dateValue = value ? new Date(value) : new Date(Date.now()+7*86400000);
  const offset = dateValue.getTimezoneOffset();
  return new Date(dateValue.getTime()-offset*60000).toISOString().slice(0,16);
};
const isoDay = value => new Date(value).toISOString().slice(0,10);

function Score({ value }) {
  if (value === null || value === undefined) return <span className="compliance-score empty">—</span>;
  const tone = value >= 80 ? 'good' : value >= 60 ? 'warning' : 'bad';
  return <span className={`compliance-score ${tone}`}>{value}%</span>;
}

export default function Compliance() {
  const [data, setData] = useState({ devices:[], summary:{} });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [policyDevice, setPolicyDevice] = useState(null);
  const [policy, setPolicy] = useState({ enabled:true, frequency:'daily', hour:3, weekday:1, alertEnabled:true, minimumScore:80 });
  const [detail, setDetail] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [newProfile, setNewProfile] = useState({name:'',description:'',deviceType:'mikrotik',minimumScore:80});
  const [exceptions, setExceptions] = useState([]);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [exceptionDraft, setExceptionDraft] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFilter, setReportFilter] = useState({from:isoDay(Date.now()-30*86400000),to:isoDay(new Date()),deviceId:''});
  const [reportSummary, setReportSummary] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [remediationBusy, setRemediationBusy] = useState(null);
  const [governanceOpen,setGovernanceOpen]=useState(false);
  const [governance,setGovernance]=useState({scopes:[],packages:[],integrity:{},escalation:{}});
  const [scopeDraft,setScopeDraft]=useState({name:'',deviceGroup:'',deviceRole:'',profileId:'',minimumScore:80,priority:100});
  const [escalation,setEscalation]=useState({level1Hours:4,level2Hours:12,level3Hours:24});
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [overview, profileRows, exceptionRows] = await Promise.all([api.getCompliance(),api.getComplianceProfiles(),api.getComplianceExceptions()]);
      setData(overview.data); setProfiles(profileRows.data); setExceptions(exceptionRows.data);
    }
    catch (error) { toast(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openPolicy = device => {
    setPolicyDevice(device);
    setPolicy(device.compliancePolicy ? {
      enabled:device.compliancePolicy.enabled,
      frequency:device.compliancePolicy.frequency,
      hour:device.compliancePolicy.hour,
      weekday:device.compliancePolicy.weekday,
      alertEnabled:device.compliancePolicy.alertEnabled,
      minimumScore:device.compliancePolicy.minimumScore,
      profileId:device.compliancePolicy.profileId || profiles.find(item=>item.deviceType===device.type&&item.isSystem)?.id || '',
    } : { enabled:true, frequency:'daily', hour:3, weekday:1, alertEnabled:true, minimumScore:80, profileId:profiles.find(item=>item.deviceType===device.type&&item.isSystem)?.id || '' });
  };
  const savePolicy = async () => {
    setBusyId(policyDevice.id);
    try { await api.saveCompliancePolicy(policyDevice.id, policy); toast('Política de compliance salva.', 'success'); setPolicyDevice(null); await load(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setBusyId(null); }
  };
  const scan = async device => {
    if (!window.confirm(`Executar verificação somente leitura em ${device.name}?`)) return;
    setBusyId(device.id);
    try {
      const result = await api.runComplianceScan(device.id);
      toast(`Verificação concluída: ${result.data.score}% de conformidade.`, result.data.score >= 80 ? 'success' : 'info');
      setDetail(result.data);
      await load();
    } catch (error) { toast(error.message, 'error'); await load(); }
    finally { setBusyId(null); }
  };
  const openScan = async id => {
    try { setDetail((await api.getComplianceScan(id)).data); }
    catch (error) { toast(error.message, 'error'); }
  };
  const removeScan = async () => {
    if (!window.confirm('Excluir este resultado de compliance?')) return;
    try { await api.deleteComplianceScan(detail.id); setDetail(null); toast('Resultado removido.', 'success'); await load(); }
    catch (error) { toast(error.message, 'error'); }
  };
  const createProfile = async () => {
    try {
      const created=(await api.createComplianceProfile(newProfile)).data;
      toast('Perfil criado a partir do baseline padrão.', 'success');
      setNewProfile({name:'',description:'',deviceType:'mikrotik',minimumScore:80});
      await load(); setEditingProfile(created);
    } catch(error){toast(error.message,'error');}
  };
  const saveProfile = async () => {
    try { const saved=(await api.updateComplianceProfile(editingProfile.id,editingProfile)).data; toast('Perfil e regras salvos.','success'); setEditingProfile(saved); await load(); }
    catch(error){toast(error.message,'error');}
  };
  const removeProfile = async profile => {
    if(!window.confirm(`Excluir o perfil ${profile.name}?`))return;
    try{await api.deleteComplianceProfile(profile.id);toast('Perfil excluído.','success');setEditingProfile(null);await load();}
    catch(error){toast(error.message,'error');}
  };
  const updateRule = (index, field, value) => setEditingProfile({...editingProfile,rules:editingProfile.rules.map((rule,i)=>i===index?{...rule,[field]:value}:rule)});
  const openException = finding => setExceptionDraft({deviceId:detail.deviceId,ruleKey:finding.ruleKey,title:finding.title,reason:'',startsAt:localDateTime(new Date()),expiresAt:localDateTime()});
  const createException = async () => {
    try { await api.createComplianceException(exceptionDraft); toast('Exceção registrada. Execute uma nova verificação para aplicá-la.','success'); setExceptionDraft(null); await load(); }
    catch(error){toast(error.message,'error');}
  };
  const revokeException = async item => {
    if(!window.confirm(`Revogar a exceção para ${item.ruleKey}?`))return;
    try{await api.revokeComplianceException(item.id);toast('Exceção revogada.','success');await load();}
    catch(error){toast(error.message,'error');}
  };
  const previewReport = async () => {
    setReportBusy(true);
    try{setReportSummary((await api.getComplianceReport(reportFilter)).data.summary);}
    catch(error){toast(error.message,'error');}
    finally{setReportBusy(false);}
  };
  const downloadReport = async format => {
    setReportBusy(true);
    try{const result=await api.downloadComplianceReport(format,reportFilter);const link=document.createElement('a');link.href=URL.createObjectURL(result.blob);link.download=result.filename;link.click();URL.revokeObjectURL(link.href);toast(`Relatório ${format.toUpperCase()} gerado.`,'success');}
    catch(error){toast(error.message,'error');}
    finally{setReportBusy(false);}
  };
  const createRemediationTask = async finding => {
    setRemediationBusy(finding.id);
    try{const result=await api.createComplianceRemediationTask(finding.id);toast(result.message||'Task de correção criada.','success');}
    catch(error){toast(error.message,'error');}
    finally{setRemediationBusy(null);}
  };
  const openGovernance=async()=>{
    try{
      const result=(await api.getComplianceGovernance()).data;
      setGovernance(result);
      setEscalation({
        level1Hours:Number(result.escalation.compliance_escalation_level1_hours)||4,
        level2Hours:Number(result.escalation.compliance_escalation_level2_hours)||12,
        level3Hours:Number(result.escalation.compliance_escalation_level3_hours)||24,
      });
      setGovernanceOpen(true);
    }catch(error){toast(error.message,'error');}
  };
  const saveEscalation=async()=>{
    try{await api.saveComplianceEscalation(escalation);toast('Escalonamento salvo.','success');await openGovernance();}
    catch(error){toast(error.message,'error');}
  };
  const createScope=async()=>{
    try{await api.createComplianceScope(scopeDraft);toast('Política organizacional criada.','success');setScopeDraft({name:'',deviceGroup:'',deviceRole:'',profileId:'',minimumScore:80,priority:100});await openGovernance();}
    catch(error){toast(error.message,'error');}
  };
  const deleteScope=async item=>{
    if(!window.confirm(`Excluir a política ${item.name}?`))return;
    try{await api.deleteComplianceScope(item.id);toast('Política excluída.','success');await openGovernance();}
    catch(error){toast(error.message,'error');}
  };

  const summary = data.summary || {};
  return <div>
    <div className="page-header page-header-actions"><div><h2>Compliance de configurações</h2><p>Baseline de segurança somente leitura para MikroTik e Huawei</p></div><div><button className="btn btn-secondary" onClick={openGovernance}><ShieldAlert size={15}/> Governança</button><button className="btn btn-secondary" onClick={()=>{setReportOpen(true);setTimeout(previewReport,0);}}><FileText size={15}/> Relatórios</button><button className="btn btn-secondary" onClick={()=>setExceptionsOpen(true)}><ShieldCheck size={15}/> Exceções ({data.summary?.activeExceptions||0})</button><button className="btn btn-secondary" onClick={()=>setProfilesOpen(true)}><Settings2 size={15}/> Perfis e regras</button><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button></div></div>
    <div className="compliance-notice"><ShieldAlert size={20}/><div><strong>Verificação segura e sem alterações</strong><span>O sistema consulta a configuração, registra evidências e apresenta recomendações. Nenhum comando de correção é aplicado automaticamente.</span></div></div>
    <div className="stats-grid compliance-stats">
      <div className="stat-card"><ClipboardCheck/><div><span>Compatíveis</span><strong>{summary.devices || 0}</strong></div></div>
      <div className="stat-card"><CalendarClock/><div><span>Monitorados</span><strong>{summary.monitored || 0}</strong></div></div>
      <div className="stat-card"><CheckCircle2/><div><span>Média atual</span><strong>{summary.averageScore || 0}%</strong></div></div>
      <div className="stat-card"><AlertTriangle/><div><span>Abaixo de 80%</span><strong>{summary.nonCompliant || 0}</strong></div></div>
    </div>
    <div className="card">
      <div className="table-container"><table><thead><tr><th>Equipamento</th><th>Perfil</th><th>Agendamento</th><th>Última verificação</th><th>Resultado</th><th></th></tr></thead><tbody>
        {data.devices.map(device => {
          const latest = device.complianceScans?.[0];
          const configured = device.compliancePolicy?.enabled;
          return <tr key={device.id}><td><strong>{device.name}</strong><br/><span className="knowledge-muted">{device.hostname} · {typeLabel[device.type] || device.type}</span></td><td><code>{device.compliancePolicy?.profile || latest?.profile || data.profile}</code></td><td>{configured ? <><span className="status-badge status-completed">Ativo</span><br/><span className="knowledge-muted">{device.compliancePolicy.frequency === 'weekly' ? `${week[device.compliancePolicy.weekday]}, ` : 'Diário, '}{String(device.compliancePolicy.hour).padStart(2,'0')}:00</span></> : <span className="status-badge">Desativado</span>}</td><td>{latest ? <>{date(latest.startedAt)}<br/><span className="knowledge-muted">{latest.regressions ? `↓ ${latest.regressions} regressão(ões)` : latest.recoveries ? `↑ ${latest.recoveries} recuperação(ões)` : latest.type === 'automatic' ? 'Automática' : 'Manual'}</span></> : 'Nunca'}</td><td>{latest?.status === 'failed' ? <span className="status-badge status-failed" title={latest.error}>Falhou</span> : <><Score value={latest?.score}/>{latest?.previousScore!==null&&latest?.previousScore!==undefined&&latest.previousScore!==latest.score&&<span className={latest.score>latest.previousScore?'compliance-delta up':'compliance-delta down'}>{latest.score>latest.previousScore?'↑':'↓'} {Math.abs(latest.score-latest.previousScore)}</span>}</>}</td><td><div className="table-actions">{latest&&<button className="btn btn-ghost btn-sm" title="Ver evidências" onClick={()=>openScan(latest.id)}><Eye size={15}/></button>}<button className="btn btn-secondary btn-sm" onClick={()=>openPolicy(device)}><CalendarClock size={14}/> Política</button><button className="btn btn-primary btn-sm" disabled={busyId===device.id} onClick={()=>scan(device)}>{busyId===device.id?<span className="spinner"/>:<Play size={14}/>} Verificar</button></div></td></tr>;
        })}
        {!loading&&!data.devices.length&&<tr><td colSpan="6">Nenhum equipamento MikroTik ou Huawei ativo.</td></tr>}
        {loading&&<tr><td colSpan="6">Carregando...</td></tr>}
      </tbody></table></div>
    </div>

    {policyDevice&&<div className="modal-overlay" onClick={()=>setPolicyDevice(null)}><div className="modal compliance-policy-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Política de compliance</h3><p>{policyDevice.name}</p></div><button className="btn btn-ghost" onClick={()=>setPolicyDevice(null)}><X size={18}/></button></div>
      <div className="form-row"><div className="form-group"><label className="form-label">Monitoramento</label><select className="form-select" value={String(policy.enabled)} onChange={e=>setPolicy({...policy,enabled:e.target.value==='true'})}><option value="true">Ativado</option><option value="false">Desativado</option></select></div><div className="form-group"><label className="form-label">Frequência</label><select className="form-select" value={policy.frequency} onChange={e=>setPolicy({...policy,frequency:e.target.value})}><option value="daily">Diária</option><option value="weekly">Semanal</option></select></div></div>
      <div className="form-row"><div className="form-group"><label className="form-label">Horário</label><input className="form-input" type="number" min="0" max="23" value={policy.hour} onChange={e=>setPolicy({...policy,hour:Number(e.target.value)})}/></div>{policy.frequency==='weekly'&&<div className="form-group"><label className="form-label">Dia</label><select className="form-select" value={policy.weekday} onChange={e=>setPolicy({...policy,weekday:Number(e.target.value)})}>{week.map((label,index)=><option value={index} key={label}>{label}</option>)}</select></div>}</div>
      <div className="form-row"><div className="form-group"><label className="form-label">Alertas e Tasks</label><select className="form-select" value={String(policy.alertEnabled)} onChange={e=>setPolicy({...policy,alertEnabled:e.target.value==='true'})}><option value="true">Ativados</option><option value="false">Desativados</option></select></div><div className="form-group"><label className="form-label">Pontuação mínima</label><input className="form-input" type="number" min="1" max="100" value={policy.minimumScore} onChange={e=>setPolicy({...policy,minimumScore:Number(e.target.value)})}/></div></div>
      <div className="form-group"><label className="form-label">Perfil aplicado</label><select className="form-select" value={policy.profileId || ''} onChange={e=>setPolicy({...policy,profileId:e.target.value})}>{profiles.filter(item=>item.deviceType===policyDevice.type).map(item=><option key={item.id} value={item.id}>{item.name}{item.isSystem?' (padrão)':''}</option>)}</select></div>
      <div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setPolicyDevice(null)}>Cancelar</button><button className="btn btn-primary" disabled={busyId===policyDevice.id} onClick={savePolicy}><Save size={15}/> Salvar política</button></div>
    </div></div>}

    {detail&&<div className="modal-overlay" onClick={()=>setDetail(null)}><div className="modal compliance-detail-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Resultado da verificação</h3><p>{detail.device?.name || data.devices.find(item=>item.id===detail.deviceId)?.name} · {date(detail.startedAt)}</p></div><button className="btn btn-ghost" onClick={()=>setDetail(null)}><X size={18}/></button></div>
      <div className="compliance-result-head"><Score value={detail.score}/><div><strong>{detail.passed || 0} controles atendidos</strong><span>{detail.failed || 0} não conformidades · {detail.regressions || 0} regressões · {detail.recoveries || 0} recuperações</span></div><button className="btn btn-ghost btn-sm" onClick={removeScan}><Trash2 size={15}/> Excluir</button></div>
      <div className="compliance-findings">{(detail.findings || []).map(item=><article className={`compliance-finding ${item.status} ${item.change || ''}`} key={item.id || item.ruleKey}><div className="compliance-finding-icon">{item.status!=='non_compliant'?<CheckCircle2/>:<XCircle/>}</div><div><div className="compliance-finding-title"><strong>{item.title}</strong>{item.status==='excepted'&&<span className="compliance-change excepted">Exceção aceita</span>}{item.change==='regressed'&&<span className="compliance-change regressed">Regressão</span>}{item.change==='recovered'&&<span className="compliance-change recovered">Recuperado</span>}{item.change==='new_non_compliant'&&<span className="compliance-change regressed">Novo desvio</span>}<span className={`severity severity-${item.severity}`}>{severityLabel[item.severity]}</span><span>{item.category}</span></div><p>{item.status==='compliant'?'Controle atendido.':item.status==='excepted'?'Controle coberto por uma exceção temporária válida.':item.recommendation}</p><details><summary>Ver evidência e orientação técnica</summary><div className="compliance-evidence"><label>Evidência coletada</label><pre>{item.evidence}</pre>{item.status==='non_compliant'&&<><label>Prévia de correção — não executada</label><pre>{item.remediationPreview}</pre></>}</div></details>{item.status==='non_compliant'&&<div className="compliance-finding-actions"><button className="btn btn-secondary btn-sm" onClick={()=>openException(item)}><ShieldCheck size={14}/> Aceitar temporariamente</button><button className="btn btn-primary btn-sm" disabled={remediationBusy===item.id} onClick={()=>createRemediationTask(item)}>{remediationBusy===item.id?<span className="spinner"/>:<Wrench size={14}/>} Criar Task de correção</button></div>}</div></article>)}</div>
    </div></div>}

    {profilesOpen&&<div className="modal-overlay" onClick={()=>{setProfilesOpen(false);setEditingProfile(null);}}><div className="modal compliance-profiles-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Perfis e regras</h3><p>Personalize controles por fabricante sem alterar os equipamentos</p></div><button className="btn btn-ghost" onClick={()=>{setProfilesOpen(false);setEditingProfile(null);}}><X size={18}/></button></div>
      {!editingProfile?<><div className="compliance-profile-create"><input className="form-input" placeholder="Nome do novo perfil" value={newProfile.name} onChange={e=>setNewProfile({...newProfile,name:e.target.value})}/><select className="form-select" value={newProfile.deviceType} onChange={e=>setNewProfile({...newProfile,deviceType:e.target.value})}><option value="mikrotik">MikroTik RouterOS</option><option value="huawei_vrp">Huawei VRP</option></select><button className="btn btn-primary" onClick={createProfile}><Plus size={15}/> Criar</button></div><div className="compliance-profile-list">{profiles.map(profile=><button key={profile.id} onClick={()=>setEditingProfile(structuredClone(profile))}><div><strong>{profile.name}</strong><span>{typeLabel[profile.deviceType]} · {profile.rules.filter(rule=>rule.enabled).length} regras ativas · meta {profile.minimumScore}%</span></div>{profile.isSystem&&<span className="status-badge status-completed">Padrão</span>}</button>)}</div></>:<>
        <div className="compliance-profile-editor-head"><button className="btn btn-ghost btn-sm" onClick={()=>setEditingProfile(null)}>← Voltar</button><div className="form-row"><div className="form-group"><label className="form-label">Nome</label><input className="form-input" disabled={editingProfile.isSystem} value={editingProfile.name} onChange={e=>setEditingProfile({...editingProfile,name:e.target.value})}/></div><div className="form-group"><label className="form-label">Pontuação mínima</label><input className="form-input" type="number" min="1" max="100" value={editingProfile.minimumScore} onChange={e=>setEditingProfile({...editingProfile,minimumScore:Number(e.target.value)})}/></div></div><div className="form-group"><label className="form-label">Descrição</label><input className="form-input" value={editingProfile.description || ''} onChange={e=>setEditingProfile({...editingProfile,description:e.target.value})}/></div></div>
        <div className="compliance-rule-editor">{editingProfile.rules.map((rule,index)=><article key={rule.id}><div className="compliance-rule-toggle"><input type="checkbox" checked={rule.enabled} onChange={e=>updateRule(index,'enabled',e.target.checked)}/><div><strong>{rule.title}</strong><span>{rule.category} · {rule.ruleKey}</span></div><select className="form-select" value={rule.severity} onChange={e=>updateRule(index,'severity',e.target.value)}><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option></select></div><div className="form-group"><label className="form-label">Valores obrigatórios na configuração <small>(opcional, separados por vírgula)</small></label><input className="form-input" placeholder="Ex.: 10.0.0.10, pool.ntp.org" value={rule.expectedValue || ''} onChange={e=>updateRule(index,'expectedValue',e.target.value)}/></div><div className="form-group"><label className="form-label">Recomendação</label><textarea className="form-textarea" rows="2" value={rule.recommendation} onChange={e=>updateRule(index,'recommendation',e.target.value)}/></div></article>)}</div>
        <div className="modal-footer">{!editingProfile.isSystem&&<button className="btn btn-ghost" style={{color:'var(--danger)',marginRight:'auto'}} onClick={()=>removeProfile(editingProfile)}><Trash2 size={15}/> Excluir</button>}<button className="btn btn-primary" onClick={saveProfile}><Save size={15}/> Salvar perfil</button></div>
      </>}
    </div></div>}

    {exceptionsOpen&&<div className="modal-overlay" onClick={()=>setExceptionsOpen(false)}><div className="modal compliance-exceptions-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Exceções de compliance</h3><p>Aceites temporários, responsáveis e vencimentos</p></div><button className="btn btn-ghost" onClick={()=>setExceptionsOpen(false)}><X size={18}/></button></div><div className="table-container"><table><thead><tr><th>Equipamento/controle</th><th>Justificativa</th><th>Responsável</th><th>Vencimento</th><th>Status</th><th></th></tr></thead><tbody>{exceptions.map(item=><tr key={item.id}><td><strong>{item.device.name}</strong><br/><code>{item.ruleKey}</code></td><td className="compliance-reason">{item.reason}</td><td>{item.approvedBy}</td><td>{date(item.expiresAt)}</td><td><span className={`status-badge exception-${item.state}`}>{exceptionState[item.state]}</span></td><td>{['active','scheduled'].includes(item.state)&&<button className="btn btn-ghost btn-sm" title="Revogar" onClick={()=>revokeException(item)}><Trash2 size={15}/></button>}</td></tr>)}{!exceptions.length&&<tr><td colSpan="6">Nenhuma exceção registrada.</td></tr>}</tbody></table></div></div></div>}

    {exceptionDraft&&<div className="modal-overlay" onClick={()=>setExceptionDraft(null)}><div className="modal compliance-exception-create" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Aceitar não conformidade</h3><p>{exceptionDraft.title}</p></div><button className="btn btn-ghost" onClick={()=>setExceptionDraft(null)}><X size={18}/></button></div><div className="compliance-exception-warning"><AlertTriangle size={18}/><span>A exceção não corrige o equipamento. Ela suspende temporariamente a penalização e os alertas deste controle.</span></div><div className="form-group"><label className="form-label">Justificativa obrigatória</label><textarea className="form-textarea" rows="4" value={exceptionDraft.reason} onChange={e=>setExceptionDraft({...exceptionDraft,reason:e.target.value})} placeholder="Explique o motivo operacional, risco aceito e plano de correção..."/></div><div className="form-row"><div className="form-group"><label className="form-label">Início</label><input className="form-input" type="datetime-local" value={exceptionDraft.startsAt} onChange={e=>setExceptionDraft({...exceptionDraft,startsAt:e.target.value})}/></div><div className="form-group"><label className="form-label">Vencimento</label><input className="form-input" type="datetime-local" value={exceptionDraft.expiresAt} onChange={e=>setExceptionDraft({...exceptionDraft,expiresAt:e.target.value})}/></div></div><div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setExceptionDraft(null)}>Cancelar</button><button className="btn btn-primary" onClick={createException}><ShieldCheck size={15}/> Aprovar exceção</button></div></div></div>}

    {reportOpen&&<div className="modal-overlay" onClick={()=>setReportOpen(false)}><div className="modal compliance-report-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Relatório de Compliance</h3><p>Documento de auditoria com verificações, evidências e exceções</p></div><button className="btn btn-ghost" onClick={()=>setReportOpen(false)}><X size={18}/></button></div><div className="form-row"><div className="form-group"><label className="form-label">Data inicial</label><input className="form-input" type="date" value={reportFilter.from} onChange={e=>setReportFilter({...reportFilter,from:e.target.value})}/></div><div className="form-group"><label className="form-label">Data final</label><input className="form-input" type="date" value={reportFilter.to} onChange={e=>setReportFilter({...reportFilter,to:e.target.value})}/></div></div><div className="form-group"><label className="form-label">Equipamento</label><select className="form-select" value={reportFilter.deviceId} onChange={e=>setReportFilter({...reportFilter,deviceId:e.target.value})}><option value="">Todos os equipamentos</option>{data.devices.map(device=><option key={device.id} value={device.id}>{device.name} · {device.hostname}</option>)}</select></div><button className="btn btn-secondary btn-sm" onClick={previewReport} disabled={reportBusy}><RefreshCw size={14}/> Atualizar prévia</button>{reportSummary&&<div className="compliance-report-summary">{[['Verificações',reportSummary.scans],['Equipamentos',reportSummary.devices],['Média',`${reportSummary.averageScore}%`],['Desvios',reportSummary.nonCompliant],['Regressões',reportSummary.regressions],['Exceções',reportSummary.exceptions]].map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>}<div className="compliance-report-info"><FileText size={18}/><span>O pacote de auditoria inclui evidências, hashes das configurações e verificação da trilha de auditoria.</span></div><div className="modal-footer"><button className="btn btn-secondary" onClick={()=>downloadReport('package')} disabled={reportBusy}><ShieldCheck size={15}/> Pacote auditável</button><button className="btn btn-secondary" onClick={()=>downloadReport('csv')} disabled={reportBusy}><Download size={15}/> Baixar CSV</button><button className="btn btn-primary" onClick={()=>downloadReport('pdf')} disabled={reportBusy}>{reportBusy?<span className="spinner"/>:<Download size={15}/>} Baixar PDF</button></div></div></div>}

    {governanceOpen&&<div className="modal-overlay" onClick={()=>setGovernanceOpen(false)}><div className="modal compliance-governance-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Governança de Compliance</h3><p>Integridade, escalonamento e políticas organizacionais</p></div><button className="btn btn-ghost" onClick={()=>setGovernanceOpen(false)}><X size={18}/></button></div>
      <div className={`compliance-integrity ${governance.integrity.valid?'valid':'invalid'}`}><ShieldCheck size={22}/><div><strong>{governance.integrity.valid?'Trilha de auditoria íntegra':'Inconsistência na trilha de auditoria'}</strong><span>{governance.integrity.protectedRecords||0} registros protegidos · {governance.integrity.legacyRecords||0} registros anteriores à cadeia hash</span></div></div>
      <h4>Escalonamento de não conformidades</h4><div className="form-row compliance-escalation-grid">{[1,2,3].map(level=><div className="form-group" key={level}><label className="form-label">Nível {level} — horas</label><input className="form-input" type="number" min="1" value={escalation[`level${level}Hours`]} onChange={e=>setEscalation({...escalation,[`level${level}Hours`]:Number(e.target.value)})}/></div>)}</div><button className="btn btn-secondary btn-sm" onClick={saveEscalation}><Save size={14}/> Salvar escalonamento</button>
      <h4>Políticas por cliente, grupo ou função</h4><div className="compliance-scope-create"><input className="form-input" placeholder="Nome da política" value={scopeDraft.name} onChange={e=>setScopeDraft({...scopeDraft,name:e.target.value})}/><input className="form-input" placeholder="Grupo dos equipamentos" value={scopeDraft.deviceGroup} onChange={e=>setScopeDraft({...scopeDraft,deviceGroup:e.target.value})}/><input className="form-input" placeholder="Função: core, borda..." value={scopeDraft.deviceRole} onChange={e=>setScopeDraft({...scopeDraft,deviceRole:e.target.value})}/><select className="form-select" value={scopeDraft.profileId} onChange={e=>setScopeDraft({...scopeDraft,profileId:e.target.value})}><option value="">Selecione o perfil</option>{profiles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="btn btn-primary" onClick={createScope}><Plus size={14}/> Criar política</button></div>
      <div className="compliance-scope-list">{governance.scopes.map(item=><article key={item.id}><div><strong>{item.name}</strong><span>{item.profile.name} · grupo {item.deviceGroup||'qualquer'} · função {item.deviceRole||'qualquer'} · {item._count.devices} vínculo(s)</span></div><span className={`status-badge ${item.isActive?'status-completed':''}`}>{item.isActive?'Ativa':'Inativa'}</span><button className="btn btn-ghost btn-sm" onClick={()=>deleteScope(item)}><Trash2 size={14}/></button></article>)}{!governance.scopes.length&&<div className="empty-state"><p>Nenhuma política organizacional criada.</p></div>}</div>
    </div></div>}
  </div>;
}
