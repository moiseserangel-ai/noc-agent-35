import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Search, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const fmt=value=>value?new Date(value).toLocaleString('pt-BR'):'Nunca';

export default function Vulnerabilities(){
  const [data,setData]=useState({findings:[],devices:[],summary:{}}),[busy,setBusy]=useState(''),[scanAll,setScanAll]=useState({status:'idle'}),toast=useToast(),navigate=useNavigate();
  const load=async()=>{try{setData((await api.getVulnerabilities()).data);}catch(error){toast(error.message,'error');}};
  useEffect(()=>{load();api.getVulnerabilityScanAllStatus().then(row=>setScanAll(row.data)).catch(()=>{});},[]);
  useEffect(()=>{if(scanAll.status!=='running')return;const timer=setInterval(async()=>{const state=(await api.getVulnerabilityScanAllStatus()).data;setScanAll(state);if(state.status==='completed'){toast(`Análise concluída: ${state.completed} sucesso, ${state.failed} falha(s).`,'success');load();}},3000);return()=>clearInterval(timer);},[scanAll.status]);
  const scan=async device=>{setBusy(device.id);try{const result=await api.scanDeviceVulnerabilities(device.id);toast(result.message,'success');await load();}catch(error){toast(error.message,'error');}finally{setBusy('');}};
  const startAll=async()=>{try{const result=await api.scanAllVulnerabilities();setScanAll(result.data);toast(result.message,'success');}catch(error){toast(error.message,'error');}};
  const decide=async(item,action)=>{let resolution='';if(action==='resolve'){resolution=window.prompt('Informe a correção ou mitigação aplicada:')||'';if(!resolution.trim())return;}if(action==='accept'&&!window.confirm('Aceitar formalmente este risco?'))return;try{await api.decideVulnerability(item.id,action,resolution);toast('Vulnerabilidade atualizada.','success');await load();}catch(error){toast(error.message,'error');}};
  const planRemediation=item=>{
    const device=item.device,reference=`${item.cveId}${item.cvssScore?` (CVSS ${item.cvssScore})`:''}${item.knownExploited?' — CISA KEV':''}`;
    sessionStorage.setItem('noc_change_draft',JSON.stringify({
      title:`Correção de ${item.cveId} em ${device.name}`,
      description:`Remediar ${reference} identificada em ${device.name} (${device.hostname}). ${item.description}`,
      reason:`Reduzir a exposição de segurança associada a ${item.cveId} e manter o equipamento em versão suportada.`,
      impact:'Pode haver indisponibilidade temporária durante atualização, reinicialização ou aplicação da mitigação. Validar dependências no CMDB antes da execução.',
      executionPlan:`1. Confirmar versão, configuração e conectividade atuais.\n2. Capturar backup antes da mudança.\n3. Consultar o boletim do fabricante e preparar atualização ou mitigação para ${item.cveId}.\n4. Aplicar somente durante a janela aprovada.\n5. Registrar comandos, versão final e evidências.`,
      validationPlan:'1. Confirmar acesso e serviços do equipamento.\n2. Validar versão e configuração final.\n3. Executar Compliance e nova análise de vulnerabilidades.\n4. Confirmar que monitoração e tráfego estão normais.',
      rollbackPlan:'1. Interromper a execução se houver perda de conectividade ou serviço.\n2. Restaurar a configuração capturada antes da mudança.\n3. Reverter versão ou mitigação conforme procedimento do fabricante.\n4. Validar novamente conectividade e monitoração.',
      changeType:item.knownExploited||item.severity==='critical'?'emergency':'normal',deviceIds:[device.id],taskId:item.taskId||null,vulnerabilityId:item.id,
    }));
    navigate('/changes');
  };
  const active=data.findings.filter(row=>row.status!=='resolved');
  return <div>
    <div className="page-header page-header-actions"><div><h2>Gestão de Vulnerabilidades</h2><p>Correlação do inventário com NVD, CVSS e catálogo CISA KEV</p></div><div><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/>Atualizar</button><button className="btn btn-primary" disabled={scanAll.status==='running'} onClick={startAll}><Search size={15}/>{scanAll.status==='running'?`${scanAll.completed}/${scanAll.total}`:'Analisar todos'}</button></div></div>
    <div className="stats-grid">{[['Vulnerabilidades ativas',active.length,ShieldAlert],['Críticas',data.summary.critical||0,AlertTriangle],['Exploradas (KEV)',data.summary.kev||0,ShieldAlert],['Equipamentos analisáveis',data.devices.filter(row=>row.cpe).length,ShieldCheck]].map(([label,value,Icon])=><div className="stat-card" key={label}><div className="stat-icon"><Icon size={20}/></div><div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div></div>)}</div>
    <div className="card vulnerability-devices"><h3>Cobertura do inventário</h3><div className="table-container"><table><thead><tr><th>Equipamento</th><th>Versão</th><th>Correlação</th><th>Última análise</th><th></th></tr></thead><tbody>{data.devices.map(device=><tr key={device.id}><td><strong>{device.name}</strong><br/><small>{device.hostname} · {device.type}</small></td><td>{device.osVersion||'Não informada'}</td><td>{device.cpe?<code>{device.cpe}</code>:<span className="status-badge status-pending">Inventário insuficiente</span>}</td><td>{fmt(device.lastScan?.completedAt)}{device.lastScan?.error&&<small className="vulnerability-error">{device.lastScan.error}</small>}</td><td><button className="btn btn-primary btn-sm" disabled={!device.cpe||busy===device.id||scanAll.status==='running'} onClick={()=>scan(device)}><Search size={14}/>{busy===device.id?'Analisando...':'Analisar'}</button></td></tr>)}</tbody></table></div></div>
    <div className="card vulnerability-findings"><h3>Vulnerabilidades encontradas</h3>{!data.findings.length?<div className="empty-state"><ShieldCheck size={36}/><p>Nenhuma vulnerabilidade registrada.</p></div>:<div className="table-container"><table><thead><tr><th>CVE</th><th>Equipamento</th><th>Risco</th><th>Descrição</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.findings.map(item=><tr key={item.id}><td><a href={item.sourceUrl} target="_blank" rel="noreferrer"><strong>{item.cveId}</strong><ExternalLink size={12}/></a>{item.knownExploited&&<span className="kev-badge">CISA KEV</span>}</td><td>{item.device.name}<br/><small>{item.device.osVersion}</small></td><td><span className={`status-badge vulnerability-${item.severity}`}>{item.severity}</span><br/><small>CVSS {item.cvssScore??'—'}</small></td><td className="vulnerability-description">{item.description}</td><td><span className={`status-badge vulnerability-status-${item.status}`}>{item.status}</span></td><td><div className="table-actions">{!['resolved','accepted'].includes(item.status)&&<button className="btn btn-secondary btn-sm" onClick={()=>planRemediation(item)}><Wrench size={13}/>Planejar correção</button>}{item.status==='open'&&<button className="btn btn-secondary btn-sm" onClick={()=>decide(item,'acknowledge')}>Reconhecer</button>}{!['resolved','accepted'].includes(item.status)&&<button className="btn btn-primary btn-sm" onClick={()=>decide(item,'resolve')}>Resolver</button>}{!['resolved','accepted'].includes(item.status)&&<button className="btn btn-ghost btn-sm" onClick={()=>decide(item,'accept')}>Aceitar risco</button>}</div></td></tr>)}</tbody></table></div>}</div>
  </div>;
}
