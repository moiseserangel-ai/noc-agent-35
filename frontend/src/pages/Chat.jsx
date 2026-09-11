import { useState, useEffect, useRef, useMemo } from 'react';
import { Send, Plus, Trash2, MessageSquare, Wrench, Bot, Server, BookOpen, Search, Activity, ClipboardList, Stethoscope, StopCircle, ThumbsUp, ThumbsDown, Terminal, ExternalLink, Pencil, Archive, RotateCcw, Paperclip, FileDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  const navigate=useNavigate();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [agentType, setAgentType] = useState('support');
  const [specialists, setSpecialists] = useState([]);
  const [devices,setDevices]=useState([]);
  const [selectedDeviceId,setSelectedDeviceId]=useState('');
  const [sessionSearch,setSessionSearch]=useState('');
  const [sessionView,setSessionView]=useState('active');
  const [streaming, setStreaming] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState([]);
  const [contextStats,setContextStats]=useState(null);
  const [messageSearch,setMessageSearch]=useState('');
  const [searchIndex,setSearchIndex]=useState(0);
  const [pendingAttachments,setPendingAttachments]=useState([]);
  const [authorizeAttachments,setAuthorizeAttachments]=useState(false);
  const [attachmentError,setAttachmentError]=useState('');
  const messagesEnd = useRef(null);
  const attachmentInput=useRef(null);

  useEffect(() => {
    api.getChatSessions().then(r => setSessions(r.data)).catch(() => {});
    api.getDeviceTypes().then(r => setSpecialists(r.data)).catch(() => {});
    api.getDevices().then(r=>setDevices(r.data.filter(item=>item.isActive))).catch(()=>{});
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    api.getChatMessages(activeSession).then(r => setMessages(r.data)).catch(() => {});
    setPendingAttachments([]);setAttachmentError('');setMessageSearch('');
    const current=sessions.find(item=>item.id===activeSession);setContextStats(current?.summarizedMessageCount?{summaryActive:true,summarizedMessageCount:current.summarizedMessageCount}:null);
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
    s.on('chat:complete', ({ text, agentUsed, toolsUsed, provider, model, knowledgeSources, messageId, deviceId }) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text, agentUsed, provider, model, knowledgeSources, deviceId, id:messageId||Date.now() }]);
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
    s.on('chat:context',setContextStats);
    s.on('connect_error', onConnectError);
    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('focus', reconnect);
    window.addEventListener('noc:token-refreshed', reconnect);
    return () => {
      s.off('chat:chunk'); s.off('chat:tool'); s.off('chat:complete'); s.off('chat:error'); s.off('chat:typing');s.off('chat:cancelled');s.off('chat:context');
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
    if(!window.confirm('Excluir permanentemente esta conversa e todo o histórico? Esta ação não pode ser desfeita.'))return;
    await api.deleteChatSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSession === id) { setActiveSession(null); setMessages([]); }
  };
  const renameSession=async session=>{const title=window.prompt('Novo nome da conversa:',session.title||'Nova conversa');if(title===null||!title.trim())return;const result=await api.updateChatSession(session.id,{title});setSessions(rows=>rows.map(row=>row.id===session.id?{...row,...result.data}:row));};
  const archiveSession=async(session,archived)=>{const result=await api.updateChatSession(session.id,{archived});setSessions(rows=>rows.map(row=>row.id===session.id?{...row,...result.data}:row));if(archived&&activeSession===session.id){setActiveSession(null);setMessages([]);}};

  const sendMessage = () => {
    if (!input.trim() || !activeSession || isLoading || currentSession?.archivedAt) return;
    const msg = input.trim();
    setInput('');
    const attached=pendingAttachments;setMessages(prev => [...prev, { role: 'user', content: msg, attachments:attached, id: Date.now() }]);
    setPendingAttachments([]);
    setStreaming('');
    setTools([]);
    const s = getSocket();
    if (!s.connected) s.connect();
    s.emit('chat:message', { sessionId: activeSession, message: msg, agentType, deviceId:selectedDeviceId||null,attachmentIds:attached.map(item=>item.id) });
  };
  const filteredSessions=sessions.filter(session=>(sessionView==='archived'?Boolean(session.archivedAt):!session.archivedAt)&&(!sessionSearch.trim()||String(session.title||'Nova conversa').toLowerCase().includes(sessionSearch.trim().toLowerCase())));
  const currentSession=sessions.find(session=>session.id===activeSession);
  const searchResults=useMemo(()=>{const term=messageSearch.trim().toLocaleLowerCase('pt-BR');return term?messages.filter(row=>String(row.content||'').toLocaleLowerCase('pt-BR').includes(term)).map(row=>String(row.id)):[]},[messages,messageSearch]);
  useEffect(()=>{setSearchIndex(0)},[messageSearch,activeSession]);
  const moveSearch=direction=>{if(!searchResults.length)return;const next=(searchIndex+direction+searchResults.length)%searchResults.length;setSearchIndex(next);document.getElementById(`chat-message-${searchResults[next]}`)?.scrollIntoView({behavior:'smooth',block:'center'});};
  const uploadAttachment=async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setAttachmentError('');if(file.size>5*1024*1024){setAttachmentError('O arquivo excede o limite de 5 MB.');return}try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Falha ao ler arquivo'));reader.readAsDataURL(file)});const result=await api.uploadChatAttachment(activeSession,{filename:file.name,data,authorizedForAi:authorizeAttachments});setPendingAttachments(rows=>[...rows,result.data])}catch(error){setAttachmentError(error.message||'Falha ao anexar arquivo')}};
  const removeAttachment=async item=>{try{await api.deleteChatAttachment(item.id);setPendingAttachments(rows=>rows.filter(row=>row.id!==item.id))}catch(error){setAttachmentError(error.message)}};
  const exportConversation=async format=>{try{const result=await api.exportChatSession(activeSession,format),url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.filename;link.click();URL.revokeObjectURL(url)}catch(error){setAttachmentError(error.message)}};
  const quickAction=text=>{if(!selectedDeviceId)return;setInput(text);};
  const cancelResponse=()=>{getSocket().emit('chat:cancel',{sessionId:activeSession});setStreaming('');setTools([]);setIsLoading(false);};
  const rateMessage=async(message,feedback)=>{if(!message.id)return;const value=message.feedback===feedback?null:feedback;try{await api.rateChatMessage(message.id,value);setMessages(rows=>rows.map(row=>row.id===message.id?{...row,feedback:value}:row));}catch{}};
  const createTask=async message=>{if(!message.id||message.creatingTask)return;const deviceId=message.deviceId||selectedDeviceId;if(!deviceId)return;setMessages(rows=>rows.map(row=>row.id===message.id?{...row,creatingTask:true}:row));try{const response=await api.createTaskFromChatMessage(message.id,deviceId);setMessages(rows=>rows.map(row=>row.id===message.id?{...row,creatingTask:false,taskNumber:response.data.taskNumber}:row));}catch(error){setMessages(rows=>rows.map(row=>row.id===message.id?{...row,creatingTask:false,taskError:error.message||'Não foi possível criar a Task'}:row));}};
  const openShortcut=(path,deviceId)=>navigate(deviceId?`${path}?deviceId=${encodeURIComponent(deviceId)}`:path);

  return (
    <div className="chat-workspace">
      {/* Sidebar sessions */}
      <div className="chat-sessions">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={newSession}><Plus size={16} /> Nova Conversa</button>
        <div className="chat-session-tabs"><button className={sessionView==='active'?'active':''} onClick={()=>setSessionView('active')}>Ativas <span>{sessions.filter(item=>!item.archivedAt).length}</span></button><button className={sessionView==='archived'?'active':''} onClick={()=>setSessionView('archived')}>Arquivadas <span>{sessions.filter(item=>item.archivedAt).length}</span></button></div>
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
              <span className="chat-session-actions"><button onClick={e=>{e.stopPropagation();renameSession(s)}} title="Renomear"><Pencil size={12}/></button><button onClick={e=>{e.stopPropagation();archiveSession(s,!s.archivedAt)}} title={s.archivedAt?'Restaurar':'Arquivar'}>{s.archivedAt?<RotateCcw size={12}/>:<Archive size={12}/>}</button><button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} title="Excluir permanentemente"><Trash2 size={12}/></button></span>
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
              <span style={{ fontWeight: 600 }}>Chat com Agente</span>{currentSession?.archivedAt&&<span className="chat-archived-badge">Arquivada · somente leitura</span>}{contextStats?.summaryActive&&<span className="chat-context-badge" title={`${contextStats.summarizedMessageCount} mensagens antigas compactadas; as recentes permanecem integrais.`}>Memória otimizada · {contextStats.summarizedMessageCount}</span>}
            </div>
            <div className="chat-context-controls"><label><Server size={15}/><select className="form-select" value={selectedDeviceId} onChange={e=>setSelectedDeviceId(e.target.value)}><option value="">Nenhum equipamento fixado</option>{devices.map(item=><option key={item.id} value={item.id}>{item.name} · {item.hostname}</option>)}</select></label><select className="form-select" style={{ width: 160, padding: '6px 10px', fontSize: '0.8rem' }}
              value={agentType} onChange={e => setAgentType(e.target.value)}>
              <option value="support">🧠 Suporte</option>
              {specialists.map(item=><option key={item.type} value={item.type}>🔧 {item.label}</option>)}
            </select></div>
          </div>
          <div className="chat-history-tools"><label><Search size={13}/><input value={messageSearch} onChange={e=>setMessageSearch(e.target.value)} placeholder="Pesquisar nesta conversa"/></label>{messageSearch&&<div className="chat-search-navigation"><span>{searchResults.length?`${searchIndex+1}/${searchResults.length}`:'0 resultado'}</span><button disabled={!searchResults.length} onClick={()=>moveSearch(-1)}><ChevronLeft size={14}/></button><button disabled={!searchResults.length} onClick={()=>moveSearch(1)}><ChevronRight size={14}/></button></div>}<span className="chat-history-spacer"/><button onClick={()=>exportConversation('md')}><FileDown size={13}/> Markdown</button><button onClick={()=>exportConversation('pdf')}><FileDown size={13}/> PDF</button></div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div id={`chat-message-${m.id}`} key={m.id || i} className={`chat-message ${m.role} ${searchResults[searchIndex]===String(m.id)?'search-current':''}`}>
                {m.agentUsed && <div className="chat-message-meta"><Bot size={12}/> {m.agentUsed}{m.provider&&<> · {m.provider}</>}{m.model&&<> · {m.model}</>}</div>}
                {m.role === 'assistant' ? <AgentResponse content={m.content} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
                {m.attachments?.length>0&&<div className="chat-message-attachments">{m.attachments.map(file=><span key={file.id}><Paperclip size={12}/>{file.filename}<small>{file.authorizedForAi?'enviado à IA':'somente interno'}</small></span>)}</div>}
                {m.role==='assistant'&&(()=>{let sources=m.knowledgeSources||[];if(typeof sources==='string')try{sources=JSON.parse(sources);}catch{sources=[];}return sources.length?<div className="chat-sources"><BookOpen size={13}/><span>Fontes: {[...new Set(sources)].join(' · ')}</span></div>:null;})()}
                {m.role==='assistant'&&m.id&&<div className="chat-message-actions"><button disabled={m.creatingTask||(!m.deviceId&&!selectedDeviceId)} onClick={()=>createTask(m)} title="Criar uma Task pendente para revisão"><ClipboardList size={13}/>{m.taskNumber?` #TASK-${m.taskNumber}`:m.creatingTask?' Criando...':' Criar Task'}</button>{(m.deviceId||selectedDeviceId)&&<><button onClick={()=>openShortcut('/devices',m.deviceId||selectedDeviceId)} title="Abrir equipamento"><ExternalLink size={13}/> Equipamento</button><button onClick={()=>openShortcut('/terminal',m.deviceId||selectedDeviceId)} title="Abrir Terminal CLI"><Terminal size={13}/> Terminal</button></>}<button onClick={()=>openShortcut('/knowledge')} title="Abrir base de conhecimento"><BookOpen size={13}/> Documentação</button><span className="chat-feedback"><button className={m.feedback==='positive'?'active':''} onClick={()=>rateMessage(m,'positive')} title="Resposta útil"><ThumbsUp size={13}/></button><button className={m.feedback==='negative'?'active negative':''} onClick={()=>rateMessage(m,'negative')} title="Resposta precisa melhorar"><ThumbsDown size={13}/></button></span></div>}
                {m.taskError&&<div className="chat-action-error">{m.taskError}</div>}
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
            <div className="chat-quick-actions"><button type="button" disabled={!selectedDeviceId||isLoading||Boolean(currentSession?.archivedAt)} onClick={()=>quickAction('Consulte o estado atual deste equipamento e apresente um resumo objetivo, sem realizar alterações.')}><Activity size={13}/> Consultar estado</button><button type="button" disabled={!selectedDeviceId||isLoading||Boolean(currentSession?.archivedAt)} onClick={()=>quickAction('Faça um diagnóstico somente leitura deste equipamento, apresente evidências e possíveis causas.')}><Stethoscope size={13}/> Diagnosticar</button><button type="button" disabled={!selectedDeviceId||isLoading||Boolean(currentSession?.archivedAt)} onClick={()=>quickAction('Prepare um plano de mudança para este equipamento com comandos, riscos, validação e rollback. Não execute alterações.')}><ClipboardList size={13}/> Preparar plano</button></div>
            <div className="chat-attachment-controls"><input ref={attachmentInput} type="file" hidden accept=".txt,.log,.conf,.cfg,.md,.json,.xml,.yaml,.yml,.csv,.rsc,.pdf" onChange={uploadAttachment}/><button type="button" disabled={isLoading||Boolean(currentSession?.archivedAt)||pendingAttachments.length>=5} onClick={()=>attachmentInput.current?.click()}><Paperclip size={13}/> Anexar arquivo</button><label><input type="checkbox" checked={authorizeAttachments} onChange={e=>setAuthorizeAttachments(e.target.checked)}/><span>Autorizar envio do conteúdo mascarado ao provedor de IA</span></label></div>
            {pendingAttachments.length>0&&<div className="chat-pending-attachments">{pendingAttachments.map(file=><span key={file.id}><Paperclip size={12}/><span>{file.filename}<small>{file.authorizedForAi?'será enviado à IA':'somente interno'}</small></span><button onClick={()=>removeAttachment(file)}><X size={12}/></button></span>)}</div>}
            {attachmentError&&<div className="chat-attachment-error">{attachmentError}</div>}
            <textarea className="chat-input" rows={1} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={currentSession?.archivedAt?'Restaure a conversa para continuar':'Digite uma mensagem...'} disabled={isLoading||Boolean(currentSession?.archivedAt)} />
            {isLoading?<button className="btn btn-secondary" onClick={cancelResponse}><StopCircle size={18}/> Cancelar</button>:<button className="btn btn-primary" onClick={sendMessage} disabled={!input.trim()||Boolean(currentSession?.archivedAt)}><Send size={18}/></button>}
          </div>
        </div>
      )}
    </div>
  );
}
