import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, Coins, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const providerName = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini' };
const statusLabel = { available: 'Disponível', cooldown: 'Limite temporário', quota_exhausted: 'Cota esgotada', error: 'Erro' };
const errorLabel = { quota: 'Cota', rate_limit: 'Limite', auth: 'Autenticação', model: 'Modelo', provider: 'Provedor', unknown: 'Erro', cooldown: 'Ignorado' };
const number = value => new Intl.NumberFormat('pt-BR').format(value || 0);
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 }).format(value || 0);
const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
const quotaMessage = item => item.status === 'quota_exhausted' || /insufficient_quota|credit_balance_exhausted|no credits remaining/i.test(item.reason || '');

export default function AiUsage() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const load = async () => { setLoading(true); try { setData((await api.getAiUsage({ days })).data); } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [days]);
  const unblock = async provider => { try { await api.unblockAiProvider(provider); toast(`${providerName[provider]} liberado para nova tentativa.`, 'success'); load(); } catch (e) { toast(e.message, 'error'); } };

  return <div>
    <div className="page-header page-header-actions"><div><h2>Consumo de IA</h2><p>Tokens, custos estimados, disponibilidade e fallback dos provedores</p></div><div style={{display:'flex',gap:8}}><select className="form-select" value={days} onChange={e=>setDays(e.target.value)} style={{width:160}}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select><button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button></div></div>
    {loading ? <div className="loading-screen" style={{minHeight:240}}><div className="spinner"/></div> : data && <>
      <div className="stats-grid" style={{marginBottom:16}}>{[
        ['Chamadas concluídas', number(data.summary.requests), Bot], ['Tokens processados', number(data.summary.totalTokens), Zap], ['Custo estimado', money(data.summary.estimatedCost), Coins], ['Erros de API', number(data.summary.errors), AlertTriangle],
      ].map(([label,value,Icon])=><div className="stat-card" key={label}><div className="stat-icon"><Icon size={20}/></div><div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div></div>)}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:16,marginBottom:16}}>{data.providers.map(item=><div className="card" key={item.provider}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'start',marginBottom:14}}><div><h3>{providerName[item.provider]}</h3><span className={`status-badge ${item.status==='available'?'status-completed':'status-failed'}`}>{statusLabel[item.status] || item.status}</span></div>{item.status!=='available'&&<button className="btn btn-secondary btn-sm" onClick={()=>unblock(item.provider)} title="Fazer uma nova tentativa agora"><RotateCcw size={14}/> Testar novamente</button>}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,fontSize:'.82rem'}}><div><span style={{color:'var(--text-muted)'}}>Chamadas</span><strong style={{display:'block'}}>{number(item.requests)}</strong></div><div><span style={{color:'var(--text-muted)'}}>Erros</span><strong style={{display:'block'}}>{number(item.errors)}</strong></div><div><span style={{color:'var(--text-muted)'}}>Tokens</span><strong style={{display:'block'}}>{number(item.totalTokens)}</strong></div><div><span style={{color:'var(--text-muted)'}}>Estimativa</span><strong style={{display:'block'}}>{money(item.estimatedCost)}</strong></div></div>
        {item.cooldownUntil&&<div className="alert alert-warning" style={{marginTop:14,fontSize:'.78rem'}}><AlertTriangle size={15}/><div>{quotaMessage(item)?'Cota esgotada':<>Bloqueado até {date(item.cooldownUntil)}.<br/>{item.reason}</>}</div></div>}
      </div>)}</div>
      <div className="card" style={{marginBottom:16,fontSize:'.78rem',color:'var(--text-muted)'}}>{data.pricingNote}</div>
      <div className="table-container"><table><thead><tr><th>Data</th><th>Provedor/modelo</th><th>Agente</th><th>Resultado</th><th>Tokens</th><th>Custo estimado</th><th>Duração</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><td>{date(row.createdAt)}</td><td><strong>{providerName[row.provider] || row.provider}</strong><br/><span style={{color:'var(--text-muted)',fontSize:'.75rem'}}>{row.model}</span></td><td>{row.agentName || '—'}</td><td>{row.status==='success'?<span className="status-badge status-completed">Sucesso</span>:<><span className="status-badge status-failed">{errorLabel[row.errorKind] || row.status}</span>{row.errorMessage&&<div title={row.errorKind==='quota'?'Cota esgotada':row.errorMessage} style={{maxWidth:280,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontSize:'.72rem',marginTop:4}}>{row.errorKind==='quota'?'Cota esgotada':row.errorMessage}</div>}</>}</td><td>{number(row.totalTokens)}</td><td>{row.estimatedCost===null?'—':money(row.estimatedCost)}</td><td>{row.durationMs===null?'—':`${row.durationMs} ms`}</td></tr>)}{!data.recent.length&&<tr><td colSpan="7">Ainda não há chamadas registradas.</td></tr>}</tbody></table></div>
    </>}
  </div>;
}
