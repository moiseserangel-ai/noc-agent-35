import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Building2, Cable, Check, ChevronDown, ChevronUp, Clock, Cpu, Crosshair, ExternalLink, Filter, HardDrive, Link2, Maximize2, MemoryStick, Network, Plus, RefreshCw, Save, ScanSearch, Search, Server, Wifi, WifiOff, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
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
  const [filters,setFilters]=useState({group:'',manufacturer:'',tenant:'',site:'',status:''});
  const [collapsedGroups,setCollapsedGroups]=useState(new Set());
  const [mapSearch,setMapSearch]=useState('');
  const [mapSearchIndex,setMapSearchIndex]=useState(0);
  const [viewRect,setViewRect]=useState({x:0,y:0,width:0,height:0});
  const [selected,setSelected]=useState(null);
  const [selectedLink,setSelectedLink]=useState(null);
  const [impact,setImpact]=useState(null);
  const [zoom,setZoom]=useState(1);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [showLink,setShowLink]=useState(false);
 const [showDiscovery,setShowDiscovery]=useState(false);
  const [fullscreen,setFullscreen]=useState(false);
  const [discovery,setDiscovery]=useState({runs:[],suggestions:[]});
  const [linkForm,setLinkForm]=useState({sourceDeviceId:'',targetDeviceId:'',linkType:'ethernet',label:'',sourceInterface:'',targetInterface:'',bandwidthMbps:''});
  const drag=useRef(null);
  const pan=useRef(null);
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
    (!filters.tenant||node.tenant?.name===filters.tenant)&&
    (!filters.site||node.site?.name===filters.site)&&
    (!filters.status||node.status===filters.status)
  ),[data.nodes,filters]);
  const visibleIds=useMemo(()=>new Set(visibleNodes.map(node=>node.id)),[visibleNodes]);
  const groupKey=node=>`${node.tenant?.id||'global'}:${node.site?.id||node.group||'unassigned'}`;
  const visibleGroups=useMemo(()=>{const grouped=new Map();for(const node of visibleNodes){const key=groupKey(node),point=positions[node.id]||node.position,row=grouped.get(key)||{key,tenant:node.tenant?.name||'Ambiente global',site:node.site?.name||node.group||'Sem site/POP',nodes:[],minX:Infinity,minY:Infinity,maxX:0,maxY:0,tasks:0,status:'online'};row.nodes.push(node);row.minX=Math.min(row.minX,point.x);row.minY=Math.min(row.minY,point.y);row.maxX=Math.max(row.maxX,point.x+165);row.maxY=Math.max(row.maxY,point.y+84);row.tasks+=node.tasks.length;const rank={online:0,unknown:1,warning:2,offline:3,critical:4};if(rank[node.status]>rank[row.status])row.status=node.status;grouped.set(key,row)}return[...grouped.values()].map(row=>({...row,x:Math.max(20,row.minX-38),y:Math.max(20,row.minY-54),width:Math.max(245,row.maxX-row.minX+76),height:Math.max(155,row.maxY-row.minY+92)}))},[visibleNodes,positions]);
  const collapsedNodeIds=useMemo(()=>new Set(visibleGroups.filter(group=>collapsedGroups.has(group.key)).flatMap(group=>group.nodes.map(node=>node.id))),[visibleGroups,collapsedGroups]);
  const visibleLinks=useMemo(()=>data.links.filter(link=>visibleIds.has(link.sourceDeviceId)&&visibleIds.has(link.targetDeviceId)&&!collapsedNodeIds.has(link.sourceDeviceId)&&!collapsedNodeIds.has(link.targetDeviceId)),[data.links,visibleIds,collapsedNodeIds]);
  const canvas=useMemo(()=>{
    const points=Object.values(positions);
    return {width:Math.max(1300,...points.map(point=>point.x+240)),height:Math.max(720,...points.map(point=>point.y+180))};
  },[positions]);
  const selectedNode=data.nodes.find(node=>node.id===selected);
  const selectedLinkData=data.links.find(link=>link.id===selectedLink);
  const impactedIds=useMemo(()=>new Set([...(impact?.roots||[]).map(row=>row.deviceId),...(impact?.impacted||[]).map(row=>row.asset?.deviceId)].filter(Boolean)),[impact]);
  const mapSearchResults=useMemo(()=>{const term=mapSearch.trim().toLocaleLowerCase('pt-BR');return term?data.nodes.filter(node=>[node.name,node.hostname,node.model,node.manufacturer,node.tenant?.name,node.site?.name,node.group].some(value=>String(value||'').toLocaleLowerCase('pt-BR').includes(term))):[]},[data.nodes,mapSearch]);

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
    const degree=new Map(visibleNodes.map(node=>[node.id,0]));visibleLinks.forEach(link=>{degree.set(link.sourceDeviceId,(degree.get(link.sourceDeviceId)||0)+1);degree.set(link.targetDeviceId,(degree.get(link.targetDeviceId)||0)+1)});
    const maxDegree=Math.max(1,...degree.values()),keys=[...new Set(visibleNodes.map(groupKey))],next={...positions};let siteOffset=100;
    keys.forEach(key=>{const rows=[[],[],[]];visibleNodes.filter(node=>groupKey(node)===key).sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0)).forEach(node=>{const d=degree.get(node.id)||0,tier=d>=Math.max(2,Math.ceil(maxDegree*.65))?0:d>=2?1:2;rows[tier].push(node)});rows.forEach((nodes,tier)=>nodes.forEach((node,index)=>{next[node.id]={x:siteOffset+index*205,y:110+tier*205}}));siteOffset+=Math.max(520,Math.max(...rows.map(row=>row.length))*205)+110});
    setPositions(next);setDirty(true);
  };
  const createLink=async event=>{
    event.preventDefault();setBusy(true);
    try{
      const result=await api.createTopologyLink(linkForm);
      toast(result.message,'success');setShowLink(false);setLinkForm({sourceDeviceId:'',targetDeviceId:'',linkType:'ethernet',label:'',sourceInterface:'',targetInterface:'',bandwidthMbps:''});await load();
    }catch(error){toast(error.message,'error');}
    finally{setBusy(false);}
  };
  const removeLink=async id=>{
    if(!confirm('Remover esta conexão do mapa?'))return;
    try{const result=await api.deleteTopologyLink(id);toast(result.message,'success');await load();}catch(error){toast(error.message,'error');}
  };
  const fit=()=>{const points=visibleNodes.map(node=>positions[node.id]||node.position);if(!points.length)return;const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x+185)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y+104)),view=viewport.current,next=Math.min(1.5,Math.max(.5,Math.min((view?.clientWidth||900)/(maxX-minX+120),(view?.clientHeight||620)/(maxY-minY+120))));setZoom(next);requestAnimationFrame(()=>view?.scrollTo({left:Math.max(0,(minX-50)*next),top:Math.max(0,(minY-50)*next),behavior:'smooth'}));};
  const focusNodes=nodes=>{if(!nodes.length)return;const points=nodes.map(node=>positions[node.id]||node.position),minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x+185)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y+104)),view=viewport.current,next=Math.min(1.35,Math.max(.55,Math.min((view?.clientWidth||900)/(maxX-minX+160),(view?.clientHeight||620)/(maxY-minY+160))));setZoom(next);requestAnimationFrame(()=>view?.scrollTo({left:Math.max(0,(minX+maxX)/2*next-(view.clientWidth/2)),top:Math.max(0,(minY+maxY)/2*next-(view.clientHeight/2)),behavior:'smooth'}));};
  const focusSearch=()=>{if(!mapSearchResults.length)return;const index=mapSearchIndex%mapSearchResults.length,node=mapSearchResults[index],key=groupKey(node);setCollapsedGroups(current=>{const next=new Set(current);next.delete(key);return next});setSelected(node.id);setSelectedLink(null);focusNodes([node]);setMapSearchIndex((index+1)%mapSearchResults.length)};
  const panDown=event=>{if(event.target!==event.currentTarget)return;event.currentTarget.setPointerCapture(event.pointerId);pan.current={x:event.clientX,y:event.clientY,left:viewport.current.scrollLeft,top:viewport.current.scrollTop};event.currentTarget.classList.add('panning')};
  const panMove=event=>{if(!pan.current)return;viewport.current.scrollLeft=pan.current.left-(event.clientX-pan.current.x);viewport.current.scrollTop=pan.current.top-(event.clientY-pan.current.y)};
  const panUp=event=>{pan.current=null;event.currentTarget.classList.remove('panning')};
  useEffect(()=>{const view=viewport.current;if(!view)return;const update=()=>setViewRect({x:view.scrollLeft/zoom,y:view.scrollTop/zoom,width:view.clientWidth/zoom,height:view.clientHeight/zoom});update();view.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);return()=>{view.removeEventListener('scroll',update);window.removeEventListener('resize',update)}},[zoom,canvas.width,canvas.height]);
  const miniNavigate=event=>{const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*canvas.width,y=(event.clientY-rect.top)/rect.height*canvas.height,view=viewport.current;view.scrollTo({left:Math.max(0,x*zoom-view.clientWidth/2),top:Math.max(0,y*zoom-view.clientHeight/2),behavior:'smooth'})};
  const showImpact=async node=>{if(impact?.deviceId===node.id){setImpact(null);return}try{const result=await api.getTopologyImpact(node.id);setImpact({...result.data,deviceId:node.id});}catch(error){toast(error.message,'error')}};
  const toggleGroup=key=>setCollapsedGroups(current=>{const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next});
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
      <button className="btn btn-secondary" onClick={()=>setFullscreen(value=>!value)}><Maximize2 size={15}/> {fullscreen?'Sair da tela cheia':'Tela cheia'}</button>
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
      <label className="topology-search"><Search size={14}/><input value={mapSearch} onChange={e=>{setMapSearch(e.target.value);setMapSearchIndex(0)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();focusSearch()}}} placeholder="Nome, IP, modelo, empresa ou site"/><button disabled={!mapSearchResults.length} onClick={focusSearch} title="Centralizar resultado"><Crosshair size={14}/></button>{mapSearch&&<small>{mapSearchResults.length} encontrado(s)</small>}</label>
      <select className="form-select" value={filters.group} onChange={e=>setFilters({...filters,group:e.target.value})}><option value="">Todos os grupos</option>{data.filters.groups.map(value=><option key={value}>{value}</option>)}</select>
     <select className="form-select" value={filters.manufacturer} onChange={e=>setFilters({...filters,manufacturer:e.target.value})}><option value="">Todos os fabricantes</option>{data.filters.manufacturers.map(value=><option key={value}>{value}</option>)}</select>
      <select className="form-select" value={filters.tenant} onChange={e=>setFilters({...filters,tenant:e.target.value})}><option value="">Todas as empresas</option>{(data.filters.tenants||[]).map(value=><option key={value}>{value}</option>)}</select>
      <select className="form-select" value={filters.site} onChange={e=>setFilters({...filters,site:e.target.value})}><option value="">Todos os sites</option>{(data.filters.sites||[]).map(value=><option key={value}>{value}</option>)}</select>
      <select className="form-select" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Todos os estados</option>{Object.entries(STATUS).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select>
      <span>{visibleNodes.length} visível(is)</span>
     <div className="topology-zoom">{selectedNode&&<button onClick={()=>focusNodes(visibleGroups.find(group=>group.nodes.some(node=>node.id===selectedNode.id))?.nodes||[selectedNode])} title="Ajustar ao site"><Building2 size={16}/></button>}{impact&&<button onClick={()=>focusNodes(data.nodes.filter(node=>impactedIds.has(node.id)))} title="Ajustar ao impacto"><AlertTriangle size={16}/></button>}<button onClick={()=>setZoom(value=>Math.max(.5,value-.1))}><ZoomOut size={16}/></button><strong>{Math.round(zoom*100)}%</strong><button onClick={()=>setZoom(value=>Math.min(1.5,value+.1))}><ZoomIn size={16}/></button><button onClick={fit} title="Ajustar toda a rede"><Maximize2 size={16}/></button></div>
   </div>
    <div className="topology-legend"><span><i className="legend-dot online"/> Online</span><span><i className="legend-dot warning"/> Alerta</span><span><i className="legend-dot critical"/> Crítico</span><span><i className="legend-dot offline"/> Indisponível</span><span><i className="legend-line online"/> Link saudável</span><span><i className="legend-line warning"/> Link em alerta</span><span><i className="legend-line critical"/> Link afetado</span><span><i className="legend-line fiber"/> Fibra</span><span><i className="legend-line vpn"/> VPN</span>{impact&&<button className="btn btn-ghost btn-sm" onClick={()=>setImpact(null)}>Limpar impacto</button>}</div>

    {loading?<div className="loading-screen" style={{minHeight:420}}><div className="spinner"/></div>:!data.nodes.length?<div className="card empty-state"><Network/><p>Cadastre equipamentos para montar o mapa de rede.</p></div>:
    <div className={'topology-workspace '+(fullscreen?'topology-workspace-fullscreen':'')}>
      <div className="topology-viewport" ref={viewport}>
        <div className="topology-scale" style={{width:canvas.width*zoom,height:canvas.height*zoom}}>
          <div className="topology-canvas" style={{width:canvas.width,height:canvas.height,transform:`scale(${zoom})`}} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}>
            <div className="topology-site-layer">{visibleGroups.map(group=>{const collapsed=collapsedGroups.has(group.key),affected=impact&&group.nodes.some(node=>impactedIds.has(node.id));return <section key={group.key} className={`topology-site-group ${group.status} ${collapsed?'collapsed':''} ${impact&&!affected?'impact-dim':''}`} style={{left:group.x,top:group.y,width:group.width,height:collapsed?58:group.height}}><button onClick={()=>toggleGroup(group.key)} title={collapsed?'Expandir site':'Recolher site'}><Building2 size={15}/><span><strong>{group.site}</strong><small>{group.tenant}</small></span><em>{group.nodes.length} equipamentos · {group.tasks} incidentes</em>{collapsed?<ChevronDown size={15}/>:<ChevronUp size={15}/>}</button></section>})}</div>
            <svg className="topology-links" width={canvas.width} height={canvas.height} onPointerDown={panDown} onPointerMove={panMove} onPointerUp={panUp} onPointerCancel={panUp}>
              {visibleLinks.map(link=>{const a=positions[link.sourceDeviceId],b=positions[link.targetDeviceId];if(!a||!b)return null;const affected=impact&&(impactedIds.has(link.sourceDeviceId)||impactedIds.has(link.targetDeviceId));return <g key={link.id} className={`topology-link ${link.linkType} health-${link.status} ${impact&&!affected?'impact-dim':''} ${selectedLink===link.id?'selected':''}`} onClick={()=>{setSelectedLink(link.id);setSelected(null)}}>
                <line x1={a.x+82} y1={a.y+42} x2={b.x+82} y2={b.y+42}/>
                <circle cx={(a.x+b.x)/2+82} cy={(a.y+b.y)/2+42} r="11"/>
                <text x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+46} textAnchor="middle">{link.linkType==='fiber'?'F':link.linkType==='vpn'?'V':'•'}</text>
                {(link.label||link.bandwidthMbps)&&<text className="topology-link-label" x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+27} textAnchor="middle">{link.label||`${link.bandwidthMbps} Mbps`}</text>}
              </g>})}
            </svg>
           {visibleNodes.filter(node=>!collapsedNodeIds.has(node.id)).map(node=>{const point=positions[node.id]||node.position;const StateIcon=STATUS[node.status]?.icon||Activity;return <button key={node.id} type="button" className={`topology-node ${node.status} ${selected===node.id?'selected':''} ${impact&&!impactedIds.has(node.id)?'impact-dim':''} ${impact&&impactedIds.has(node.id)?'impact-highlight':''}`} style={{left:point.x,top:point.y}} onPointerDown={event=>pointerDown(event,node)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={()=>{setSelected(node.id);setSelectedLink(null)}}>
              <span className="topology-node-icon"><StateIcon size={20}/><b title={node.manufacturer||'Fabricante não informado'}>{vendorIcon(node.manufacturer)}</b></span><span><strong>{node.name}</strong><small>{node.hostname}{node.site?.name?` · ${node.site.name}`:''}</small></span><i>{node.tasks.length||''}</i>
            </button>})}
          </div>
        </div>
        <div className="topology-minimap" onClick={miniNavigate} title="Clique para navegar"><div className="topology-minimap-map">{visibleGroups.map(group=><i key={group.key} className={`group ${group.status}`} style={{left:`${group.x/canvas.width*100}%`,top:`${group.y/canvas.height*100}%`,width:`${group.width/canvas.width*100}%`,height:`${Math.max(58,group.height)/canvas.height*100}%`}}/>)}{visibleNodes.map(node=>{const point=positions[node.id]||node.position;return <b key={node.id} className={node.status} style={{left:`${point.x/canvas.width*100}%`,top:`${point.y/canvas.height*100}%`}}/>})}<span style={{left:`${viewRect.x/canvas.width*100}%`,top:`${viewRect.y/canvas.height*100}%`,width:`${Math.min(100,viewRect.width/canvas.width*100)}%`,height:`${Math.min(100,viewRect.height/canvas.height*100)}%`}}/></div><small>Minimapa</small></div>
      </div>
      {selectedNode&&<aside className="card topology-detail">
        <button className="topology-detail-close" onClick={()=>setSelected(null)}>×</button>
        <div className={`topology-detail-state ${selectedNode.status}`}>{STATUS[selectedNode.status]?.label}</div>
        <h3>{selectedNode.name}</h3><p>{selectedNode.hostname}</p>
        <dl><div><dt>Fabricante</dt><dd>{selectedNode.manufacturer||'—'}</dd></div><div><dt>Modelo</dt><dd>{selectedNode.model||'—'}</dd></div><div><dt>Versão</dt><dd>{selectedNode.osVersion||'—'}</dd></div><div><dt>Grupo</dt><dd>{selectedNode.group||'—'}</dd></div></dl>
        <div className="topology-detail-metrics"><span><Cpu size={14}/> CPU <strong>{pct(selectedNode.metrics?.cpu)}</strong></span><span><MemoryStick size={14}/> Memória <strong>{pct(selectedNode.metrics?.memory)}</strong></span><span><HardDrive size={14}/> Disco <strong>{pct(selectedNode.metrics?.storage)}</strong></span></div>
        <small>Última coleta: {date(selectedNode.metrics?.collectedAt)}</small>
        {selectedNode.tasks.length>0&&<div className="topology-incidents"><h4>Incidentes ativos</h4>{selectedNode.tasks.slice(0,3).map(task=><Link key={task.id} to={`/tasks?task=${task.taskNumber}`}>#TASK-{task.taskNumber} · {task.priority}</Link>)}</div>}
        {impact?.deviceId===selectedNode.id&&<div className="topology-impact-summary"><strong>Impacto CMDB</strong><span>{impact.summary?.impacted||0} dependência(s)</span><span>{impact.summary?.services||0} serviço(s)</span><span>{impact.summary?.clients||0} cliente(s)</span>{impact.unmappedDeviceIds?.length>0&&<small>Equipamento ainda não vinculado ao CMDB.</small>}</div>}
        <button className="btn btn-secondary topology-impact-button" onClick={()=>showImpact(selectedNode)}><Network size={13}/> {impact?.deviceId===selectedNode.id?'Ocultar impacto':'Visualizar impacto'}</button>
        <div className="topology-actions"><Link className="btn btn-secondary" to={`/devices?device=${selectedNode.id}`}>Equipamento <ExternalLink size={13}/></Link><Link className="btn btn-secondary" to={`/terminal?device=${selectedNode.id}`}>Terminal <ExternalLink size={13}/></Link></div>
      </aside>}
      {selectedLinkData&&!selectedNode&&<aside className="card topology-detail topology-link-detail"><button className="topology-detail-close" onClick={()=>setSelectedLink(null)}>×</button><div className={`topology-detail-state ${selectedLinkData.status}`}>{STATUS[selectedLinkData.status]?.label||selectedLinkData.status}</div><h3>{selectedLinkData.sourceNode?.name} ↔ {selectedLinkData.targetNode?.name}</h3><p>Estado inferido pelas duas pontas</p><dl><div><dt>Origem</dt><dd>{selectedLinkData.sourceInterface||'—'}</dd></div><div><dt>Destino</dt><dd>{selectedLinkData.targetInterface||'—'}</dd></div><div><dt>Tipo</dt><dd>{selectedLinkData.linkType}</dd></div><div><dt>Capacidade</dt><dd>{selectedLinkData.bandwidthMbps?`${selectedLinkData.bandwidthMbps} Mbps`:'Não informada'}</dd></div><div><dt>Descoberta</dt><dd>{selectedLinkData.source}</dd></div></dl>{isAdmin&&<button className="btn btn-danger" onClick={()=>removeLink(selectedLinkData.id)}>Remover conexão</button>}</aside>}
    </div>}

    {showLink&&<div className="modal-overlay"><form className="modal card topology-link-modal" onSubmit={createLink}><h3><Link2 size={19}/> Adicionar conexão</h3><label>Origem<select className="form-select" required value={linkForm.sourceDeviceId} onChange={e=>setLinkForm({...linkForm,sourceDeviceId:e.target.value})}><option value="">Selecione</option>{data.nodes.map(node=><option key={node.id} value={node.id}>{node.name} · {node.hostname}</option>)}</select></label><label>Interface de origem<input className="form-input" maxLength="100" placeholder="Ex.: ether1 ou GE0/0/1" value={linkForm.sourceInterface} onChange={e=>setLinkForm({...linkForm,sourceInterface:e.target.value})}/></label><label>Destino<select className="form-select" required value={linkForm.targetDeviceId} onChange={e=>setLinkForm({...linkForm,targetDeviceId:e.target.value})}><option value="">Selecione</option>{data.nodes.map(node=><option key={node.id} value={node.id}>{node.name} · {node.hostname}</option>)}</select></label><label>Interface de destino<input className="form-input" maxLength="100" placeholder="Ex.: sfp-sfpplus1" value={linkForm.targetInterface} onChange={e=>setLinkForm({...linkForm,targetInterface:e.target.value})}/></label><label>Tipo<select className="form-select" value={linkForm.linkType} onChange={e=>setLinkForm({...linkForm,linkType:e.target.value})}><option value="ethernet">Ethernet</option><option value="fiber">Fibra</option><option value="wireless">Wireless</option><option value="vpn">VPN</option><option value="logical">Lógica</option></select></label><label>Capacidade (Mbps)<input className="form-input" type="number" min="1" max="1000000" placeholder="Ex.: 1000" value={linkForm.bandwidthMbps} onChange={e=>setLinkForm({...linkForm,bandwidthMbps:e.target.value})}/></label><label>Identificação<input className="form-input" maxLength="100" placeholder="Ex.: Uplink principal" value={linkForm.label} onChange={e=>setLinkForm({...linkForm,label:e.target.value})}/></label><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setShowLink(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy}><Link2 size={15}/> Adicionar</button></div></form></div>}
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
