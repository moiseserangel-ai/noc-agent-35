import { useState, useEffect } from 'react';
import { ListTodo, ChevronDown, ChevronUp, RefreshCw, CheckCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge.jsx';
import { useToast } from '../App.jsx';

const formatDuration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
};

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', source: '', priority: '' });
  const [expanded, setExpanded] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [processing, setProcessing] = useState(null);
  const toast = useToast();

  useEffect(() => { api.getDevices().then(r => setDevices(r.data)).catch(() => {}); }, []);

  const reprocess = async (task) => {
    const deviceId = selectedDevices[task.id] || task.deviceId;
    if (!deviceId) { toast('Selecione o equipamento relacionado à Task', 'error'); return; }
    setProcessing(task.id);
    try {
      await api.reprocessTask(task.id, deviceId);
      toast('Task analisada novamente pelo agente', 'success');
      const r = await api.getTasks(filter); setTasks(r.data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setProcessing(null); }
  };

  const complete = async task => {
    const note = window.prompt('Informe uma observação para a conclusão:', 'Concluída manualmente pelo administrador');
    if (note === null) return;
    setProcessing(task.id);
    try {
      await api.completeTask(task.id, note);
      toast('Task concluída', 'success');
      setTasks(items => items.map(item => item.id === task.id ? { ...item, status: 'completed', executionResult: note } : item));
    } catch (e) { toast(e.message, 'error'); }
    finally { setProcessing(null); }
  };

  useEffect(() => {
    let active = true;
    const load = (showLoading = false) => {
    if (showLoading) setLoading(true);
    const p = {};
    if (filter.status) p.status = filter.status;
    if (filter.source) p.source = filter.source;
    if (filter.priority) p.priority = filter.priority;
    api.getTasks(p).then(r => { if (active) setTasks(r.data); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    };
    load(true);
    const interval = setInterval(() => load(false), 15000);
    const resume = () => { if (document.visibilityState === 'visible') load(false); };
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', resume); };
  }, [filter]);

  return (
    <div>
      <div className="page-header"><h2>Tasks</h2><p>Histórico de diagnósticos e ações</p></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 150 }} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos Status</option>
            <option value="pending">Pendente</option><option value="diagnosing">Diagnosticando</option>
            <option value="awaiting_approval">Aguardando</option><option value="completed">Concluído</option>
            <option value="failed">Falhou</option><option value="cancelled">Cancelado</option>
          </select>
          <select className="form-select" style={{ width: 130 }} value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}>
            <option value="">Todas Fontes</option><option value="whatsapp">WhatsApp</option>
            <option value="zabbix">Zabbix</option><option value="dashboard">Dashboard</option>
          </select>
        </div>
      </div>
      {loading ? <div className="loading-screen" style={{ minHeight: 200 }}><div className="spinner" /></div> :
      tasks.length === 0 ? <div className="card"><div className="empty-state"><ListTodo size={48} /><p>Nenhuma task encontrada.</p></div></div> :
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map(t => (
          <div key={t.id} className="card" style={{ cursor: 'pointer', padding: 0 }} onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--primary)', fontWeight: 700, minWidth: 60 }}>#{t.taskNumber}</span>
              <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
              <span className={`badge ${t.source === 'zabbix' ? 'badge-warning' : 'badge-success'}`}>{t.source}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.device?.name || t.originalMessage?.substring(0, 50)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{new Date(t.createdAt).toLocaleString('pt-BR')}</span>
              {expanded === t.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {expanded === t.id && (
              <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)' }}>
                {t.source === 'zabbix' && <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>EVENT.ID</div><strong>{t.zabbixEventId || '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ESTADO ZABBIX</div><strong>{t.zabbixStatus || '—'}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>OCORRÊNCIAS</div><strong>{t.occurrenceCount || 1}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>DUPLICADAS IGNORADAS</div><strong>{t.duplicateCount || 0}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>DURAÇÃO</div><strong>{formatDuration(t.durationSeconds)}</strong></div>
                  <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>RESOLVIDO EM</div><strong>{t.resolvedAt ? new Date(t.resolvedAt).toLocaleString('pt-BR') : '—'}</strong></div>
                </div>}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>MENSAGEM</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}>{t.originalMessage}</pre>
                </div>
                {t.diagnosis && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>DIAGNÓSTICO</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}>{t.diagnosis}</pre>
                </div>}
                {t.executionResult && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>RESULTADO</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8, color: 'var(--success)' }}>{t.executionResult}</pre>
                </div>}
                {['pending', 'failed', 'awaiting_approval'].includes(t.status) && <div onClick={e => e.stopPropagation()} style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="form-select" style={{ maxWidth: 300 }} value={selectedDevices[t.id] || t.deviceId || ''} onChange={e => setSelectedDevices(v => ({ ...v, [t.id]: e.target.value }))}>
                    <option value="">Selecione o equipamento</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name} — {d.hostname}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={processing === t.id} onClick={() => reprocess(t)}>
                    <RefreshCw size={15} /> {processing === t.id ? 'Processando...' : 'Reprocessar com agente'}
                  </button>
                  <button className="btn btn-secondary" disabled={processing === t.id} onClick={() => complete(t)}>
                    <CheckCircle size={15} /> Concluir manualmente
                  </button>
                </div>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}
