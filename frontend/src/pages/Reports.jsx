import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const duration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
};
const labels = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica', pending:'Novo', in_progress:'Em atendimento', diagnosing:'Em análise', awaiting_approval:'Aguardando aprovação', resolved:'Resolvido', validated:'Validado', closed:'Encerrado', failed:'Falhou', zabbix:'Zabbix', dashboard:'Dashboard', whatsapp:'WhatsApp' };
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;

function Bars({ title, data }) {
  const max = Math.max(...data.map(item => item.value), 1);
  return <div className="card"><h3 style={{marginBottom:14}}>{title}</h3><div style={{display:'flex',flexDirection:'column',gap:10}}>{data.length ? data.map(item => <div key={item.name}><div style={{display:'flex',justifyContent:'space-between',fontSize:'.78rem',marginBottom:4}}><span>{labels[item.name] || item.name}</span><strong>{item.value}</strong></div><div style={{height:9,background:'var(--bg-tertiary)',borderRadius:9,overflow:'hidden'}}><div style={{width:`${item.value/max*100}%`,height:'100%',background:'var(--primary)',borderRadius:9}}/></div></div>) : <span style={{color:'var(--text-muted)'}}>Sem dados no período</span>}</div></div>;
}

export default function Reports() {
  const [range, setRange] = useState('30');
  const [custom, setCustom] = useState({from:'',to:''});
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const params = useMemo(() => range === 'custom' ? custom : {days:range}, [range,custom]);
  const load = async () => { if(range==='custom' && (!custom.from || !custom.to)) return; setLoading(true); try { setReport((await api.getIncidentReport(params)).data); } catch(e) { toast(e.message,'error'); } finally { setLoading(false); } };
  useEffect(() => { const timer=setTimeout(load,200); return()=>clearTimeout(timer); }, [params]);
  const exportCsv = () => {
    if (!report) return;
    const header = ['Task','Abertura','Resolução','Equipamento','Fonte','Prioridade','Status','MTTA segundos','MTTR segundos','SLA violado'];
    const rows = report.incidents.map(x => [x.taskNumber,x.createdAt,x.resolvedAt||'',x.device,x.source,x.priority,x.status,x.mttaSeconds??'',x.mttrSeconds??'',x.slaBreached?'Sim':'Não']);
    const blob = new Blob(['\ufeff'+[header,...rows].map(row=>row.map(csvCell).join(';')).join('\n')],{type:'text/csv;charset=utf-8'});
    const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`noc-incidentes-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const maxDaily = Math.max(...(report?.daily || []).flatMap(x=>[x.opened,x.resolved]),1);

  return <div>
    <div className="page-header page-header-actions"><div><h2>Relatórios e indicadores</h2><p>Desempenho operacional e cumprimento de SLA</p></div><div style={{display:'flex',gap:8}}><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button><button className="btn btn-primary" onClick={exportCsv} disabled={!report}><Download size={15}/> Exportar CSV</button></div></div>
    <div className="card" style={{marginBottom:16}}><div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}><select className="form-select" style={{maxWidth:190}} value={range} onChange={e=>setRange(e.target.value)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="custom">Período personalizado</option></select>{range==='custom'&&<><input className="form-input" style={{maxWidth:170}} type="date" value={custom.from} onChange={e=>setCustom({...custom,from:e.target.value})}/><span>até</span><input className="form-input" style={{maxWidth:170}} type="date" value={custom.to} onChange={e=>setCustom({...custom,to:e.target.value})}/></>}</div></div>
    {loading ? <div className="loading-screen" style={{minHeight:240}}><div className="spinner"/></div> : report && <>
      <div className="stats-grid" style={{marginBottom:16}}>
        {[['Incidentes',report.summary.total],['Em aberto',report.summary.open],['Resolvidos',report.summary.resolved],['Taxa de resolução',`${report.summary.resolutionRate}%`],['MTTA',duration(report.summary.mttaSeconds)],['MTTR',duration(report.summary.mttrSeconds)],['SLA resolução',report.summary.slaCompliance===null?'—':`${report.summary.slaCompliance}%`],['SLA violado',report.summary.slaBreached]].map(([name,value])=><div className="stat-card" key={name}><div className="stat-icon"><BarChart3 size={20}/></div><div><div className="stat-value">{value}</div><div className="stat-label">{name}</div></div></div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:16,marginBottom:16}}><Bars title="Por prioridade" data={report.byPriority}/><Bars title="Por status" data={report.byStatus}/><Bars title="Por origem" data={report.bySource}/></div>
      <div className="card" style={{marginBottom:16}}><h3 style={{marginBottom:14}}>Tendência diária</h3><div style={{display:'flex',alignItems:'end',gap:4,height:190,overflowX:'auto',paddingTop:15}}>{report.daily.map(day=><div key={day.date} title={`${day.date}: ${day.opened} abertos, ${day.resolved} resolvidos`} style={{minWidth:20,flex:1,height:'100%',display:'flex',alignItems:'end',gap:2,borderBottom:'1px solid var(--border-primary)'}}><div style={{width:'50%',height:`${day.opened/maxDaily*100}%`,minHeight:day.opened?3:0,background:'var(--danger)',borderRadius:'3px 3px 0 0'}}/><div style={{width:'50%',height:`${day.resolved/maxDaily*100}%`,minHeight:day.resolved?3:0,background:'var(--success)',borderRadius:'3px 3px 0 0'}}/></div>)}</div><div style={{display:'flex',gap:16,marginTop:8,fontSize:'.75rem'}}><span>🔴 Abertos</span><span>🟢 Resolvidos</span></div></div>
      <div className="table-container"><table><thead><tr><th>Equipamento</th><th>Incidentes</th><th>Críticos</th><th>Resolvidos</th><th>Taxa</th></tr></thead><tbody>{report.topDevices.map(row=><tr key={row.name}><td><strong>{row.name}</strong></td><td>{row.incidents}</td><td>{row.critical}</td><td>{row.resolved}</td><td>{row.incidents?Math.round(row.resolved/row.incidents*100):0}%</td></tr>)}{!report.topDevices.length&&<tr><td colSpan="5">Nenhum incidente no período.</td></tr>}</tbody></table></div>
    </>}
  </div>;
}
