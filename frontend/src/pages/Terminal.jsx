import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock3, Copy, Eraser, History, Play, Plug, TerminalSquare, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const typeLabel = value => ({ mikrotik: 'MikroTik RouterOS', huawei_vrp: 'Huawei VRP', linux: 'Linux' }[value] || value);
const statusLabel = value => ({ active: 'Ativa', closed: 'Encerrada', expired: 'Expirada' }[value] || value);
const starterCommands = {
  mikrotik: ['/system resource print', '/interface print', '/ip address print', '/ip route print'],
  huawei_vrp: ['display version', 'display interface brief', 'display ip routing-table', 'display alarm active'],
  linux: ['uptime', 'free -m', 'df -h', 'systemctl list-units --failed'],
};

export default function Terminal({ user }) {
  const toast = useToast();
  const outputEnd = useRef(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [session, setSession] = useState(null);
  const [commands, setCommands] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [command, setCommand] = useState('');
  const [pendingChange, setPendingChange] = useState(null);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);

  const device = useMemo(() => devices.find(item => item.id === deviceId), [devices, deviceId]);
  const loadSessions = () => api.getCliSessions().then(result => setSessions(result.data)).catch(() => {});

  useEffect(() => {
    api.getCliDevices().then(result => {
      setDevices(result.data);
      if (result.data.length) setDeviceId(result.data[0].id);
    }).catch(error => toast(error.message, 'error'));
    loadSessions();
  }, []);

  useEffect(() => { outputEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [commands, busy]);

  const connect = async () => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const result = await api.createCliSession(deviceId);
      setSession(result.data);
      setCommands([]);
      setPendingChange(null);
      toast(`Sessão aberta em ${result.data.deviceName}`, 'success');
      loadSessions();
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const openHistory = async id => {
    setBusy(true);
    try {
      const result = await api.getCliCommands(id);
      setSession(result.data.session);
      setDeviceId(result.data.session.deviceId);
      setCommands(result.data.commands);
      setPendingChange(null);
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await api.closeCliSession(session.id);
      setSession(result.data);
      toast('Sessão CLI encerrada', 'success');
      loadSessions();
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const execute = async ({ confirmed = false } = {}) => {
    const value = confirmed ? pendingChange : command.trim();
    if (!session || !value || busy) return;
    setBusy(true);
    try {
      const result = await api.executeCliCommand(session.id, { command: value, confirmed, justification: confirmed ? justification : undefined });
      if (result.requiresConfirmation) {
        setPendingChange(value);
        setJustification('');
      } else {
        setCommands(previous => [...previous, result.data]);
        setCommand('');
        setPendingChange(null);
        setJustification('');
      }
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const suggestions = starterCommands[device?.type] || [];
  const active = session?.status === 'active';

  return (
    <div>
      <div className="page-header">
        <h2>Terminal CLI</h2>
        <p>Console SSH controlada para consultas e alterações auditadas nos equipamentos.</p>
      </div>

      <div className="cli-layout">
        <aside className="card cli-sidebar">
          <div>
            <label className="form-label">Equipamento</label>
            <select className="form-select" value={deviceId} disabled={active || busy} onChange={event => setDeviceId(event.target.value)}>
              {devices.map(item => <option key={item.id} value={item.id}>{item.name} · {item.hostname}</option>)}
            </select>
          </div>
          {device && <div className="cli-device-summary">
            <strong>{device.name}</strong>
            <span>{typeLabel(device.type)}</span>
            <code>{device.hostname}:{device.port}</code>
            {device.group && <span>Grupo: {device.group}</span>}
          </div>}
          {!active
            ? <button className="btn btn-primary" onClick={connect} disabled={!deviceId || busy}><Plug size={16} /> Abrir sessão</button>
            : <button className="btn btn-secondary" onClick={disconnect} disabled={busy}><X size={16} /> Encerrar sessão</button>}

          <div className="cli-access-note">
            <strong>Seu acesso</strong>
            <span>{user?.role === 'admin' ? 'Consultas e alterações controladas' : 'Somente consultas'}</span>
          </div>

          <div className="cli-history-title"><History size={15} /> Sessões recentes</div>
          <div className="cli-session-history">
            {sessions.map(item => (
              <button key={item.id} className={session?.id === item.id ? 'active' : ''} onClick={() => openHistory(item.id)}>
                <strong>{item.deviceName}</strong>
                <span>{new Date(item.startedAt).toLocaleString('pt-BR')} · {item._count?.commands || 0} comandos</span>
                <small>{statusLabel(item.status)}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="cli-main">
          <div className="cli-toolbar">
            <div><TerminalSquare size={18} /><strong>{session ? `${session.username}@${session.hostname}` : 'Nenhuma sessão aberta'}</strong></div>
            <div className={`cli-connection ${active ? 'online' : ''}`}><span /> {active ? 'Conectado' : statusLabel(session?.status || 'closed')}</div>
          </div>

          <div className="cli-screen">
            {!session && <div className="cli-welcome">
              <TerminalSquare size={46} />
              <strong>Selecione um equipamento e abra uma sessão</strong>
              <span>As credenciais permanecem protegidas no servidor. Todo comando será auditado.</span>
            </div>}
            {session && <>
              <div className="cli-banner">
                Sessão {session.id.slice(0, 8)} · {typeLabel(session.deviceType)} · iniciada em {new Date(session.startedAt).toLocaleString('pt-BR')}
              </div>
              {commands.map(item => (
                <div className="cli-entry" key={item.id}>
                  <div className="cli-command-line"><span>{session.username}@{session.deviceName}$</span> {item.command}</div>
                  <pre className={item.status === 'success' ? '' : 'error'}>{item.output || '(sem saída)'}</pre>
                  <div className="cli-entry-meta">
                    <span className={item.commandType === 'change' ? 'change' : ''}>{item.commandType === 'change' ? 'ALTERAÇÃO' : 'CONSULTA'}</span>
                    <span>{item.durationMs} ms</span>
                    <button onClick={() => navigator.clipboard.writeText(item.output || '')}><Copy size={12} /> copiar saída</button>
                  </div>
                </div>
              ))}
              {busy && <div className="cli-running"><div className="spinner" /> Executando comando...</div>}
              <div ref={outputEnd} />
            </>}
          </div>

          {active && <>
            <div className="cli-suggestions">
              {suggestions.map(item => <button key={item} onClick={() => setCommand(item)}>{item}</button>)}
              <button onClick={() => setCommands([])}><Eraser size={13} /> limpar tela</button>
            </div>
            <div className="cli-input-row">
              <span>$</span>
              <textarea className="form-input" rows={2} value={command} onChange={event => setCommand(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); execute(); } }}
                placeholder="Digite um comando. Shift + Enter cria uma nova linha." disabled={busy} />
              <button className="btn btn-primary" onClick={() => execute()} disabled={!command.trim() || busy}><Play size={16} /> Executar</button>
            </div>
          </>}
        </section>
      </div>

      {pendingChange && <div className="modal-overlay">
        <div className="modal cli-confirm-modal">
          <div className="cli-warning-title"><AlertTriangle size={22} /> Confirmar alteração</div>
          <p>Este comando foi identificado como alteração de configuração. Confira antes de executar:</p>
          <pre>{pendingChange}</pre>
          <p className="cli-auto-audit">O sistema registrará automaticamente: <strong>Alteração manual via Terminal CLI</strong>.</p>
          <div className="cli-confirm-actions">
            <button className="btn btn-secondary" onClick={() => { setPendingChange(null); setJustification(''); }}>Cancelar</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => execute({ confirmed: true })}>
              <AlertTriangle size={15} /> Confirmar e executar
            </button>
          </div>
          <small><Clock3 size={12} /> O usuário, comando, resultado e horário serão registrados na auditoria.</small>
        </div>
      </div>}
    </div>
  );
}
