import { useEffect, useState } from 'react';
import { RefreshCw, ScrollText } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const actionLabel = value => ({ login: 'Login', logout: 'Logout', change_password: 'Alteração de senha', create_or_execute: 'Criação/execução', update: 'Alteração', delete: 'Exclusão', approve: 'Aprovação', reject: 'Rejeição', agent_execute: 'Execução do agente' }[value] || value);

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [options, setOptions] = useState({ users: [], resources: [], actions: [] });
  const [filter, setFilter] = useState({ username: '', action: '', resource: '', status: '', from: '', to: '', limit: '100' });
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const load = async () => { setLoading(true); try { const p = Object.fromEntries(Object.entries(filter).filter(([,v]) => v)); const r = await api.getAuditLogs(p); setLogs(r.data); } catch(e) { toast(e.message,'error'); } finally { setLoading(false); } };
  useEffect(() => { api.getAuditOptions().then(r => setOptions(r.data)).catch(() => {}); }, []);
  useEffect(() => { const timer=setTimeout(load,250); return () => clearTimeout(timer); }, [filter]);

  return <div>
    <div className="page-header page-header-actions"><div><h2>Auditoria</h2><p>Histórico protegido de acessos e alterações</p></div><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button></div>
    <div className="card" style={{marginBottom:16}}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
      <select className="form-select" value={filter.username} onChange={e=>setFilter({...filter,username:e.target.value})}><option value="">Todos usuários</option>{options.users.map(x=><option key={x}>{x}</option>)}</select>
      <select className="form-select" value={filter.action} onChange={e=>setFilter({...filter,action:e.target.value})}><option value="">Todas ações</option>{options.actions.map(x=><option key={x} value={x}>{actionLabel(x)}</option>)}</select>
      <select className="form-select" value={filter.resource} onChange={e=>setFilter({...filter,resource:e.target.value})}><option value="">Todos recursos</option>{options.resources.map(x=><option key={x}>{x}</option>)}</select>
      <select className="form-select" value={filter.status} onChange={e=>setFilter({...filter,status:e.target.value})}><option value="">Todos resultados</option><option value="success">Sucesso</option><option value="failure">Falha</option></select>
      <input className="form-input" type="date" title="Data inicial" value={filter.from} onChange={e=>setFilter({...filter,from:e.target.value})}/>
      <input className="form-input" type="date" title="Data final" value={filter.to} onChange={e=>setFilter({...filter,to:e.target.value})}/>
    </div></div>
    <div className="table-container"><table><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Recurso</th><th>Resultado</th><th>Origem</th><th>Detalhes</th></tr></thead><tbody>
      {!loading && logs.map(log => <tr key={log.id}><td style={{whiteSpace:'nowrap'}}>{new Date(log.createdAt).toLocaleString('pt-BR')}</td><td><strong>{log.displayName || log.username}</strong><div style={{fontSize:'.7rem',color:'var(--text-muted)'}}>{log.username} · {log.role || '—'}</div></td><td>{actionLabel(log.action)}</td><td>{log.resource}{log.resourceId ? <div style={{fontSize:'.7rem',color:'var(--text-muted)'}}>{log.resourceId}</div>:null}</td><td><span className={`badge ${log.status==='success'?'badge-success':'badge-danger'}`}>{log.status==='success'?'Sucesso':'Falha'}</span></td><td><div>{log.ipAddress || '—'}</div><div title={log.userAgent || ''} style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:'.7rem',color:'var(--text-muted)'}}>{log.userAgent || ''}</div></td><td><code style={{fontSize:'.68rem',whiteSpace:'pre-wrap'}}>{log.details || '—'}</code></td></tr>)}
      {!loading && logs.length===0 && <tr><td colSpan="7"><div className="empty-state"><ScrollText size={40}/><p>Nenhum registro encontrado.</p></div></td></tr>}
    </tbody></table>{loading && <div className="loading-screen" style={{minHeight:180}}><div className="spinner"/></div>}</div>
  </div>;
}
