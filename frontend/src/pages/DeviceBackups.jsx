import { useEffect, useState } from 'react';
import { AlertTriangle, ArchiveRestore, CalendarClock, CheckCircle, Clock, Download, FileDiff, HardDrive, History, Play, RefreshCw, Save, ShieldCheck, Trash2, X, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const typeLabel = { mikrotik: 'MikroTik RouterOS', huawei_vrp: 'Huawei VRP', cisco_ios:'Cisco IOS / IOS-XE', juniper_junos:'Juniper Junos', fortigate_fortios:'Fortinet FortiGate / FortiOS', ubiquiti_edgeos:'Ubiquiti EdgeOS', datacom_dmos:'Datacom DMOS', nokia_sros:'Nokia SR OS', linux:'Linux' };
const week = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const date = value => value ? new Date(value).toLocaleString('pt-BR') : 'Nunca';
const size = bytes => !bytes ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(2)} MB`;

export default function DeviceBackups() {
  const [data, setData] = useState({ devices: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [policyDevice, setPolicyDevice] = useState(null);
  const [policy, setPolicy] = useState({ enabled: true, frequency: 'daily', hour: 2, weekday: 0, retention: 14 });
  const [historyDevice, setHistoryDevice] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [compare, setCompare] = useState({ before: '', after: '' });
  const [diff, setDiff] = useState(null);
  const [drifts,setDrifts]=useState({rows:[],summary:{}});
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try { const [backups,driftRows]=await Promise.all([api.getDeviceBackups(),api.getConfigurationDrifts()]);setData(backups.data);setDrifts(driftRows.data); }
    catch (error) { toast(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const run = async device => {
    setBusyId(device.id);
    try { await api.runDeviceBackup(device.id); toast(`Backup de ${device.name} concluído e validado.`, 'success'); await load(); }
    catch (error) { toast(error.message, 'error'); await load(); }
    finally { setBusyId(null); }
  };
  const openPolicy = device => {
    setPolicyDevice(device);
    setPolicy(device.backupPolicy ? { enabled: device.backupPolicy.enabled, frequency: device.backupPolicy.frequency, hour: device.backupPolicy.hour, weekday: device.backupPolicy.weekday, retention: device.backupPolicy.retention } : { enabled: true, frequency: 'daily', hour: 2, weekday: 0, retention: 14 });
  };
  const savePolicy = async () => {
    setBusyId(policyDevice.id);
    try { await api.saveDeviceBackupPolicy(policyDevice.id, policy); toast('Política de backup salva.', 'success'); setPolicyDevice(null); await load(); }
    catch (error) { toast(error.message, 'error'); }
    finally { setBusyId(null); }
  };
  const openHistory = async device => {
    setHistoryDevice(device); setDiff(null); setCompare({ before: '', after: '' });
    try {
      const rows = (await api.getDeviceBackupSnapshots(device.id)).data;
      setSnapshots(rows);
      const successful = rows.filter(item => item.status === 'success');
      if (successful.length >= 2) setCompare({ before: successful[1].id, after: successful[0].id });
    } catch (error) { toast(error.message, 'error'); }
  };
  const compareNow = async () => {
    if (!compare.before || !compare.after || compare.before === compare.after) return toast('Selecione duas versões diferentes.', 'error');
    try { setDiff((await api.compareDeviceBackups(compare.before, compare.after)).data); }
    catch (error) { toast(error.message, 'error'); }
  };
  const download = async snapshot => {
    try {
      const result = await api.downloadDeviceBackup(snapshot.id);
      const link = document.createElement('a'); link.href = URL.createObjectURL(result.blob); link.download = result.filename; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { toast(error.message, 'error'); }
  };
  const remove = async snapshot => {
    if (!window.confirm(`Remover o backup de ${date(snapshot.createdAt)}?`)) return;
    try { await api.deleteDeviceBackup(snapshot.id); toast('Backup removido.', 'success'); openHistory(historyDevice); load(); }
    catch (error) { toast(error.message, 'error'); }
  };
  const decideDrift=async(drift,action)=>{let resolution='';if(action==='resolve'){resolution=window.prompt('Informe como o drift foi resolvido:')||'';if(!resolution.trim())return;}if(action==='ignore'&&!window.confirm('Aceitar esta configuração como novo baseline?'))return;try{await api.decideConfigurationDrift(drift.id,action,resolution);toast(action==='acknowledge'?'Drift reconhecido.':'Drift concluído.','success');await load();}catch(error){toast(error.message,'error');}};

  const summary = data.summary || {};
  return <div>
    <div className="page-header page-header-actions"><div><h2>Backup de equipamentos</h2><p>Configurações MikroTik e Huawei criptografadas, versionadas e verificadas</p></div><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button></div>
    <div className="stats-grid device-backup-stats">{[
      ['Equipamentos compatíveis', summary.devices || 0, HardDrive],
      ['Com agendamento ativo', summary.protected || 0, CalendarClock],
      ['Backups armazenados', summary.backups || 0, ArchiveRestore],
      ['Falhas em 30 dias', summary.failures30d || 0, XCircle],
      ['Drifts abertos', (drifts.summary.open||0)+(drifts.summary.acknowledged||0), AlertTriangle],
    ].map(([label,value,Icon])=><div className="stat-card" key={label}><div className="stat-icon"><Icon size={20}/></div><div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div></div>)}</div>

    <div className="card device-backup-notice"><ShieldCheck size={20}/><div><strong>Proteção de configuração</strong><span>Conteúdo criptografado com AES-256-GCM, integridade SHA-256 e acesso exclusivo para administradores. Esta versão não realiza restauração automática.</span></div></div>

    {loading ? <div className="loading-screen" style={{minHeight:260}}><div className="spinner"/></div> :
    <div className="table-container"><table><thead><tr><th>Equipamento</th><th>Agendamento</th><th>Última execução</th><th>Versões</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {data.devices.map(device => {
        const last = device.configBackups?.[0];
        const p = device.backupPolicy;
        return <tr key={device.id}><td><strong>{device.name}</strong><br/><span className="knowledge-muted">{device.hostname} · {typeLabel[device.type]}</span></td><td>{p?.enabled?<><strong>{p.frequency==='weekly'?`${week[p.weekday]}, `:'Diário, '}{String(p.hour).padStart(2,'0')}:00</strong><br/><span className="knowledge-muted">Próximo: {date(p.nextRunAt)}</span></>:<span className="status-badge status-pending">Desativado</span>}</td><td>{last?date(last.createdAt):'Nunca'}<br/>{last&&<span className="knowledge-muted">{last.type==='automatic'?'Automático':'Manual'} · {size(last.size)}</span>}</td><td>{device._count.configBackups}</td><td>{!last?<span className="status-badge status-pending">Sem backup</span>:last.status==='success'?<span className="status-badge status-completed"><CheckCircle size={12}/> Validado</span>:<span className="status-badge status-failed"><XCircle size={12}/> Falhou</span>}</td><td><div className="table-actions device-backup-actions"><button className="btn btn-primary btn-sm" disabled={busyId===device.id} onClick={()=>run(device)}><Play size={14}/>{busyId===device.id?'Executando...':'Executar'}</button><button className="btn btn-secondary btn-sm" onClick={()=>openPolicy(device)}><Clock size={14}/>Agendar</button><button className="btn btn-secondary btn-sm" onClick={()=>openHistory(device)}><History size={14}/>Histórico</button></div></td></tr>;
      })}
      {!data.devices.length&&<tr><td colSpan="6"><div className="empty-state"><HardDrive size={38}/><p>Nenhum equipamento MikroTik ou Huawei ativo.</p></div></td></tr>}
    </tbody></table></div>}

    <div className="card config-drift-panel"><div className="page-header page-header-actions"><div><h3>Detecção de drift</h3><p>Alterações encontradas fora de Runbooks, mudanças e rollbacks controlados</p></div><span className="status-badge status-pending">{(drifts.summary.open||0)+(drifts.summary.acknowledged||0)} pendente(s)</span></div>{!drifts.rows.length?<div className="empty-state"><ShieldCheck size={34}/><p>Nenhum drift detectado.</p></div>:<div className="table-container"><table><thead><tr><th>Equipamento</th><th>Detectado</th><th>Diferenças</th><th>Status</th><th>Task</th><th>Ações</th></tr></thead><tbody>{drifts.rows.map(item=><tr key={item.id}><td><strong>{item.device.name}</strong><br/><span className="knowledge-muted">{item.device.hostname}</span></td><td>{date(item.detectedAt)}</td><td><span className="diff-added">+{item.addedCount}</span> <span className="diff-removed">−{item.removedCount}</span></td><td><span className={`status-badge drift-${item.status}`}>{item.status}</span></td><td>{item.taskId?'Criada':'—'}</td><td><div className="table-actions">{item.status==='open'&&<button className="btn btn-secondary btn-sm" onClick={()=>decideDrift(item,'acknowledge')}>Reconhecer</button>}{['open','acknowledged'].includes(item.status)&&<button className="btn btn-primary btn-sm" onClick={()=>decideDrift(item,'resolve')}>Resolver</button>}{['open','acknowledged'].includes(item.status)&&<button className="btn btn-ghost btn-sm" onClick={()=>decideDrift(item,'ignore')}>Aceitar baseline</button>}</div></td></tr>)}</tbody></table></div>}</div>

    {policyDevice&&<div className="modal-overlay" onClick={()=>setPolicyDevice(null)}><div className="modal device-backup-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Política de backup</h3><p>{policyDevice.name} · {policyDevice.hostname}</p></div><button className="btn btn-ghost" onClick={()=>setPolicyDevice(null)}><X size={18}/></button></div><div className="form-row"><div className="form-group"><label className="form-label">Agendamento</label><select className="form-select" value={String(policy.enabled)} onChange={e=>setPolicy({...policy,enabled:e.target.value==='true'})}><option value="true">Ativado</option><option value="false">Desativado</option></select></div><div className="form-group"><label className="form-label">Frequência</label><select className="form-select" value={policy.frequency} onChange={e=>setPolicy({...policy,frequency:e.target.value})}><option value="daily">Diário</option><option value="weekly">Semanal</option></select></div></div><div className="form-row"><div className="form-group"><label className="form-label">Horário</label><input className="form-input" type="number" min="0" max="23" value={policy.hour} onChange={e=>setPolicy({...policy,hour:Number(e.target.value)})}/></div>{policy.frequency==='weekly'&&<div className="form-group"><label className="form-label">Dia da semana</label><select className="form-select" value={policy.weekday} onChange={e=>setPolicy({...policy,weekday:Number(e.target.value)})}>{week.map((label,index)=><option key={label} value={index}>{label}</option>)}</select></div>}<div className="form-group"><label className="form-label">Versões mantidas</label><input className="form-input" type="number" min="1" max="365" value={policy.retention} onChange={e=>setPolicy({...policy,retention:Number(e.target.value)})}/></div></div><div className="modal-footer"><button className="btn btn-secondary" onClick={()=>setPolicyDevice(null)}>Cancelar</button><button className="btn btn-primary" onClick={savePolicy} disabled={busyId===policyDevice.id}><Save size={15}/>Salvar política</button></div></div></div>}

    {historyDevice&&<div className="modal-overlay" onClick={()=>setHistoryDevice(null)}><div className="modal device-history-modal" onClick={event=>event.stopPropagation()}><div className="modal-header"><div><h3>Histórico de configurações</h3><p>{historyDevice.name} · {snapshots.length} registros</p></div><button className="btn btn-ghost" onClick={()=>setHistoryDevice(null)}><X size={18}/></button></div>
      {snapshots.filter(item=>item.status==='success').length>=2&&<div className="device-compare-bar"><select className="form-select" value={compare.before} onChange={e=>setCompare({...compare,before:e.target.value})}>{snapshots.filter(item=>item.status==='success').map(item=><option value={item.id} key={item.id}>Anterior: {date(item.createdAt)}</option>)}</select><select className="form-select" value={compare.after} onChange={e=>setCompare({...compare,after:e.target.value})}>{snapshots.filter(item=>item.status==='success').map(item=><option value={item.id} key={item.id}>Atual: {date(item.createdAt)}</option>)}</select><button className="btn btn-primary" onClick={compareNow}><FileDiff size={15}/>Comparar</button></div>}
      {diff&&<div className="device-diff"><div><strong className="diff-added">+ {diff.diff.addedCount} adicionadas</strong><pre>{diff.diff.added.map(line=>`+ ${line}`).join('\n') || 'Nenhuma linha adicionada'}</pre></div><div><strong className="diff-removed">− {diff.diff.removedCount} removidas</strong><pre>{diff.diff.removed.map(line=>`- ${line}`).join('\n') || 'Nenhuma linha removida'}</pre></div></div>}
      <div className="table-container"><table><thead><tr><th>Data</th><th>Origem</th><th>Tamanho</th><th>Integridade</th><th>Resultado</th><th></th></tr></thead><tbody>{snapshots.map(item=><tr key={item.id}><td>{date(item.createdAt)}<br/><span className="knowledge-muted">{item.createdBy}</span></td><td>{item.type==='automatic'?'Automático':'Manual'}</td><td>{size(item.size)}</td><td>{item.sha256?<code title={item.sha256}>{item.sha256.slice(0,12)}…</code>:'—'}</td><td>{item.status==='success'?<span className="status-badge status-completed">Validado</span>:<span className="status-badge status-failed" title={item.error}>Falhou</span>}</td><td><div className="table-actions">{item.status==='success'&&<button className="btn btn-ghost btn-sm" title="Baixar" onClick={()=>download(item)}><Download size={15}/></button>}<button className="btn btn-ghost btn-sm" title="Excluir" onClick={()=>remove(item)}><Trash2 size={15}/></button></div></td></tr>)}{!snapshots.length&&<tr><td colSpan="6">Nenhum backup executado.</td></tr>}</tbody></table></div>
    </div></div>}
  </div>;
}
