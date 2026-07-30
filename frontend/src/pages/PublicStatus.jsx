import{useEffect,useState}from'react';
import{Activity,AlertTriangle,CheckCircle2,Clock3,RadioTower}from'lucide-react';
import{api}from'../lib/api.js';

const labels={operational:'Operacional',degraded:'Desempenho degradado',partial_outage:'Indisponibilidade parcial',major_outage:'Indisponibilidade',maintenance:'Em manutenção',investigating:'Investigando',identified:'Causa identificada',monitoring:'Monitorando',resolved:'Resolvido',scheduled:'Manutenção programada'};
const fmt=value=>new Date(value).toLocaleString('pt-BR');
export default function PublicStatus({branding}){
 const[data,setData]=useState(null),[error,setError]=useState('');
 const load=()=>api.getPublicStatus().then(result=>{setData(result.data);setError('');}).catch(e=>setError(e.message));
 useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer);},[]);
 if(!data)return <div className="public-status loading-screen">{error||'Carregando situação dos serviços...'}</div>;
 return <div className="public-status"><header><div className="public-status-brand">{branding?.logo?<img src={branding.logo}/>:<RadioTower/>}<strong>{branding?.name||'NOC Agent'}</strong></div><h1>{data.title}</h1><p>{data.description}</p><div className={`public-overall ${data.overall}`}>{data.overall==='operational'?<CheckCircle2/>:<AlertTriangle/>}<strong>{data.overall==='operational'?'Todos os serviços operacionais':labels[data.overall]}</strong></div></header>
 <main><section className="public-services"><h2>Serviços</h2>{data.services.map(service=><article key={service.id}><div><strong>{service.name}</strong><span>{service.description}</span></div><div><b className={service.status}/><span>{labels[service.status]}</span><small>{service.availability30d.toFixed(2)}% em 30 dias</small></div></article>)}</section>
 <section className="public-incidents"><h2>Incidentes e manutenções</h2>{!data.incidents.length?<div className="public-empty"><CheckCircle2/><p>Nenhum incidente publicado nos últimos 30 dias.</p></div>:data.incidents.map(incident=><article key={incident.id}><header><div><span className={incident.severity}>{labels[incident.status]}</span><strong>{incident.title}</strong><small>{incident.service} · {fmt(incident.publishedAt)}</small></div></header><p>{incident.message}</p>{incident.scheduledAt&&<div className="maintenance-window"><Clock3/> {fmt(incident.scheduledAt)} até {fmt(incident.scheduledEndAt)}</div>}<div className="public-timeline">{incident.updates.map(update=><div key={update.id}><i/><div><strong>{labels[update.status]||update.status}</strong><span>{update.message}</span><small>{fmt(update.createdAt)}</small></div></div>)}</div></article>)}</section></main>
 <footer><Activity size={14}/> Atualizado em {fmt(data.updatedAt)} · Atualização automática a cada minuto</footer></div>;
}
