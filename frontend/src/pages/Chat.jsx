import { useState, useEffect, useRef } from 'react';
import { Send, Plus, Trash2, MessageSquare, Wrench, Bot, Server, BookOpen, Search, Activity, ClipboardList, Stethoscope, StopCircle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { io } from 'socket.io-client';
import { api } from '../lib/api.js';
import AgentResponse from '../components/AgentResponse.jsx';

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
  const [specialists, setSpecialists] = useState([]);
  const [devices,setDevices]=useState([]);
  const [selectedDeviceId,setSelectedDeviceId]=useState('');
  const [sessionSearch,setSessionSearch]=useState('');
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState([]);
  const messagesEnd = useRef(null);

  useEffect(() => {
    api.getChatSessions().then(r => setSessions(r.data)).catch(() => {});
    api.getDeviceTypes().then(r => setSpecialists(r.data)).catch(() => {});
    api.getDevices().then(r=>setDevices(r.data.filter(item=>item.isActive))).catch(()=>{});
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
    s.on('chat:complete', ({ text, agentUsed, toolsUsed, provider, model, knowledgeSources, messageId }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text, agentUsed, provider, model, knowledgeSources, id:messageId||Date.now() }]);
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
    s.on('chat:cancelled',()=>{setStreaming('');setTools([]);setIsLoading(false);});
    s.on('connect_error', onConnectError);
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('focus', reconnect);
    window.addEventListener('noc:token-refreshed', reconnect);
    return () => {
      s.off('chat:chunk'); s.off('chat:tool'); s.off('chat:complete'); s.off('chat:error'); s.off('chat:typing');s.off('chat:cancelled');
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
    s.emit('chat:message', { sessionId: activeSession, message: msg, agentType, deviceId:selectedDeviceId||null });
  };
  const filteredSessions=sessions.filter(session=>!sessionSearch.trim()||String(session.title||'Nova conversa').toLowerCase().includes(sessionSearch.trim().toLowerCase()));
  const quickAction=text=>{if(!selectedDeviceId)return;setInput(text);};
  const cancelResponse=()=>{getSocket().emit('chat:cancel',{sessionId:activeSession});setStreaming('');setTools([]);setIsLoading(false);};
  const rateMessage=async(message,feedback)=>{if(!message.id)return;const value=message.feedback===feedback?null:feedback;try{await api.rateChatMessage(message.id,value);setMessages(rows=>rows.map(row=>row.id===message.id?{...row,feedback:value}:row));}catch{}};

  return (
    <div className="chat-workspace">
      {/* Sidebar sessions */}
      <div className="chat-sessions">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={newSession}><Plus size={16} /> Nova Conversa</button>
        <label className="chat-session-search"><Search size={14}/><input value={sessionSearch} onChange={e=>setSessionSearch(e.target.value)} placeholder="Pesquisar conversas"/></label>
        <div className="chat-session-list">
          {filteredSessions.map(s => (
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
            <div className="chat-context-controls"><label><Server size={15}/><select className="form-select" value={selectedDeviceId} onChange={e=>setSelectedDeviceId(e.target.value)}><option value="">Nenhum equipamento fixado</option>{devices.map(item=><option key={item.id} value={item.id}>{item.name} · {item.hostname}</option>)}</select></label><select className="form-select" style={{ width: 160, padding: '6px 10px', fontSize: '0.8rem' }}
              value={agentType} onChange={e => setAgentType(e.target.value)}>
              <option value="support">🧠 Suporte</option>
              {specialists.map(item=><option key={item.type} value={item.type}>🔧 {item.label}</option>)}
            </select></div>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={m.id || i} className={`chat-message ${m.role}`}>
                {m.agentUsed && <div className="chat-message-meta"><Bot size={12}/> {m.agentUsed}{m.provider&&<> · {m.provider}</>}{m.model&&<> · {m.model}</>}</div>}
                {m.role === 'assistant' ? <AgentResponse content={m.content} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                {m.role==='assistant'&&(()=>{let sources=m.knowledgeSources||[];if(typeof sources==='string')try{sources=JSON.parse(sources);}catch{sources=[];}return sources.length?<div className="chat-sources"><BookOpen size={13}/><span>Fontes: {[...new Set(sources)].join(' · ')}</span></div>:null;})()}
                {m.role==='assistant'&&m.id&&<div className="chat-feedback"><button className={m.feedback==='positive'?'active':''} onClick={()=>rateMessage(m,'positive')} title="Resposta útil"><ThumbsUp size={13}/></button><button className={m.feedback==='negative'?'active negative':''} onClick={()=>rateMessage(m,'negative')} title="Resposta precisa melhorar"><ThumbsDown size={13}/></button></div>}
              </div>
            ))}
            {tools.length > 0 && tools.map((t, i) => (
              <div key={i} className="chat-tool-indicator">
                <Wrench size={14} />
                {t.status === 'start' ? `Executando: ${t.tool}...` : `✅ ${t.tool} concluído`}
              </div>
            ))}
            {streaming && <div className="chat-message assistant"><AgentResponse content={streaming} /></div>}
            {isLoading && !streaming && <div className="chat-tool-indicator"><div className="spinner" /> Agente processando...</div>}
            <div ref={messagesEnd} />
          </div>

          <div className="chat-input-area">
            <div className="chat-quick-actions"><button type="button" disabled={!selectedDeviceId||isLoading} onClick={()=>quickAction('Consulte o estado atual deste equipamento e apresente um resumo objetivo, sem realizar alterações.')}><Activity size={13}/> Consultar estado</button><button type="button" disabled={!selectedDeviceId||isLoading} onClick={()=>quickAction('Faça um diagnóstico somente leitura deste equipamento, apresente evidências e possíveis causas.')}><Stethoscope size={13}/> Diagnosticar</button><button type="button" disabled={!selectedDeviceId||isLoading} onClick={()=>quickAction('Prepare um plano de mudança para este equipamento com comandos, riscos, validação e rollback. Não execute alterações.')}><ClipboardList size={13}/> Preparar plano</button></div>
            <textarea className="chat-input" rows={1} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Digite uma mensagem..." disabled={isLoading} />
            {isLoading?<button className="btn btn-secondary" onClick={cancelResponse}><StopCircle size={18}/> Cancelar</button>:<button className="btn btn-primary" onClick={sendMessage} disabled={!input.trim()}><Send size={18}/></button>}
          </div>
        </div>
      )}
    </div>
  );
}
