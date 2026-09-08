import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileClock, Play, Save, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const sla = [['slaCriticalAck','Crítica — reconhecer'],['slaCriticalResolve','Crítica — resolver'],['slaHighAck','Alta — reconhecer'],['slaHighResolve','Alta — resolver'],['slaMediumAck','Média — reconhecer'],['slaMediumResolve','Média — resolver'],['slaLowAck','Baixa — reconhecer'],['slaLowResolve','Baixa — resolver']];
const channels = [['panel','Painel'],['telegram','Telegram'],['whatsapp','WhatsApp']];
const statusLabel = { sent:'Enviado', partial:'Parcial', failed:'Falhou', pending:'Processando' };

export default function TenantContracts() {
  const [tenants,setTenants]=useState([]),[selected,setSelected]=useState(''),[form,setForm]=useState({}),[runs,setRuns]=useState([]),[busy,setBusy]=useState(false);
  const toast=useToast();
  const load=async(preferred=selected)=>{
    try{
      const result=await api.getTenants(),id=preferred||result.data[0]?.id||'';
      setTenants(result.data);setSelected(id);setForm(result.data.find(item=>item.id===id)||{});
      setRuns(id?(await api.getMonthlyReports({tenantId:id,limit:12})).data:[]);
    }catch(e){toast(e.message,'error');}
  };
  useEffect(()=>{load();},[]);
  const choose=id=>load(id);
  const save=async()=>{
    setBusy(true);
    try{
      await api.updateTenant(selected,form);
      await api.saveMonthlyReportConfig(selected,form);
      toast('Contrato, portal e relatório mensal atualizados','success');await load(selected);
    }catch(e){toast(e.message,'error');}finally{setBusy(false);}
  };
  const run=async()=>{setBusy(true);try{await api.runMonthlyReport(selected);toast('Relatório mensal gerado','success');await load(selected);}catch(e){toast(e.message,'error');}finally{setBusy(false);}};
  const download=async item=>{try{const file=await api.downloadMonthlyReport(item.id),url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=file.filename;a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message,'error');}};
  const selectedChannels=String(form.monthlyReportChannels||'panel').split(',').filter(Boolean);
  const toggleChannel=channel=>setForm({...form,monthlyReportChannels:(selectedChannels.includes(channel)?selectedChannels.filter(item=>item!==channel):[...selectedChannels,channel]).join(',')});

  return <div>
    <div className="page-header"><h2>Contratos e Portais</h2><p>SLA, identidade pública e relatórios mensais por cliente</p></div>
    <div className="tenant-contract-layout">
      <aside className="card">{tenants.map(item=><button className={selected===item.id?'active':''} onClick={()=>choose(item.id)} key={item.id}>{item.name}</button>)}</aside>
      {selected&&<main className="card">
        <h3><ShieldCheck size={18}/> {form.name}</h3>
        <h4>Identidade da Status Page</h4>
        <div className="form-row"><input className="form-input" value={form.portalTitle||''} placeholder="Título público" onChange={e=>setForm({...form,portalTitle:e.target.value})}/><input className="form-input" value={form.portalDescription||''} placeholder="Descrição pública" onChange={e=>setForm({...form,portalDescription:e.target.value})}/><input className="form-input" type="color" value={form.primaryColor||'#00d4ff'} onChange={e=>setForm({...form,primaryColor:e.target.value})}/></div>
        <a className="btn btn-secondary" href={`/status/${form.slug}`} target="_blank"><ExternalLink size={14}/> Abrir página pública</a>
        <h4>Política SLA em minutos</h4>
        <div className="tenant-sla-grid">{sla.map(([key,label])=><label key={key}><span>{label}</span><input className="form-input" type="number" min="1" value={form[key]||''} placeholder="Herdar global" onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}</div>

        <h4>Limites mensais de IA</h4>
        <div className="form-row"><label><span className="form-label">Solicitações</span><input className="form-input" type="number" min="0" value={form.aiMonthlyRequestLimit||0} onChange={e=>setForm({...form,aiMonthlyRequestLimit:Number(e.target.value)})}/><small className="knowledge-muted">Zero significa sem limite.</small></label><label><span className="form-label">Tokens</span><input className="form-input" type="number" min="0" value={form.aiMonthlyTokenLimit||0} onChange={e=>setForm({...form,aiMonthlyTokenLimit:Number(e.target.value)})}/><small className="knowledge-muted">Bloqueia novas chamadas ao atingir o limite.</small></label></div>

        <h4><FileClock size={16}/> Relatório mensal automático</h4>
        <label className="knowledge-refresh"><input type="checkbox" checked={Boolean(form.monthlyReportEnabled)} onChange={e=>setForm({...form,monthlyReportEnabled:e.target.checked})}/><span>Gerar o relatório do mês anterior automaticamente</span></label>
        <div className="form-row"><label><span className="form-label">Dia do envio</span><input className="form-input" type="number" min="1" max="28" value={form.monthlyReportDay||1} onChange={e=>setForm({...form,monthlyReportDay:Number(e.target.value)})}/></label><label><span className="form-label">Hora</span><input className="form-input" type="number" min="0" max="23" value={form.monthlyReportHour??8} onChange={e=>setForm({...form,monthlyReportHour:Number(e.target.value)})}/></label><label><span className="form-label">Fuso horário</span><input className="form-input" value={form.monthlyReportTimezone||'America/Porto_Velho'} onChange={e=>setForm({...form,monthlyReportTimezone:e.target.value})}/></label></div>
        <div className="form-group"><span className="form-label">Canais</span><div style={{display:'flex',gap:16,flexWrap:'wrap'}}>{channels.map(([value,label])=><label className="knowledge-refresh" key={value}><input type="checkbox" checked={selectedChannels.includes(value)} onChange={()=>toggleChannel(value)}/><span>{label}</span></label>)}</div></div>
        {selectedChannels.includes('telegram')&&<div className="form-group"><label className="form-label">Chat IDs do Telegram</label><input className="form-input" value={form.monthlyReportTelegramRecipients||''} placeholder="-1001234567890, @grupo" onChange={e=>setForm({...form,monthlyReportTelegramRecipients:e.target.value})}/></div>}
        {selectedChannels.includes('whatsapp')&&<div className="form-group"><label className="form-label">Números do WhatsApp</label><input className="form-input" value={form.monthlyReportWhatsappRecipients||''} placeholder="5569999999999, 5569888888888" onChange={e=>setForm({...form,monthlyReportWhatsappRecipients:e.target.value})}/><small className="knowledge-muted">Se vazio, será usado o telefone cadastrado no contato do cliente.</small></div>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-primary" disabled={busy} onClick={save}><Save size={14}/> Salvar contrato</button><button className="btn btn-secondary" disabled={busy} onClick={run}><Play size={14}/> Gerar agora</button></div>

        <h4>Histórico de relatórios</h4>
        <div className="table-container"><table><thead><tr><th>Competência</th><th>Geração</th><th>Entrega</th><th></th></tr></thead><tbody>{runs.map(item=><tr key={item.id}><td><strong>{item.periodKey}</strong></td><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td><span className={`status-badge ${item.status==='sent'?'status-completed':item.status==='failed'?'status-failed':'status-pending'}`}>{statusLabel[item.status]||item.status}</span>{item.error&&<><br/><small className="knowledge-muted">{item.error}</small></>}</td><td><button className="btn btn-ghost btn-sm" onClick={()=>download(item)} title="Baixar PDF"><Download size={15}/></button></td></tr>)}{!runs.length&&<tr><td colSpan="4">Nenhum relatório mensal foi gerado.</td></tr>}</tbody></table></div>
      </main>}
    </div>
  </div>;
}
