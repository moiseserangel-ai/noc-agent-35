import { useState, useEffect, useRef } from 'react';
import { Send, Plus, Trash2, MessageSquare, Wrench, Bot } from 'lucide-react';
import { io } from 'socket.io-client';
import { api } from '../lib/api.js';

let socket = null;
function getSocket() {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('noc_token') },
    });
  }
  socket.auth = { token: localStorage.getItem('noc_token') };
  return socket;
}

export default function Chat() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [agentType, setAgentType] = useState('support');
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState([]);
  const messagesEnd = useRef(null);

  useEffect(() => {
    api.getChatSessions().then(r => setSessions(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    api.getChatMessages(activeSession).then(r => setMessages(r.data)).catch(() => {});
  }, [activeSession]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    const s = getSocket();
    const reconnect = () => {
      s.auth = { token: localStorage.getItem('noc_token') };
      if (!s.connected) s.connect();
    };
    const onConnectError = (err) => {
      setIsLoading(false);
      if (/autorizado|token/i.test(err.message || '')) {
        setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ A sessão do chat expirou. Aguarde a renovação automática ou entre novamente.', id: Date.now() }]);
      }
    };
    s.on('chat:chunk', ({ text }) => setStreaming(prev => prev + text));
    s.on('chat:tool', (data) => setTools(prev => [...prev, data]));
    s.on('chat:complete', ({ text, agentUsed, toolsUsed }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text, agentUsed, id: Date.now() }]);
      setStreaming('');
      setTools([]);
      setIsLoading(false);
    });
    s.on('chat:error', ({ error }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Erro: ${error}`, id: Date.now() }]);
      setStreaming('');
      setTools([]);
      setIsLoading(false);
    });
    s.on('chat:typing', () => setIsLoading(true));
    s.on('connect_error', onConnectError);
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('focus', reconnect);
    window.addEventListener('noc:token-refreshed', reconnect);
    return () => {
      s.off('chat:chunk'); s.off('chat:tool'); s.off('chat:complete'); s.off('chat:error'); s.off('chat:typing');
      s.off('connect_error', onConnectError);
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('focus', reconnect);
      window.removeEventListener('noc:token-refreshed', reconnect);
    };
  }, []);

  const newSession = async () => {
    const r = await api.createChatSession('Nova conversa');
    setSessions(prev => [r.data, ...prev]);
    setActiveSession(r.data.id);
    setMessages([]);
  };

  const deleteSession = async (id) => {
    await api.deleteChatSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSession === id) { setActiveSession(null); setMessages([]); }
  };

  const sendMessage = () => {
    if (!input.trim() || !activeSession || isLoading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, id: Date.now() }]);
    setStreaming('');
    setTools([]);
    const s = getSocket();
    if (!s.connected) s.connect();
    s.emit('chat:message', { sessionId: activeSession, message: msg, agentType });
  };

  return (
    <div className="chat-workspace">
      {/* Sidebar sessions */}
      <div className="chat-sessions">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={newSession}><Plus size={16} /> Nova Conversa</button>
        <div className="chat-session-list">
          {sessions.map(s => (
            <div key={s.id}
              className={`sidebar-link ${activeSession === s.id ? 'active' : ''}`}
              style={{ justifyContent: 'space-between', fontSize: '0.8rem' }}
              onClick={() => { setActiveSession(s.id); setMessages([]); }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.title || 'Nova conversa'}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ padding: 2, color: 'var(--text-muted)' }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      {!activeSession ? (
        <div className="card chat-empty">
          <div className="empty-state">
            <MessageSquare size={48} />
            <p>Selecione ou crie uma conversa para testar os agentes IA.</p>
          </div>
        </div>
      ) : (
        <div className="chat-container" style={{ flex: 1 }}>
          <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={20} style={{ color: 'var(--primary)' }} />
              <span style={{ fontWeight: 600 }}>Chat com Agente</span>
            </div>
            <select className="form-select" style={{ width: 160, padding: '6px 10px', fontSize: '0.8rem' }}
              value={agentType} onChange={e => setAgentType(e.target.value)}>
              <option value="support">🧠 Suporte</option>
              <option value="mikrotik">🔧 MikroTik</option>
              <option value="linux">🐧 Linux</option>
            </select>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={m.id || i} className={`chat-message ${m.role}`}>
                {m.agentUsed && <div style={{ fontSize: '0.65rem', opacity: 0.7, marginBottom: 4 }}>Agent: {m.agentUsed}</div>}
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            ))}
            {tools.length > 0 && tools.map((t, i) => (
              <div key={i} className="chat-tool-indicator">
                <Wrench size={14} />
                {t.status === 'start' ? `Executando: ${t.tool}...` : `✅ ${t.tool} concluído`}
              </div>
            ))}
            {streaming && <div className="chat-message assistant"><div style={{ whiteSpace: 'pre-wrap' }}>{streaming}</div></div>}
            {isLoading && !streaming && <div className="chat-tool-indicator"><div className="spinner" /> Agente processando...</div>}
            <div ref={messagesEnd} />
          </div>

          <div className="chat-input-area">
            <textarea className="chat-input" rows={1} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Digite uma mensagem..." disabled={isLoading} />
            <button className="btn btn-primary" onClick={sendMessage} disabled={isLoading || !input.trim()}>
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
