import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Building2, Cable, Check, ChevronDown, ChevronUp, Clock, Cpu, Crosshair, ExternalLink, FileImage, FileText, Filter, Flag, GitCompare, HardDrive, History, Link2, Maximize2, MemoryStick, Network, Plus, RefreshCw, Save, ScanSearch, Search, Server, Wifi, WifiOff, XCircle, ZoomIn, ZoomOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';
import '../styles/topology-history.css';

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
  const [showHistory,setShowHistory]=useState(false);
  const [historyRows,setHistoryRows]=useState([]);
  const [historySelection,setHistorySelection]=useState({from:'',to:''});
  const [topologyComparison,setTopologyComparison]=useState(null);
  const [showExport,setShowExport]=useState(false);
  const [exportScope,setExportScope]=useState('network');
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

  const scopedExportNodes=()=>exportScope==='impact'?(impact?data.nodes.filter(node=>impactedIds.has(node.id)):[]):exportScope==='site'?(selectedNode?data.nodes.filter(node=>groupKey(node)===groupKey(selectedNode)):[]):visibleNodes;
  const download=(blob,filename)=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url)};
  const exportMap = () => {
    const nodes=scopedExportNodes(),ids=new Set(nodes.map(node=>node.id)),links=data.links.filter(link=>ids.has(link.sourceDeviceId)&&ids.has(link.targetDeviceId)),payload = { exportedAt: new Date().toISOString(), scope:exportScope,filters, summary:{devices:nodes.length,links:links.length}, nodes, links };
    if(!nodes.length){toast('Não há equipamentos no escopo selecionado','error');return}
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='topologia-noc-agent.json'; link.click(); URL.revokeObjectURL(url);
    toast('Topologia exportada com sucesso.','success');
  };
  const topologySvg=()=>{const nodes=scopedExportNodes(),ids=new Set(nodes.map(node=>node.id)),links=data.links.filter(link=>ids.has(link.sourceDeviceId)&&ids.has(link.targetDeviceId)),points=nodes.map(node=>({node,p:positions[node.id]||node.position})),minX=Math.min(...points.map(row=>row.p.x))-60,minY=Math.min(...points.map(row=>row.p.y))-80,maxX=Math.max(...points.map(row=>row.p.x+165))+60,maxY=Math.max(...points.map(row=>row.p.y+84))+60,escape=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])),colors={online:'#16a34a',warning:'#d97706',critical:'#dc2626',offline:'#dc2626',unknown:'#64748b'},byId=new Map(points.map(row=>[row.node.id,row.p]));return`<svg xmlns="http://www.w3.org/2000/svg" width="${maxX-minX}" height="${maxY-minY}" viewBox="${minX} ${minY} ${maxX-minX} ${maxY-minY}"><rect x="${minX}" y="${minY}" width="100%" height="100%" fill="#f1f5f9"/><text x="${minX+24}" y="${minY+32}" font-family="Arial" font-size="18" font-weight="700" fill="#123047">Mapa de rede</text><text x="${minX+24}" y="${minY+52}" font-family="Arial" font-size="10" fill="#526577">${nodes.length} equipamentos · ${links.length} conexões · ${escape(new Date().toLocaleString('pt-BR'))}</text>${links.map(link=>{const a=byId.get(link.sourceDeviceId),b=byId.get(link.targetDeviceId);return a&&b?`<line x1="${a.x+82}" y1="${a.y+42}" x2="${b.x+82}" y2="${b.y+42}" stroke="${colors[link.status]||'#64748b'}" stroke-width="3"/>`:''}).join('')}${points.map(({node,p})=>`<g><rect x="${p.x}" y="${p.y}" width="165" height="76" rx="10" fill="#fff" stroke="${colors[node.status]||'#64748b'}" stroke-width="3"/><text x="${p.x+10}" y="${p.y+25}" font-family="Arial" font-size="12" font-weight="700" fill="#123047">${escape(node.name)}</text><text x="${p.x+10}" y="${p.y+44}" font-family="Arial" font-size="9" fill="#526577">${escape(node.hostname)}</text><text x="${p.x+10}" y="${p.y+61}" font-family="Arial" font-size="8" fill="#64748b">${escape(`${node.manufacturer||''} ${node.model||''}`)}</text></g>`).join('')}</svg>`};
  const exportPng=async()=>{try{const svg=topologySvg(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url});const ratio=Math.min(2,4096/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));download(blob,`mapa-rede-${new Date().toISOString().slice(0,10)}.png`);toast('Mapa PNG exportado','success')}catch(error){toast(error.message||'Falha ao exportar PNG','error')}};
  const exportPdf=async()=>{setBusy(true);try{const nodes=scopedExportNodes(),result=await api.exportTopologyPdf({scope:exportScope,title:'Mapa de rede',deviceIds:nodes.map(node=>node.id),positions});download(result.blob,result.filename);toast('Mapa PDF exportado','success')}catch(error){toast(error.message,'error')}finally{setBusy(false)}};

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
  const loadHistory=async()=>{try{const rows=(await api.getTopologyHistory()).data;setHistoryRows(rows);setHistorySelection(current=>({from:current.from||rows.find(row=>row.isBaseline)?.id||rows[1]?.id||rows[0]?.id||'',to:current.to||rows[0]?.id||''}))}catch(error){toast(error.message,'error')}};
  const openHistory=()=>{setShowHistory(true);loadHistory()};
  const createSnapshot=async baseline=>{setBusy(true);try{const result=await api.createTopologySnapshot(baseline);toast(result.message,'success');await loadHistory()}catch(error){toast(error.message,'error')}finally{setBusy(false)}};
  const compareHistory=async()=>{if(!historySelection.from||!historySelection.to||historySelection.from===historySelection.to){toast('Selecione dois snapshots diferentes','error');return}setBusy(true);try{setTopologyComparison((await api.compareTopologyHistory(historySelection.from,historySelection.to)).data)}catch(error){toast(error.message,'error')}finally{setBusy(false)}};
  const markBaseline=async id=>{try{const result=await api.setTopologyBaseline(id);toast(result.message,'success');await loadHistory()}catch(error){toast(error.message,'error')}};
  const topologyTask=async()=>{try{const result=await api.createTopologyChangeTask(historySelection.from,historySelection.to);toast(result.message,'success')}catch(error){toast(error.message,'error')}};
  const nodeDiff=id=>topologyComparison?.nodes.added.some(row=>row.id===id)?'history-added':topologyComparison?.nodes.changed.some(row=>row.id===id)?'history-changed':'';
  const linkDiff=id=>topologyComparison?.links.added.some(row=>row.id===id)?'history-added':topologyComparison?.links.changed.some(row=>row.id===id)?'history-changed':'';
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
    {showExport&&<div className="modal-overlay topology-export-overlay"><section className="modal card topology-export-modal"><header><div><h3><Save size={20}/> Exportar mapa</h3><p>Escolha o escopo e o formato visual.</p></div><button className="btn-ghost" onClick={()=>setShowExport(false)}>×</button></header><div className="topology-export-scopes"><label><input type="radio" name="exportScope" checked={exportScope==='network'} onChange={()=>setExportScope('network')}/><span><Network size={18}/><strong>Rede visível</strong><small>Respeita os filtros atuais</small></span></label><label className={!selectedNode?'disabled':''}><input type="radio" name="exportScope" disabled={!selectedNode} checked={exportScope==='site'} onChange={()=>setExportScope('site')}/><span><Building2 size={18}/><strong>Site/POP selecionado</strong><small>{selectedNode?.site?.name||'Selecione um equipamento'}</small></span></label><label className={!impact?'disabled':''}><input type="radio" name="exportScope" disabled={!impact} checked={exportScope==='impact'} onChange={()=>setExportScope('impact')}/><span><AlertTriangle size={18}/><strong>Impacto atual</strong><small>{impact?`${impactedIds.size} equipamento(s)`:'Ative o modo impacto'}</small></span></label></div><div className="topology-export-summary"><strong>{scopedExportNodes().length}</strong> equipamentos serão exportados</div><div className="topology-export-actions"><button className="btn btn-secondary" disabled={!scopedExportNodes().length} onClick={exportMap}><Save size={14}/> JSON</button><button className="btn btn-secondary" disabled={!scopedExportNodes().length} onClick={exportPng}><FileImage size={14}/> PNG</button><button className="btn btn-primary" disabled={busy||!scopedExportNodes().length} onClick={exportPdf}>{busy?<span className="spinner"/>:<FileText size={14}/>} PDF</button></div></section></div>}
    {showHistory&&<div className="modal-overlay topology-history-overlay"><section className="modal card topology-history-modal"><header><div><h3><History size={20}/> Histórico da topologia</h3><p>Snapshots estruturais; movimentações visuais dos cartões não entram na comparação.</p></div><button className="btn-ghost" onClick={()=>setShowHistory(false)}>×</button></header>{!historyRows.length?<div className="empty-state"><History/><p>Nenhum baseline criado.</p>{isAdmin&&<button className="btn btn-primary" disabled={busy} onClick={()=>createSnapshot(true)}><Flag size={14}/> Criar baseline atual</button>}</div>:<><div className="topology-history-controls"><label>Comparar de<select className="form-select" value={historySelection.from} onChange={e=>setHistorySelection({...historySelection,from:e.target.value})}>{historyRows.map(row=><option key={row.id} value={row.id}>{row.isBaseline?'BASELINE · ':''}{new Date(row.createdAt).toLocaleString('pt-BR')} · {row.source}</option>)}</select></label><label>Para<select className="form-select" value={historySelection.to} onChange={e=>setHistorySelection({...historySelection,to:e.target.value})}>{historyRows.map(row=><option key={row.id} value={row.id}>{row.isBaseline?'BASELINE · ':''}{new Date(row.createdAt).toLocaleString('pt-BR')} · {row.source}</option>)}</select></label><button className="btn btn-primary" disabled={busy} onClick={compareHistory}><GitCompare size={14}/> Comparar</button>{isAdmin&&<button className="btn btn-secondary" disabled={busy} onClick={()=>createSnapshot(false)}><Save size={14}/> Novo snapshot</button>}</div>{topologyComparison&&<div className="topology-history-result"><div className="topology-history-summary"><span><strong>+{topologyComparison.summary.nodesAdded}</strong> equipamentos</span><span><strong>−{topologyComparison.summary.nodesRemoved}</strong> equipamentos</span><span><strong>~{topologyComparison.summary.nodesChanged}</strong> alterados</span><span><strong>+{topologyComparison.summary.linksAdded}</strong> links</span><span><strong>−{topologyComparison.summary.linksRemoved}</strong> links</span><span><strong>~{topologyComparison.summary.linksChanged}</strong> alterados</span></div>{topologyComparison.summary.total===0?<div className="empty-state"><Check/><p>Não existem alterações entre os snapshots.</p></div>:<div className="topology-history-changes">{[['Equipamentos adicionados',topologyComparison.nodes.added],['Equipamentos removidos',topologyComparison.nodes.removed],['Equipamentos alterados',topologyComparison.nodes.changed],['Conexões adicionadas',topologyComparison.links.added],['Conexões removidas',topologyComparison.links.removed],['Conexões alteradas',topologyComparison.links.changed]].filter(([,rows])=>rows.length).map(([title,rows])=><details key={title} open><summary>{title} ({rows.length})</summary>{rows.map(row=><article key={row.id}><strong>{row.name||row.label||row.id}</strong>{row.changes?.map(change=><small key={change.field}>{change.field}: {String(change.before??'—')} → {String(change.after??'—')}</small>)}</article>)}</details>)}</div>}<div className="topology-history-actions">{isAdmin&&topologyComparison.summary.total>0&&<button className="btn btn-secondary" onClick={topologyTask}><AlertTriangle size={14}/> Criar Task</button>}<button className="btn btn-ghost" onClick={()=>setTopologyComparison(null)}>Limpar destaque</button></div></div>}<div className="topology-snapshot-list">{historyRows.map(row=><article key={row.id}><div><strong>{row.isBaseline&&<Flag size={12}/>} {new Date(row.createdAt).toLocaleString('pt-BR')}</strong><small>{row.source} · {row.nodeCount} equipamentos · {row.linkCount} links · {row.createdBy}</small></div><code>{row.sha256.slice(0,12)}</code>{isAdmin&&!row.isBaseline&&<button className="btn btn-ghost btn-sm" onClick={()=>markBaseline(row.id)}>Definir baseline</button>}</article>)}</div></>}</section></div>}
    <div className="page-header page-header-actions"><div><h2>Mapa de rede</h2><p>Topologia operacional, disponibilidade e incidentes em tempo real</p></div><div>
      {isAdmin&&<button className="btn btn-secondary" onClick={()=>{setShowDiscovery(true);loadDiscovery();}}><ScanSearch size={15}/> LLDP/MNDP</button>}
      <button className="btn btn-secondary" onClick={openHistory}><History size={15}/> Histórico</button>
      {isAdmin&&<button className="btn btn-secondary" onClick={()=>setShowLink(true)}><Plus size={15}/> Conexão</button>}
      {isAdmin&&<button className="btn btn-secondary" onClick={organize}><Network size={15}/> Organizar</button>}
     {isAdmin&&<button className="btn btn-primary" disabled={!dirty||busy} onClick={save}>{busy?<span className="spinner"/>:<Save size={15}/>} Salvar mapa</button>}
      <button className="btn btn-secondary" onClick={()=>setFullscreen(value=>!value)}><Maximize2 size={15}/> {fullscreen?'Sair da tela cheia':'Tela cheia'}</button>
     <button className="btn btn-secondary" onClick={()=>setShowExport(true)}><Save size={15}/> Exportar</button>
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
              {visibleLinks.map(link=>{const a=positions[link.sourceDeviceId],b=positions[link.targetDeviceId];if(!a||!b)return null;const affected=impact&&(impactedIds.has(link.sourceDeviceId)||impactedIds.has(link.targetDeviceId));return <g key={link.id} className={`topology-link ${link.linkType} health-${link.status} ${impact&&!affected?'impact-dim':''} ${selectedLink===link.id?'selected':''} ${linkDiff(link.id)}`} onClick={()=>{setSelectedLink(link.id);setSelected(null)}}>
                <line x1={a.x+82} y1={a.y+42} x2={b.x+82} y2={b.y+42}/>
                <circle cx={(a.x+b.x)/2+82} cy={(a.y+b.y)/2+42} r="11"/>
                <text x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+46} textAnchor="middle">{link.linkType==='fiber'?'F':link.linkType==='vpn'?'V':'•'}</text>
                {(link.label||link.bandwidthMbps)&&<text className="topology-link-label" x={(a.x+b.x)/2+82} y={(a.y+b.y)/2+27} textAnchor="middle">{link.label||`${link.bandwidthMbps} Mbps`}</text>}
              </g>})}
            </svg>
           {visibleNodes.filter(node=>!collapsedNodeIds.has(node.id)).map(node=>{const point=positions[node.id]||node.position;const StateIcon=STATUS[node.status]?.icon||Activity;return <button key={node.id} type="button" className={`topology-node ${node.status} ${selected===node.id?'selected':''} ${impact&&!impactedIds.has(node.id)?'impact-dim':''} ${impact&&impactedIds.has(node.id)?'impact-highlight':''} ${nodeDiff(node.id)}`} style={{left:point.x,top:point.y}} onPointerDown={event=>pointerDown(event,node)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={()=>{setSelected(node.id);setSelectedLink(null)}}>
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
