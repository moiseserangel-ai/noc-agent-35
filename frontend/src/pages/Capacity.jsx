import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Cpu, Download, Gauge, HardDrive, MemoryStick, RefreshCw, Server, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const pct=value=>value===null||value===undefined?'—':`${Math.round(value*10)/10}%`;
const bytes=value=>{
  if(value===null||value===undefined)return '—';
  const units=['B/s','KB/s','MB/s','GB/s'];let result=value,index=0;
  while(result>=1024&&index<units.length-1){result/=1024;index++;}
  return `${result.toFixed(result>=100?0:1)} ${units[index]}`;
};
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Nunca';
const tone=value=>value===null||value===undefined?'muted':value>=90?'danger':value>=80?'warning':'success';
const forecastText=item=>{
  if(!item||item.trend==='insufficient')return 'Histórico insuficiente';
  if(item.daysToThreshold!==null)return `Pode atingir 85% em ${Math.max(1,Math.round(item.daysToThreshold))} dia(s)`;
  return item.trend==='rising'?`Crescendo ${item.slopePerDay}%/dia`:item.trend==='falling'?'Em redução':'Estável';
};

function Sparkline({history,metric}){
  const values=history.map(item=>item[metric]).filter(value=>value!==null&&value!==undefined);
  if(values.length<2)return <div className="capacity-no-history">Aguardando histórico</div>;
  const points=history.map((item,index)=>{const value=item[metric]??0;return `${index/(history.length-1)*100},${36-Math.min(Math.max(value,0),100)/100*32}`;}).join(' ');
  return <svg className="capacity-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none"><line x1="0" y1="8.8" x2="100" y2="8.8"/><polyline points={points}/></svg>;
}

export default function Capacity({isAdmin=false}){
  const [data,setData]=useState({configured:false,summary:{},rows:[],risks:[]});
  const [days,setDays]=useState(30);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const toast=useToast();
  const load=async()=>{setLoading(true);try{setData((await api.getCapacity(days)).data);}catch(error){toast(error.message,'error');}finally{setLoading(false);}};
  useEffect(()=>{load();},[days]);
  const collect=async()=>{setBusy(true);try{const result=await api.collectCapacity();toast(result.message,'success');await load();}catch(error){toast(error.message,'error');}finally{setBusy(false);}};
  const download=async()=>{try{const result=await api.downloadCapacityCsv(days);const link=document.createElement('a');link.href=URL.createObjectURL(result.blob);link.download=result.filename;link.click();URL.revokeObjectURL(link.href);}catch(error){toast(error.message,'error');}};
  return <div>
    <div className="page-header page-header-actions"><div><h2>Capacidade e disponibilidade</h2><p>Métricas consolidadas do Zabbix, tendências e previsão de saturação</p></div><div><select className="form-select" style={{width:150}} value={days} onChange={e=>setDays(Number(e.target.value))}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select><button className="btn btn-secondary" onClick={download}><Download size={15}/> CSV</button>{isAdmin&&<button className="btn btn-primary" disabled={busy||!data.configured} onClick={collect}>{busy?<span className="spinner"/>:<RefreshCw size={15}/>} Coletar agora</button>}</div></div>
    {!data.configured&&<div className="compliance-notice capacity-config-notice"><AlertTriangle size={20}/><div><strong>Integração de leitura ainda não configurada</strong><span>Adicione a URL e um token de API somente leitura do Zabbix em <Link to="/settings">Configurações → Zabbix</Link>.</span></div></div>}
    <div className="stats-grid capacity-stats">
      <div className="stat-card"><Server/><div><span className="stat-label">Monitorados</span><div className="stat-value">{data.summary.devices||0}</div></div></div>
      <div className="stat-card"><Wifi/><div><span className="stat-label">Disponíveis agora</span><div className="stat-value">{data.summary.online||0}</div></div></div>
      <div className="stat-card"><WifiOff/><div><span className="stat-label">Indisponíveis</span><div className="stat-value">{data.summary.offline||0}</div></div></div>
      <div className="stat-card"><Activity/><div><span className="stat-label">Disponibilidade média</span><div className="stat-value">{pct(data.summary.averageAvailability)}</div></div></div>
      <div className="stat-card"><AlertTriangle/><div><span className="stat-label">Riscos de capacidade</span><div className="stat-value">{data.summary.risks||0}</div></div></div>
    </div>
    <div className="capacity-collected">Última coleta: <strong>{date(data.lastCollectedAt)}</strong></div>
    {loading?<div className="loading-screen" style={{minHeight:250}}><div className="spinner"/></div>:!data.rows.length?<div className="card empty-state"><Gauge/><p>Nenhum equipamento com Zabbix Host ID está disponível.</p></div>:<div className="capacity-grid">{data.rows.map(row=>{const latest=row.latest||{};return <article className={`card capacity-card ${latest.availability===0?'offline':''}`} key={row.id}>
      <header onClick={()=>setExpanded(expanded===row.id?null:row.id)}><div className={`capacity-device-state ${latest.availability===100?'online':latest.availability===0?'offline':'unknown'}`}>{latest.availability===100?<Wifi size={17}/>:<WifiOff size={17}/>}</div><div><strong>{row.name}</strong><span>{row.hostname} · {row.group||'Sem grupo'}</span></div><span>{pct(row.availability30d)} disp.</span></header>
      <div className="capacity-metrics">{[['cpu','CPU',Cpu],['memory','Memória',MemoryStick],['storage','Armazenamento',HardDrive]].map(([key,label,Icon])=><div key={key} className={tone(latest[key])}><div><Icon size={15}/><span>{label}</span><strong>{pct(latest[key])}</strong></div><div className="capacity-bar"><i style={{width:`${Math.min(latest[key]||0,100)}%`}}/></div><small><TrendingUp size={11}/>{forecastText(row.forecast[key])}</small></div>)}</div>
      <div className="capacity-traffic"><span>Entrada <strong>{bytes(latest.trafficIn)}</strong></span><span>Saída <strong>{bytes(latest.trafficOut)}</strong></span><span>Coleta <strong>{date(latest.collectedAt)}</strong></span></div>
      {expanded===row.id&&<div className="capacity-history"><div><h4>CPU</h4><Sparkline history={row.history} metric="cpu"/></div><div><h4>Memória</h4><Sparkline history={row.history} metric="memory"/></div><div><h4>Armazenamento</h4><Sparkline history={row.history} metric="storage"/></div></div>}
    </article>})}</div>}
  </div>;
}
