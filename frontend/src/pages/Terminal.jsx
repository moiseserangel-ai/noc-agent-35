import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock3, Copy, Eraser, History, Play, Plug, TerminalSquare, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const typeLabel = value => ({ mikrotik: 'MikroTik RouterOS', huawei_vrp: 'Huawei VRP', linux: 'Linux' }[value] || value);
const statusLabel = value => ({ active: 'Ativa', closed: 'Encerrada', expired: 'Expirada' }[value] || value);
const newTerminalId = () => globalThis.crypto?.randomUUID?.() || `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const starterCommands = {
  mikrotik: ['/system resource print', '/interface print', '/ip address print', '/ip route print'],
  huawei_vrp: ['display version', 'display interface brief', 'display ip routing-table', 'display alarm active'],
  linux: ['uptime', 'free -m', 'df -h', 'systemctl list-units --failed'],
};
const commandCatalog = {
  mikrotik: [
    '/system resource print', '/system identity print', '/system routerboard print', '/system clock print',
    '/interface print', '/interface ethernet print', '/interface vlan print', '/interface bridge print',
    '/interface bridge port print', '/ip address print', '/ip route print', '/ip arp print',
    '/ip firewall filter print', '/ip firewall nat print', '/ip firewall mangle print',
    '/ip dns print', '/ip dhcp-server print', '/ip dhcp-client print', '/ip service print',
    '/ppp active print', '/ppp secret print', '/routing bgp session print', '/log print',
    '/queue simple print', '/queue tree print', '/tool traceroute ', '/ping ',
  ],
  huawei_vrp: [
    'display version', 'display device', 'display current-configuration', 'display saved-configuration',
    'display interface brief', 'display interface ', 'display ip interface brief', 'display ip routing-table',
    'display arp', 'display mac-address', 'display vlan', 'display bgp peer', 'display bgp routing-table',
    'display ospf peer brief', 'display isis peer', 'display mpls lsp', 'display alarm active',
    'display logbuffer', 'display cpu-usage', 'display memory-usage', 'ping ', 'tracert ',
    'system-view', 'interface ', 'description ', 'undo shutdown', 'shutdown', 'quit', 'return',
  ],
  linux: [
    'uptime', 'free -m', 'df -h', 'du -sh ', 'top -bn1 | head -20', 'ps aux',
    'ss -tlnp', 'ss -s', 'ip addr show', 'ip route show', 'ip link show', 'ip neigh show',
    'systemctl status ', 'systemctl list-units --failed', 'systemctl is-active ',
    'journalctl -u ', 'journalctl -p err --no-pager -n 50', 'dmesg | tail -20',
    'hostname', 'hostnamectl', 'uname -a', 'ls -la ', 'tail -n 50 ', 'grep -i ',
    'ping -c 4 ', 'traceroute ',
  ],
};

function InteractiveConsole({ device, visible, onSession, onClosed, onStatus, onActivity }) {
  const host = useRef(null);
  const terminal = useRef(null);
  const socket = useRef(null);
  const fitAddon = useRef(null);
  const visibleRef = useRef(visible);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) requestAnimationFrame(() => {
      try {
        fitAddon.current?.fit();
        socket.current?.emit('cli:interactive:resize', { cols: terminal.current?.cols, rows: terminal.current?.rows });
        terminal.current?.focus();
      } catch {}
    });
  }, [visible]);

  useEffect(() => {
    if (!device || !host.current) return undefined;
    const term = new XTerm({
      cursorBlink: true,
      convertEol: false,
      scrollback: 10000,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#080c10', foreground: '#d2dee6', cursor: '#39d98a',
        black: '#10171c', red: '#ff6b6b', green: '#39d98a', yellow: '#ffc857',
        blue: '#63b9f2', magenta: '#c792ea', cyan: '#56d4dd', white: '#d2dee6',
        brightBlack: '#657782', brightRed: '#ff8585', brightGreen: '#55e69a',
        brightYellow: '#ffd978', brightBlue: '#86cbf7', brightMagenta: '#d9a8f2',
        brightCyan: '#82e6eb', brightWhite: '#f3f7fa',
      },
    });
    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    requestAnimationFrame(() => fit.fit());
    term.writeln('\x1b[36mConectando ao equipamento via SSH...\x1b[0m');

    const client = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('noc_token') },
    });
    socket.current = client;
    const sendResize = () => {
      try {
        fit.fit();
        client.emit('cli:interactive:resize', { cols: term.cols, rows: term.rows });
      } catch {}
    };
    const observer = new ResizeObserver(sendResize);
    observer.observe(host.current);
    const input = term.onData(data => client.emit('cli:interactive:input', { data }));
    client.on('connect', () => {
      client.emit('cli:interactive:connect', { deviceId: device.id, cols: term.cols, rows: term.rows }, result => {
        if (!result?.success) {
          setStatus('error');
          onStatus('error');
          term.writeln(`\r\n\x1b[31mFalha: ${result?.error || 'não foi possível conectar'}\x1b[0m`);
          return;
        }
        setStatus('connected');
        onStatus('connected');
        onSession(result.session);
        term.focus();
      });
    });
    client.on('cli:interactive:output', ({ data }) => {
      term.write(data);
      if (!visibleRef.current) onActivity();
    });
    client.on('cli:interactive:error', ({ error }) => {
      setStatus('error');
      onStatus('error');
      term.writeln(`\r\n\x1b[31mErro SSH: ${error}\x1b[0m`);
    });
    client.on('cli:interactive:status', event => {
      if (event.status === 'closed') {
        setStatus('closed');
        onStatus('closed');
        term.writeln(`\r\n\x1b[33mSessão encerrada: ${event.reason || 'desconectada'}\x1b[0m`);
        onClosed?.();
      }
    });
    client.on('connect_error', error => {
      setStatus('error');
      onStatus('error');
      term.writeln(`\r\n\x1b[31mWebSocket: ${error.message}\x1b[0m`);
    });

    return () => {
      observer.disconnect();
      input.dispose();
      client.emit('cli:interactive:disconnect');
      client.disconnect();
      term.dispose();
      socket.current = null;
      terminal.current = null;
      fitAddon.current = null;
    };
  }, [device?.id]);

  return (
    <div className={`cli-interactive-panel ${visible ? 'active' : ''}`}>
      <div className="cli-toolbar">
        <div><TerminalSquare size={18} /><strong>{device ? `admin@${device.hostname}` : 'Terminal interativo'}</strong></div>
        <div className={`cli-connection ${status === 'connected' ? 'online' : ''}`}><span /> {{
          connecting: 'Conectando', connected: 'SSH conectado', closed: 'Encerrado', error: 'Erro',
        }[status]}</div>
      </div>
      <div className="cli-interactive-notice">Sessão SSH nativa · PTY xterm-256color · acesso administrativo auditado</div>
      <div className="cli-xterm" ref={host} onClick={() => terminal.current?.focus()} />
    </div>
  );
}

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
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [terminalMode, setTerminalMode] = useState('controlled');
  const [interactiveTabs, setInteractiveTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

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
    if (terminalMode === 'interactive') {
      if (interactiveTabs.length >= 5) return toast('Limite de 5 sessões interativas simultâneas.', 'error');
      if (interactiveTabs.filter(tab => tab.device.id === deviceId).length >= 2) return toast('Limite de 2 sessões neste equipamento.', 'error');
      const tab = { id: newTerminalId(), device, status: 'connecting', unread: false, session: null };
      setInteractiveTabs(previous => [...previous, tab]);
      setActiveTabId(tab.id);
      return;
    }
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
    if (interactiveTabs.length) {
      toast('Feche as sessões interativas antes de abrir um histórico na Console auditada.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api.getCliCommands(id);
      setSession(result.data.session);
      setTerminalMode('controlled');
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
        setHistoryIndex(-1);
        setPendingChange(null);
        setJustification('');
      }
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const suggestions = starterCommands[device?.type] || [];
  const currentLine = command.split('\n').at(-1)?.trimStart() || '';
  const autoComplete = (commandCatalog[device?.type] || [])
    .filter(item => currentLine && item.toLowerCase().startsWith(currentLine.toLowerCase()) && item.toLowerCase() !== currentLine.toLowerCase())
    .slice(0, 8);
  const active = session?.status === 'active';

  const selectTab = id => {
    setActiveTabId(id);
    setInteractiveTabs(previous => previous.map(tab => tab.id === id ? { ...tab, unread: false } : tab));
  };

  const closeTab = id => {
    const tab = interactiveTabs.find(item => item.id === id);
    if (!tab) return;
    if (tab.status === 'connected' && !window.confirm(`Encerrar a sessão SSH com ${tab.device.name}?`)) return;
    const remaining = interactiveTabs.filter(item => item.id !== id);
    setInteractiveTabs(remaining);
    if (activeTabId === id) setActiveTabId(remaining.at(-1)?.id || null);
    window.setTimeout(loadSessions, 400);
  };

  const updateTab = (id, changes) => setInteractiveTabs(previous => previous.map(tab => tab.id === id ? { ...tab, ...changes } : tab));

  const completeCommand = value => {
    const lines = command.split('\n');
    const indentation = lines.at(-1)?.match(/^\s*/)?.[0] || '';
    lines[lines.length - 1] = `${indentation}${value}`;
    setCommand(lines.join('\n'));
  };

  const navigateHistory = direction => {
    const history = commands.map(item => item.command).filter(Boolean).reverse();
    if (!history.length) return;
    const next = Math.max(-1, Math.min(history.length - 1, historyIndex + direction));
    setHistoryIndex(next);
    setCommand(next === -1 ? '' : history[next]);
  };

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
            <select className="form-select" value={deviceId} disabled={(terminalMode === 'controlled' && active) || busy} onChange={event => setDeviceId(event.target.value)}>
              {devices.map(item => <option key={item.id} value={item.id}>{item.name} · {item.hostname}</option>)}
            </select>
          </div>
          {user?.role === 'admin' && <div>
            <label className="form-label">Modo de acesso</label>
            <select className="form-select" value={terminalMode} disabled={active || interactiveTabs.length > 0 || busy} onChange={event => setTerminalMode(event.target.value)}>
              <option value="controlled">Console auditada</option>
              <option value="interactive">Terminal interativo</option>
            </select>
          </div>}
          {device && <div className="cli-device-summary">
            <strong>{device.name}</strong>
            <span>{typeLabel(device.type)}</span>
            <code>{device.hostname}:{device.port}</code>
            {device.group && <span>Grupo: {device.group}</span>}
          </div>}
          {terminalMode === 'interactive'
            ? <button className="btn btn-primary" onClick={connect} disabled={!deviceId || busy || interactiveTabs.length >= 5}><Plug size={16} /> Nova sessão ({interactiveTabs.length}/5)</button>
            : !active
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

        {terminalMode === 'interactive' ? <section className="cli-main cli-interactive-main">
          <div className="cli-tabs">
            {interactiveTabs.map(tab => <button key={tab.id} className={activeTabId === tab.id ? 'active' : ''} onClick={() => selectTab(tab.id)}>
              <span className={`cli-tab-status ${tab.status}`} />
              <strong>{tab.device.name}</strong>
              {tab.unread && <span className="cli-tab-unread" title="Nova atividade" />}
              <span className="cli-tab-close" role="button" aria-label={`Fechar ${tab.device.name}`} onClick={event => { event.stopPropagation(); closeTab(tab.id); }}><X size={13} /></span>
            </button>)}
            <button className="cli-new-tab" onClick={connect} disabled={!deviceId || interactiveTabs.length >= 5}>+ Nova sessão</button>
          </div>
          <div className="cli-tab-panels">
            {!interactiveTabs.length && <div className="cli-welcome">
              <TerminalSquare size={46} />
              <strong>Abra até 5 terminais simultâneos</strong>
              <span>Selecione um equipamento e clique em Nova sessão. São permitidas até 2 conexões no mesmo equipamento.</span>
            </div>}
            {interactiveTabs.map(tab => <InteractiveConsole key={tab.id} device={tab.device} visible={activeTabId === tab.id}
              onSession={next => { updateTab(tab.id, { session: next, status: 'connected' }); loadSessions(); }}
              onStatus={status => updateTab(tab.id, { status })}
              onActivity={() => updateTab(tab.id, { unread: true })}
              onClosed={loadSessions} />)}
          </div>
        </section> : <section className="cli-main">
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
              <textarea className="form-input" rows={2} value={command} onChange={event => { setCommand(event.target.value); setHistoryIndex(-1); }}
                onKeyDown={event => {
                  if (event.key === 'Tab' && autoComplete.length) { event.preventDefault(); completeCommand(autoComplete[0]); }
                  else if (event.key === 'ArrowUp' && !event.shiftKey) { event.preventDefault(); navigateHistory(1); }
                  else if (event.key === 'ArrowDown' && !event.shiftKey) { event.preventDefault(); navigateHistory(-1); }
                  else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); execute(); }
                }}
                placeholder="Digite um comando. Tab completa · ↑/↓ histórico · Shift + Enter nova linha." disabled={busy} />
              <button className="btn btn-primary" onClick={() => execute()} disabled={!command.trim() || busy}><Play size={16} /> Executar</button>
            </div>
            {autoComplete.length > 0 && <div className="cli-autocomplete">
              <span>Tab para completar</span>
              {autoComplete.map((item, index) => <button key={item} className={index === 0 ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => completeCommand(item)}>{item}</button>)}
            </div>}
          </>}
        </section>}
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
