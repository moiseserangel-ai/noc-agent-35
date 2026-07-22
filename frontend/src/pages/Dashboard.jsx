import { useState, useEffect } from 'react';
import { Server, CheckCircle, Clock, AlertTriangle, Activity, DatabaseBackup } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge.jsx';

export default function Dashboard({ showBackup = false }) {
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backupStatus, setBackupStatus] = useState(null);
  const sourceLabel = source => String(source).startsWith('dashboard:') ? 'dashboard' : source;

  useEffect(() => {
    let active = true;
    const load = (showLoading = false) => {
    if (showLoading) setLoading(true);
    Promise.all([api.getTaskStats(), api.getTasks({ limit: 10 }), showBackup ? api.getBackupStatus().catch(()=>null) : Promise.resolve(null)])
      .then(([statsRes, tasksRes, backupRes]) => {
        if (active) { setStats(statsRes.data); setTasks(tasksRes.data); if(backupRes) setBackupStatus(backupRes.data); }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    };
    load(true);
    const interval = setInterval(() => load(false), 15000);
    const resume = () => { if (document.visibilityState === 'visible') load(false); };
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', resume); };
  }, []);

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Visão geral do sistema de monitoramento NOC</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon cyan"><Activity size={24} /></div>
          <div>
            <div className="stat-value">{stats?.total || 0}</div>
            <div className="stat-label">Total de Tasks</div>
          </div>
        </div>
        {showBackup && <div className="stat-card"><div className="stat-icon blue"><DatabaseBackup size={24}/></div><div><div className="stat-value" style={{fontSize:'1rem'}}>{backupStatus?.lastBackup ? new Date(backupStatus.lastBackup.createdAt).toLocaleDateString('pt-BR') : 'Pendente'}</div><div className="stat-label">Último backup</div></div></div>}
        <div className="stat-card">
          <div className="stat-icon amber"><AlertTriangle size={24} /></div>
          <div><div className="stat-value">{stats?.slaBreached || 0}</div><div className="stat-label">SLA Violado</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><Clock size={24} /></div>
          <div>
            <div className="stat-value">{(stats?.pending || 0) + (stats?.inProgress || 0) + (stats?.diagnosing || 0)}</div>
            <div className="stat-label">Em Andamento</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><AlertTriangle size={24} /></div>
          <div>
            <div className="stat-value">{stats?.awaiting || 0}</div>
            <div className="stat-label">Aguardando Aprovação</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={24} /></div>
          <div>
            <div className="stat-value">{stats?.completedToday || 0}</div>
            <div className="stat-label">Resolvidas Hoje</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Últimas Tasks</span>
        </div>

        {tasks.length === 0 ? (
          <div className="empty-state">
            <Server size={48} />
            <p>Nenhuma task ainda. As tasks aparecerão quando alertas do Zabbix ou mensagens do WhatsApp forem recebidos.</p>
          </div>
        ) : (
          <div className="table-container" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Fonte</th>
                  <th>Dispositivo</th>
                  <th>Status</th>
                  <th>Prioridade</th>
                  <th>Criada</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ color: 'var(--primary)', fontWeight: 600 }}>#{task.taskNumber}</td>
                    <td>
                      <span className={`badge ${task.source === 'zabbix' ? 'badge-warning' : task.source === 'whatsapp' ? 'badge-success' : 'badge-info'}`}>
                        {sourceLabel(task.source)}
                      </span>
                    </td>
                    <td>{task.device?.name || '—'}</td>
                    <td><StatusBadge status={task.status} /></td>
                    <td><PriorityBadge priority={task.priority} /></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(task.createdAt).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
