import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Cable, Check, Clock, Cpu, ExternalLink, Filter, HardDrive, Link2, Maximize2, MemoryStick, Network, Plus, RefreshCw, Save, ScanSearch, Server, Wifi, WifiOff, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const STATUS = {
  online: { label:'Online', icon:Wifi },
  warning: { label:'Alerta', icon:AlertTriangle },
  critical: { label:'Crítico', icon:AlertTriangle },
  offline: { label:'Indisponível', icon:WifiOff },
  unknown: { label:'Sem dados', icon:Activity },
};
const pct=value=>value===null||value===undefined?'—':`${Math.round(value*10)/10}%`;
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Sem coleta';
const vendorIcon = manufacturer => ({mikrotik:'MT', huawei:'HW', cisco:'CS', juniper:'JN', ubiquiti:'UB'}[(manufacturer||'').toLowerCase()] || 'NW');

export default function Topology({isAdmin=false}){
  const [data,setData]=useState({nodes:[],links:[],summary:{},filters:{groups:[],manufacturers:[]}});
  const [positions,setPositions]=useState({});
  const [filters,setFilters]=useState({group:'',manufacturer:'',site:'',status:''});
  const [selected,setSelected]=useState(null);
  const [zoom,setZoom]=useState(1);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [showLink,setShowLink]=useState(false);
  const [showDiscovery,setShowDiscovery]=useState(false);
  const [discovery,setDiscovery]=useState({runs:[],suggestions:[]});
  const [linkForm,setLinkForm]=useState({sourceDeviceId:'',targetDeviceId:'',linkType:'ethernet',label:''});
  const drag=useRef(null);
  const viewport=useRef(null);
  const toast=useToast();

  const load=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const next=(await api.getTopology()).data;
      setData(next);
      if(!dirty&&!drag.current)setPositions(Object.fromEntries(next.nodes.map(node=>[node.id,{x:node.position.x,y:node.position.y}])));
    }catch(error){if(!silent)toast(error.message,'error');}
    finally{if(!silent)setLoading(false);}
  },[dirty,toast]);

  useEffect(()=>{load();},[]);
  useEffect(()=>{
    const timer=setInterval(()=>{if(!dirty&&!drag.current)load(true);},15000);
    return()=>clearInterval(timer);
  },[load,dirty]);

  const visibleNodes=useMemo(()=>data.nodes.filter(node=>
    (!filters.group||node.group===filters.group)&&
    (!filters.manufacturer||node.manufacturer===filters.manufacturer)&&
    (!filters.site||node.site?.name===filters.site)&&
    (!filters.status||node.status===filters.status)
  ),[data.nodes,filters]);
  const visibleIds=useMemo(()=>new Set(visibleNodes.map(node=>node.id)),[visibleNodes]);
  const visibleLinks=useMemo(()=>data.links.filter(link=>visibleIds.has(link.sourceDeviceId)&&visibleIds.has(link.targetDeviceId)),[data.links,visibleIds]);
  const canvas=useMemo(()=>{
    const points=Object.values(positions);
    return {width:Math.max(1300,...points.map(point=>point.x+240)),height:Math.max(720,...points.map(point=>point.y+180))};
  },[positions]);
  const selectedNode=data.nodes.find(node=>node.id===selected);

  const exportMap = () => {
    const payload = { exportedAt: new Date().toISOString(), filters, summary: data.summary, nodes: visibleNodes, links: visibleLinks };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='topologia-noc-agent.json'; link.click(); URL.revokeObjectURL(url);
    toast('Topologia exportada com sucesso.','success');
  };

  const pointerDown=(event,node)=>{
    if(!isAdmin)return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={id:node.id,startX:event.clientX,startY:event.clientY,origin:{...(positions[node.id]||node.position)}};
  };
  const pointerMove=event=>{
    if(!drag.current)return;
    const current=drag.current;
    setPositions(previous=>({...previous,[current.id]:{
      x:Math.max(50,current.origin.x+(event.clientX-current.startX)/zoom),
      y:Math.max(50,current.origin.y+(event.clientY-current.startY)/zoom),
    }}));
    setDirty(true);
  };
  const pointerUp=()=>{drag.current=null;};
  const save=async()=>{
    setBusy(true);
    try{
      const items=Object.entries(positions).map(([deviceId,position])=>({deviceId,...position}));
      await api.saveTopologyPositions(items);
      setDirty(false);
      toast('Posições do mapa salvas','success');
      await load(true);
    }catch(error){toast(error.message,'error');}
    finally{setBusy(false);}
  };
  const organize=()=>{
    const columns=Math.max(3,Math.ceil(Math.sqrt(Math.max(visibleNodes.length,1)*1.6)));
    const next={...positions};
    visibleNodes.forEach((node,index)=>{next[node.id]={x:110+(index%columns)*220,y:100+Math.floor(index/columns)*170};});
    setPositions(next);setDirty(true);
  };
  const createLink=async event=>{
    event.preventDefault();setBusy(true);
    try{
      const result=await api.createTopologyLink(linkForm);
      toast(result.message,'success');setShowLink(false);setLinkForm({sourceDeviceId:'',targetDeviceId:'',linkType:'ethernet',label:''});await load();
    }catch(error){toast(error.message,'error');}
    finally{setBusy(false);}
  };
  const removeLink=async id=>{
    if(!confirm('Remover esta conexão do mapa?'))return;
    try{const result=await api.deleteTopologyLink(id);toast(result.message,'success');await load();}catch(error){toast(error.message,'error');}
  };
  const fit=()=>{setZoom(.8);viewport.current?.scrollTo({left:0,top:0,behavior:'smooth'});};
  const loadDiscovery=useCallback(async()=>{
    try{setDiscovery((await api.getTopologyDiscovery()).data);}catch(error){toast(error.message,'error');}
  },[toast]);
  useEffect(()=>{
    if(!showDiscovery)return;
    loadDiscovery();
    const timer=setInterval(loadDiscovery,3000);
    return()=>clearInterval(timer);
  },[showDiscovery,loadDiscovery]);
  const startDiscovery=async()=>{
    setBusy(true);
    try{const result=await api.startTopologyDiscovery();toast(result.message,'success');setShowDiscovery(true);await loadDiscovery();}catch(error){toast(error.message,'error');}
    finally{setBusy(false);}
  };
  const decideNeighbor=async(id,approve)=>{
    try{
      const result=approve?await api.approveTopologyNeighbor(id):await api.ignoreTopologyNeighbor(id);
      toast(result.message,'success');await Promise.all([loadDiscovery(),load()]);
    }catch(error){toast(error.message,'error');}
  };
  const latestRun=discovery.runs[0];
  const discovering=['queued','running'].includes(latestRun?.status);

  return <div className="topology-page">
    <div className="page-header page-header-actions"><div><h2>Mapa de rede</h2><p>Topologia operacional, disponibilidade e incidentes em tempo real</p></div><div>
      {isAdmin&&<button className="btn btn-secondary" onClick={()=>{setShowDiscovery(true);loadDiscovery();}}><ScanSearch size={15}/> LLDP/MNDP</button>}
      {isAdmin&&<button className="btn btn-secondary" onClick={()=>setShowLink(true)}><Plus size={15}/> Conexão</button>}
      {isAdmin&&<button className="btn btn-secondary" onClick={organize}><Network size={15}/> Organizar</button>}
      {isAdmin&&<button className="btn btn-primary" disabled={!dirty||busy} onClick={save}>{busy?<span className="spinner"/>:<Save size={15}/>} Salvar mapa</button>}
      <button className="btn btn-secondary" onClick={exportMap}><Save size={15}/> Exportar</button>
      <button className="btn btn-secondary" onClick={()=>load()}><RefreshCw size={15}/> Atualizar</button>
    </div></div>

    <div className="stats-grid topology-stats">
      <div className="stat-card"><Server/><div><span className="stat-label">Equipamentos</span><div className="stat-value">{data.summary.devices||0}</div></div></div>
      <div className="stat-card topology-online"><Wifi/><div><span className="stat-label">Online</span><div className="stat-value">{data.summary.online||0}</div></div></div>
      <div className="stat-card topology-warning"><AlertTriangle/><div><span className="stat-label">Alertas</span><div className="stat-value">{(data.summary.warning||0)+(data.summary.critical||0)}</div></div></div>
      <div className="stat-card topology-offline"><WifiOff/><div><span className="stat-label">Indisponíveis</span><div className="stat-value">{data.summary.offline||0}</div></div></div>
      <div className="stat-card"><Cable/><div><span className="stat-label">Conexões</span><div className="stat-value">{data.summary.links||0}</div></div></div>
    </div>

    <div className="card topology-toolbar">
      <Filter size={16}/>
      <select className="form-select" value={filters.group} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="">Todos os grupos</option>{data.filters.groups.map(value=><option key={value}>{value}</option>)}</select>
     <select className="form-select" value={filters.manufacturer} onChange={e=>setFilters({...filters,manufacturer:e.target.value})}><option value="">Todos os fabricantes</option>{data.filters.manufacturers.map(value=><option key={value}>{value}</option>)}</select>
      <select className="form-select" value={filters.site} onChange={e=>setFilters({...filters,site:e.target.value})}><option value="">Todos os sites</option>{(data.filters.sites||[]).map(value=><option key={value}>{value}</option>)}</select>
      <select className="form-select" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Todos os estados</option>{Object.entries(STATUS).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select>
      <span>{visibleNodes.length} visível(is)</span>
      <div className="topology-zoom"><button onClick={()=>setZoom(value=>Math.max(.5,value-.1))}><ZoomOut size={16}/></button><strong>{Math.round(zoom*100)}%</strong><button onClick={()=>setZoom(value=>Math.min(1.5,value+.1))}><ZoomIn size={16}/></button><button onClick={fit} title="Ajustar"><Maximize2 size={16}/></button></div>
    </div>

    {loading?<div className="loading-screen" style={{minHeight:420}}><div className="spinner"/></div>:!data.nodes.length?<div className="card empty-state"><Network/><p>Cadastre equipamentos para montar o mapa de rede.</p></div>:
    <div className="topology-workspace">
      <div className="topology-viewport" ref={viewport}>
        <div className="topology-scale" style={{width:canvas.width*zoom,height:canvas.height*zoom}}>
          <div className="topology-canvas" style={{width:canvas.width,height:canvas.height,transform:`scale(${zoom})`}}>
            <svg className="topology-links" width={canvas.width} height={canvas.height}>
              {visibleLinks.map(link=>{const a=positions[link.sourceDeviceId],b=positions[link.targetDeviceId];if(!a||!b)return null;return <g key={link.id} className={`topology-link ${link.linkType}`} onClick={()=>isAdmin&&removeLink(link.id)}>
                <line x1={a.x+82} y1={a.y+42} x2={b.x+82} y2={b.y+42}/>
                <circle cx={(a.x+b.x)/2+82} cy={(a.y+b.y)/2+42} r="11"/>
                <text x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+46} textAnchor="middle">{link.linkType==='fiber'?'F':link.linkType==='vpn'?'V':'•'}</text>
                {link.label&&<text className="topology-link-label" x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+27} textAnchor="middle">{link.label}</text>}
              </g>})}
            </svg>
           {visibleNodes.map(node=>{const point=positions[node.id]||node.position;const StateIcon=STATUS[node.status]?.icon||Activity;return <button key={node.id} type="button" className={`topology-node ${node.status} ${selected===node.id?'selected':''}`} style={{left:point.x,top:point.y}} onPointerDown={event=>pointerDown(event,node)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={()=>setSelected(node.id)}>
              <span className="topology-node-icon"><StateIcon size={20}/><b title={node.manufacturer||'Fabricante não informado'}>{vendorIcon(node.manufacturer)}</b></span><span><strong>{node.name}</strong><small>{node.hostname}{node.site?.name?` · ${node.site.name}`:''}</small></span><i>{node.tasks.length||''}</i>
            </button>})}
          </div>
        </div>
      </div>
      {selectedNode&&<aside className="card topology-detail">
        <button className="topology-detail-close" onClick={()=>setSelected(null)}>×</button>
        <div className={`topology-detail-state ${selectedNode.status}`}>{STATUS[selectedNode.status]?.label}</div>
        <h3>{selectedNode.name}</h3><p>{selectedNode.hostname}</p>
        <dl><div><dt>Fabricante</dt><dd>{selectedNode.manufacturer||'—'}</dd></div><div><dt>Modelo</dt><dd>{selectedNode.model||'—'}</dd></div><div><dt>Versão</dt><dd>{selectedNode.osVersion||'—'}</dd></div><div><dt>Grupo</dt><dd>{selectedNode.group||'—'}</dd></div></dl>
        <div className="topology-detail-metrics"><span><Cpu size={14}/> CPU <strong>{pct(selectedNode.metrics?.cpu)}</strong></span><span><MemoryStick size={14}/> Memória <strong>{pct(selectedNode.metrics?.memory)}</strong></span><span><HardDrive size={14}/> Disco <strong>{pct(selectedNode.metrics?.storage)}</strong></span></div>
        <small>Última coleta: {date(selectedNode.metrics?.collectedAt)}</small>
        {selectedNode.tasks.length>0&&<div className="topology-incidents"><h4>Incidentes ativos</h4>{selectedNode.tasks.slice(0,3).map(task=><Link key={task.id} to={`/tasks?task=${task.taskNumber}`}>#TASK-{task.taskNumber} · {task.priority}</Link>)}</div>}
        <div className="topology-actions"><Link className="btn btn-secondary" to={`/devices?device=${selectedNode.id}`}>Equipamento <ExternalLink size={13}/></Link><Link className="btn btn-secondary" to={`/terminal?device=${selectedNode.id}`}>Terminal <ExternalLink size={13}/></Link></div>
      </aside>}
    </div>}

    {showLink&&<div className="modal-overlay"><form className="modal card topology-link-modal" onSubmit={createLink}><h3><Link2 size={19}/> Adicionar conexão</h3><label>Origem<select className="form-select" required value={linkForm.sourceDeviceId} onChange={e=>setLinkForm({...linkForm,sourceDeviceId:e.target.value})}><option value="">Selecione</option>{data.nodes.map(node=><option key={node.id} value={node.id}>{node.name} · {node.hostname}</option>)}</select></label><label>Destino<select className="form-select" required value={linkForm.targetDeviceId} onChange={e=>setLinkForm({...linkForm,targetDeviceId:e.target.value})}><option value="">Selecione</option>{data.nodes.map(node=><option key={node.id} value={node.id}>{node.name} · {node.hostname}</option>)}</select></label><label>Tipo<select className="form-select" value={linkForm.linkType} onChange={e=>setLinkForm({...linkForm,linkType:e.target.value})}><option value="ethernet">Ethernet</option><option value="fiber">Fibra</option><option value="wireless">Wireless</option><option value="vpn">VPN</option><option value="logical">Lógica</option></select></label><label>Identificação<input className="form-input" maxLength="100" placeholder="Ex.: ether1 ↔ GE0/0/1" value={linkForm.label} onChange={e=>setLinkForm({...linkForm,label:e.target.value})}/></label><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setShowLink(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy}><Link2 size={15}/> Adicionar</button></div></form></div>}
    {showDiscovery&&<div className="modal-overlay topology-discovery-overlay"><section className="modal card topology-discovery-modal">
      <header><div><h3><ScanSearch size={20}/> Descoberta LLDP/MNDP</h3><p>Consulta somente leitura nos equipamentos MikroTik e Huawei cadastrados.</p></div><button className="btn-ghost" onClick={()=>setShowDiscovery(false)}>×</button></header>
      <div className="topology-discovery-run">
        <div><span className={`discovery-run-state ${latestRun?.status||'idle'}`}>{discovering?<Clock size={14}/>:<Check size={14}/>} {latestRun?.status==='running'?'Coletando':latestRun?.status==='queued'?'Na fila':latestRun?.status==='completed_with_errors'?'Concluída com alertas':latestRun?.status==='completed'?'Concluída':'Nenhuma execução'}</span>
        {latestRun&&<small>{latestRun.scanned}/{latestRun.total} equipamentos · {latestRun.found} vizinhos · {latestRun.matched} relacionados</small>}</div>
        <button className="btn btn-primary" disabled={busy||discovering} onClick={startDiscovery}>{discovering?<span className="spinner"/>:<RefreshCw size={15}/>} {latestRun?'Executar novamente':'Iniciar descoberta'}</button>
      </div>
      {latestRun?.errors&&<details className="topology-discovery-errors"><summary>Falhas de coleta</summary><pre>{(()=>{try{return JSON.parse(latestRun.errors).join('\n');}catch{return latestRun.errors;}})()}</pre></details>}
      <div className="topology-suggestion-legend"><span className="confirmed">Confirmada nos dois lados</span><span className="suggested">Encontrada em um lado</span><span className="unmatched">Não relacionada</span><span className="conflict">Conflito</span></div>
      <div className="topology-suggestions">
        {!discovery.suggestions.length?<div className="empty-state"><Network/><p>{discovering?'Aguardando resultados da coleta...':'Nenhuma sugestão disponível.'}</p></div>:discovery.suggestions.map(item=><article key={item.id} className={`topology-suggestion ${item.status}`}>
          <div className="topology-suggestion-protocol">{item.protocol.toUpperCase()}</div>
          <div><strong>{item.localDevice.name}</strong><span>{item.localInterface||'interface local'} → {item.matchedDevice?.name||item.remoteName||item.remoteIp||'vizinho não identificado'}</span><small>{item.remoteInterface||'interface remota desconhecida'} · confiança {item.confidence}%</small></div>
          <span className="topology-suggestion-status">{item.status==='confirmed'?'Bilateral':item.status==='suggested'?'Unilateral':item.status==='unmatched'?'Sem cadastro':item.status==='conflict'?'Conflito':item.status==='approved'?'Aprovada':'Ignorada'}</span>
          {['confirmed','suggested','conflict'].includes(item.status)&&<div className="topology-suggestion-actions"><button title="Aprovar conexão" onClick={()=>decideNeighbor(item.id,true)}><Check size={16}/></button><button title="Ignorar" onClick={()=>decideNeighbor(item.id,false)}><XCircle size={16}/></button></div>}
        </article>)}
      </div>
    </section></div>}
  </div>;
}
